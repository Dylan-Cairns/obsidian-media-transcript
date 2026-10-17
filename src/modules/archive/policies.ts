export interface DomainPolicy {
	match: RegExp;
	archive: boolean;
	referer?: string;
	reason?: string;
}

export const DEFAULT_POLICIES: DomainPolicy[] = [
	{ match: /mmbiz\.qpic\.cn/, archive: true, referer: "https://mp.weixin.qq.com/" },
	{ match: /res\.wx\.qq\.com/, archive: true, referer: "https://mp.weixin.qq.com/" },
	{ match: /mmbiz\.qlogo\.cn/, archive: true, referer: "https://mp.weixin.qq.com/" },
	{ match: /pbs\.twimg\.com/, archive: true },
	{ match: /video\.twimg\.com/, archive: false, reason: "large videos, Twitter CDN is stable" },
	{ match: /youtube\.com|youtu\.be/, archive: false, reason: "stream-only" },
	{ match: /vimeo\.com/, archive: false, reason: "stream-only" },
];

const MEDIA_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|mp4|webm|m4v|mov|mp3|m4a|wav|ogg|flac|pdf)(\?|$|#)/i;

export function matchPolicy(url: string, policies: DomainPolicy[] = DEFAULT_POLICIES): DomainPolicy {
	// 1. 显式域名规则优先
	for (const p of policies) {
		if (p.match.test(url)) return p;
	}
	// 2. 没匹中：只有看起来是媒体扩展名才 archive（避免吞掉页面 URL）
	return { match: /.*/, archive: MEDIA_EXT_RE.test(url) };
}
