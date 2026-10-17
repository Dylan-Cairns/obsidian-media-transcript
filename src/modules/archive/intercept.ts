import { App, Platform, TFile } from "obsidian";
import { resolve, sourceCandidates } from "./resolver";
import type { ArchiveServers } from "./servers";
import { desktopNode } from "./store";
import { expandHome, isExternalPath, type ArchiveSettings } from "./settings";

/**
 * Walk an element's media nodes (img/video/audio/source) and point each remote
 * src at its archived copies, in source order: each copy that fails to
 * load hands over to the next, and the remote URL comes last.
 */
export async function redirectAllMedia(
	root: HTMLElement,
	sourcePath: string,
	settings: ArchiveSettings,
	app: App,
	servers: ArchiveServers,
): Promise<number> {
	const nodes: { node: HTMLElement; url: string }[] = [];
	root.querySelectorAll<HTMLElement>("img, video, audio, source").forEach((node) => {
		const src = node.getAttribute("src");
		// data-archive-src is the src we last set; anything else (a fresh render,
		// or Live Preview putting the remote URL back) is ours to redirect.
		if (!src || !src.startsWith("http") || node.dataset.archiveSrc === src) return;
		node.dataset.archiveSrc = src; // claimed: later passes skip it while we wait below
		nodes.push({ node, url: src });
	});
	if (nodes.length === 0) return 0;

	const up = await servers.check();
	let swapped = 0;
	for (const { node, url } of nodes) {
		if (node.getAttribute("src") !== url) continue; // re-rendered while we waited
		const copies = sourceCandidates(url, settings.sources, localSrc(url, sourcePath, settings, app), (s) => !!up.get(s));
		if (copies.length === 0) {
			delete node.dataset.archiveSrc; // not archived yet: look again next pass
			continue;
		}
		show(node, [...copies, url], 0);
		swapped++;
	}
	return swapped;
}

function show(node: HTMLElement, sources: string[], i: number): void {
	node.dataset.archiveSrc = sources[i];
	node.setAttribute("src", sources[i]);
	node.onerror = i + 1 < sources.length ? () => show(node, sources, i + 1) : null;
	// A <source> is only re-read when its media element loads again.
	if (node.tagName === "SOURCE") (node.parentElement as HTMLMediaElement | null)?.load?.();
}

/** The local archive's copy of `url` as a loadable src, or null if it isn't archived. */
function localSrc(url: string, sourcePath: string, settings: ArchiveSettings, app: App): string | null {
	const path = resolve(url, sourcePath, settings);
	if (isExternalPath(path)) {
		const node = desktopNode();
		if (!node) return null; // mobile: a folder outside the vault can't be read
		const abs = expandHome(path, node.os.homedir());
		if (!node.fs.existsSync(abs)) return null;
		// Obsidian serves local files under its own resource scheme, as getResourcePath does in the vault.
		return Platform.resourcePathPrefix + abs.replace(/^\//, "").split("/").map(encodeURIComponent).join("/");
	}
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? app.vault.getResourcePath(file) : null;
}
