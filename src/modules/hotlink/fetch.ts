// 按规则去要媒体：带上规则的请求头；被拒就（必要时换个新地址）再试几次。
// 不依赖 Obsidian，测试里直接跑。

import type { RefreshContext, Rule } from "./rules";

export interface FetchedMedia {
	body: Uint8Array;
	contentType: string;
	/** 最后实际拿到文件的地址（可能是换过的新地址）。 */
	url: string;
}

export interface FetchOptions {
	attempts?: number;
	sleep?: (ms: number) => Promise<void>;
	/** 全被拒时的说明（会显示在媒体下方），默认是中文。 */
	refusedMessage?: (rule: Rule, attempts: number, lastStatus: number) => string;
}

const defaultRefusedMessage = (rule: Rule, attempts: number, lastStatus: number) =>
	`${rule.name}：试了 ${attempts} 次都被拒绝（最后一次 HTTP ${lastStatus}）`;

const ok = (status: number) => status === 200 || status === 206;

export async function fetchMedia(
	url: string,
	rule: Rule,
	ctx: RefreshContext,
	{
		attempts = 4,
		sleep = (ms) => new Promise((r) => window.setTimeout(r, ms)),
		refusedMessage = defaultRefusedMessage,
	}: FetchOptions = {},
): Promise<FetchedMedia> {
	let current = url;
	let lastStatus = 0;
	for (let i = 0; i < attempts; i++) {
		const res = await ctx.request({ url: current, headers: rule.headers });
		lastStatus = res.status;
		if (ok(res.status) && res.body.length > 0) {
			return { body: res.body, contentType: res.contentType, url: current };
		}
		// 被拒：能换地址就换一个（同一个视频的新地址），然后稍等再试——有的网站时好时坏
		if (rule.refresh) {
			const fresh = await rule.refresh(current, ctx).catch(() => null);
			if (fresh) current = fresh;
		}
		if (i < attempts - 1) await sleep(400 * (i + 1));
	}
	throw new Error(refusedMessage(rule, attempts, lastStatus));
}
