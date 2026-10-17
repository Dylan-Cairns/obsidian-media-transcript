// 规则表：哪些媒体地址归谁管、去要的时候带什么请求头、地址失效了怎么拿新的。
//
// 很多网站有「防盗链」：媒体文件只肯给从自家页面发起的请求（看 Referer 请求头）。笔记里的
// <video>/<img> 由 Obsidian 去要，Referer 是 app://obsidian.md，于是被拒（403）。这里按规则
// 自己去要，带上对方想看到的请求头，再把拿到的文件交给页面显示。
//
// 加一个新网站 = 在 RULES 里加一条。没命中任何规则的地址完全不碰。

export interface RequestOptions {
	url: string;
	headers: Record<string, string>;
}

export interface RequestResult {
	status: number;
	contentType: string;
	body: Uint8Array;
}

export type Requester = (options: RequestOptions) => Promise<RequestResult>;

export interface RefreshContext {
	/** 笔记记录的原文地址（frontmatter 的 source），有的网站要靠它重新拿媒体地址。 */
	pageUrl?: string;
	request: Requester;
}

export interface Rule {
	id: string;
	name: string;
	/** 这条规则管哪些媒体地址。 */
	match: RegExp;
	/** 去要媒体时带的请求头。 */
	headers: Record<string, string>;
	/** 地址被拒时，怎么拿一个新地址。返回 null 表示拿不到。 */
	refresh?: (staleUrl: string, ctx: RefreshContext) => Promise<string | null>;
}

const CHROME_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

// ── 微信公众号视频 ─────────────────────────────────────────
//
// 实测（2026-10-04）：
// - mpvideo.qpic.cn 只认「浏览器 + Referer: https://mp.weixin.qq.com/」，缺一个就 403。
// - 同一个地址时好时坏：两小时里每 15 分钟测一次，8 次里 3 次能播。所以被拒后要重试。
// - 直接抓原文页面（不用浏览器），HTML 里就有每个视频的新地址。
// - 地址路径的第一段（如 0bc3uyaakaaao4aozvv5abvfbjwdawtaabia）是视频文件的编号，换新地址也不变，
//   用它在原文里找到同一个视频；后面的 .f10002 是清晰度，尽量选一样的。

/** 视频文件编号和清晰度：https://mpvideo.qpic.cn/<编号>.<清晰度>.mp4?… */
export function wechatVideoKey(url: string): { file: string; format: string } | null {
	const m = url.match(/mpvideo\.qpic\.cn\/([0-9a-z]+)\.(f\d+)\.mp4/i);
	return m ? { file: m[1], format: m[2] } : null;
}

/** 从原文 HTML 里挑出所有视频地址（页面里有 &amp;、\x26amp; 两种转义）。 */
export function extractWechatVideoUrls(html: string): string[] {
	const urls = new Set<string>();
	for (const m of html.matchAll(/mpvideo\.qpic\.cn\/[0-9a-z]+\.f\d+\.mp4\?[^"'\s<>]+/gi)) {
		const url =
			"https://" +
			m[0]
				.replace(/\\x26amp;/g, "&")
				.replace(/\\x26/g, "&")
				.replace(/&amp;/g, "&")
				.replace(/\\$/, "");
		urls.add(url);
	}
	return [...urls];
}

/** 在原文里找同一个视频的新地址：编号相同，清晰度尽量一样。 */
export function pickFreshWechatUrl(staleUrl: string, candidates: string[]): string | null {
	const key = wechatVideoKey(staleUrl);
	if (!key) return null;
	const same = candidates.filter((u) => wechatVideoKey(u)?.file === key.file);
	return same.find((u) => wechatVideoKey(u)?.format === key.format) ?? same[0] ?? null;
}

const wechatVideo: Rule = {
	id: "wechat-video",
	name: "微信公众号视频",
	match: /^https?:\/\/mpvideo\.qpic\.cn\//i,
	headers: { Referer: "https://mp.weixin.qq.com/", "User-Agent": CHROME_UA },
	async refresh(staleUrl, ctx) {
		if (!ctx.pageUrl || !/^https?:\/\/mp\.weixin\.qq\.com\//.test(ctx.pageUrl)) return null;
		const page = await ctx.request({ url: ctx.pageUrl, headers: { "User-Agent": CHROME_UA } });
		if (page.status !== 200) return null;
		const html = new TextDecoder().decode(page.body);
		return pickFreshWechatUrl(staleUrl, extractWechatVideoUrls(html));
	},
};

export const RULES: Rule[] = [wechatVideo];

export function findRule(url: string, rules: Rule[] = RULES): Rule | null {
	return rules.find((r) => r.match.test(url)) ?? null;
}
