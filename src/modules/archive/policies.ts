export interface DomainPolicy {
	match: RegExp;
	/** Archived on its own, when a note is scanned. */
	archive: boolean;
	/** Archived when asked for (a video's download button), though not on a scan. */
	onDemand?: boolean;
	referer?: string;
	reason?: string;
}

export const DEFAULT_POLICIES: DomainPolicy[] = [
	{ match: /mmbiz\.qpic\.cn/, archive: true, referer: "https://mp.weixin.qq.com/" },
	{ match: /res\.wx\.qq\.com/, archive: true, referer: "https://mp.weixin.qq.com/" },
	{ match: /mmbiz\.qlogo\.cn/, archive: true, referer: "https://mp.weixin.qq.com/" },
	{ match: /pbs\.twimg\.com/, archive: true },
	{ match: /video\.twimg\.com/, archive: false, onDemand: true, reason: "large videos: archived when asked" },
	{ match: /youtube\.com|youtu\.be/, archive: false, reason: "stream-only" },
	{ match: /vimeo\.com/, archive: false, reason: "stream-only" },
];

const MEDIA_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|mp3|m4a|wav|ogg|flac|pdf)(\?|$|#)/i;
const VIDEO_EXT_RE = /\.(mp4|webm|m4v|mov)(\?|$|#)/i;

/** A link to a video file, which a note shows as a player. */
export function isVideoUrl(url: string): boolean {
	return /^https?:\/\//i.test(url) && VIDEO_EXT_RE.test(url);
}

export function matchPolicy(url: string, policies: DomainPolicy[] = DEFAULT_POLICIES): DomainPolicy {
	// 1. 显式域名规则优先
	for (const p of policies) {
		if (p.match.test(url)) return p;
	}
	// 2. 视频体积大：点了下载才存，扫描时不存
	if (VIDEO_EXT_RE.test(url)) return { match: /.*/, archive: false, onDemand: true };
	// 3. 没匹中：只有看起来是媒体扩展名才 archive（避免吞掉页面 URL）
	return { match: /.*/, archive: MEDIA_EXT_RE.test(url) };
}
