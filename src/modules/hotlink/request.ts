// 用 Node 自带的 http/https 发请求。
//
// 不用 fetch：浏览器环境里 Referer 是禁止手动设置的请求头，设了会被丢掉。Obsidian 的 requestUrl
// 走 Electron 的网络栈，Referer 也不保证带得上。Node 的 https 可以随便设，桌面版 Obsidian 能用
// （manifest 里 isDesktopOnly: true），而且同一份代码能在 Obsidian 外面直接测。
//
// 静态 import：打包成 CommonJS 后是 require("https")，测试（ESM）里也能用。main.ts 用动态 import
// 加载这个文件，所以只有真的发请求时才 require，手机上不会碰到。

import { get as httpGet, type IncomingMessage } from "http";
import { get as httpsGet } from "https";
import type { RequestOptions, RequestResult } from "./rules";

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 60_000;

export function nodeRequest(options: RequestOptions, redirects = 0): Promise<RequestResult> {
	const get = options.url.startsWith("https:") ? httpsGet : httpGet;
	return new Promise((resolve, reject) => {
		const req = get(options.url, { headers: options.headers, timeout: TIMEOUT_MS }, (res: IncomingMessage) => {
			const status = res.statusCode ?? 0;
			const location = res.headers.location;
			if (status >= 300 && status < 400 && location && redirects < MAX_REDIRECTS) {
				res.resume();
				const next = new URL(location, options.url).href;
				nodeRequest({ ...options, url: next }, redirects + 1).then(resolve, reject);
				return;
			}
			const chunks: Buffer[] = [];
			res.on("data", (c: Buffer) => chunks.push(c));
			res.on("end", () =>
				resolve({
					status,
					contentType: res.headers["content-type"] ?? "",
					body: new Uint8Array(Buffer.concat(chunks)),
				}),
			);
			res.on("error", reject);
		});
		req.on("timeout", () => req.destroy(new Error(`Timed out after ${TIMEOUT_MS / 1000}s: ${options.url}`)));
		req.on("error", reject);
	});
}
