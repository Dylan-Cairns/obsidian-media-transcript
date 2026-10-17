export function extractUrls(md: string): string[] {
	const urls = new Set<string>();

	for (const m of md.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)/g)) {
		urls.add(m[1]);
	}

	for (const m of md.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)/g)) {
		urls.add(m[1]);
	}

	return [...urls];
}
