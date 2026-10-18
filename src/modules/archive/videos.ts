import { Menu, Notice, Platform, TFile, requestUrl, setIcon } from "obsidian";
import type ArchiveRedirectPlugin from "./main";
import { download } from "./downloader";
import { isVideoUrl } from "./policies";
import { resolve } from "./resolver";
import { extractUrls } from "./scanner";
import { storeFor } from "./store";
import { formatSize } from "../../utils/format";
import { t } from "../../i18n";

// A phone reads the whole file into memory to keep it: keep that to what it can hold.
const PHONE_MAX_BYTES = 500 * 1024 * 1024;
const VIDEO_TIMEOUT_MS = 30 * 60_000;

type State = "unknown" | "remote" | "downloading" | "archived";

/**
 * Videos linked from notes (`![](https://…/clip.mp4)`), shown as players with
 * a bar under each to keep a copy in the archive. Obsidian shows such a link
 * as an image that can't play, so the image is swapped for a <video>; the
 * archive's redirect then plays the archived copy once there is one.
 *
 * Videos are archived only when asked: on the device that asks, which uploads
 * the copy to the servers. The note is left as it is.
 */
export class VideoEmbeds {
	private states = new Map<string, State>();
	/** The bars on screen, by video URL, to update them all when one is downloaded. */
	private bars = new Map<string, Set<HTMLElement>>();

	constructor(private plugin: ArchiveRedirectPlugin) {}

	start(): void {
		const { plugin } = this;
		plugin.addCommand({
			id: "archive-download-videos",
			name: t("archive.commandDownloadVideos"),
			checkCallback: (checking) => {
				const file = plugin.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.downloadAll(file);
				return true;
			},
		});
		plugin.registerDomEvent(document, "contextmenu", (e) => {
			const box = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".mo-video");
			const url = box?.dataset.url;
			if (!box || !url) return;
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle(t("archive.videoDownload"))
					.setIcon("download")
					.setDisabled(this.states.get(url) !== "remote")
					.onClick(() => void this.downloadOne(url, box.dataset.note ?? "")),
			);
			menu.showAtMouseEvent(e);
			e.preventDefault();
		});
	}

	/**
	 * Turn the remote video links under `root` into players with a bar. In
	 * Reading mode the image is replaced; in Live Preview it belongs to the
	 * editor, so it is hidden and the player put before it.
	 */
	decorate(root: HTMLElement, sourcePath: string, inEditor: boolean): void {
		const found: HTMLElement[] = [];
		root.querySelectorAll<HTMLElement>("img, iframe.auto-embed").forEach((el) => {
			const url = el.getAttribute("src") ?? "";
			if (el.dataset.moVideo || !isVideoUrl(url)) return;
			found.push(el);
		});
		for (const el of found) {
			const url = el.getAttribute("src") ?? "";
			el.dataset.moVideo = "1";
			// Auto Embed shows such links in a frame of its own: one player is enough.
			const target = el.tagName === "IFRAME" ? (el.closest<HTMLElement>(".auto-embed") ?? el) : el;
			const box = createSpan({ cls: "mo-video" });
			box.dataset.url = url;
			box.dataset.note = sourcePath;
			const video = box.createEl("video", { attr: { controls: "", preload: "metadata", playsinline: "", referrerpolicy: "no-referrer", src: url } });
			video.dataset.moVideo = "1";
			box.appendChild(this.bar(url, sourcePath));
			target.parentElement?.insertBefore(box, target);
			if (inEditor || target !== el) target.addClass("mo-video-replaced");
			else el.remove();
		}
	}

	private bar(url: string, sourcePath: string): HTMLElement {
		const bar = createDiv({ cls: "mo-video-bar" });
		bar.dataset.note = sourcePath;
		let set = this.bars.get(url);
		if (!set) this.bars.set(url, (set = new Set()));
		set.add(bar);
		this.paint(bar, url);
		if (!this.states.has(url)) void this.check(url, sourcePath);
		return bar;
	}

	private paint(bar: HTMLElement, url: string): void {
		bar.empty();
		const state = this.states.get(url) ?? "unknown";
		if (state === "unknown") return;
		if (state === "archived") {
			const label = bar.createSpan({ cls: "mo-video-status" });
			setIcon(label.createSpan({ cls: "mo-video-icon" }), "check");
			label.appendText(t("archive.videoArchived"));
			return;
		}
		const button = bar.createEl("button", { cls: "mo-video-button" });
		setIcon(button.createSpan({ cls: "mo-video-icon" }), "download");
		button.appendText(state === "downloading" ? t("archive.videoDownloading") : t("archive.videoDownload"));
		button.disabled = state === "downloading";
		button.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			void this.downloadOne(url, bar.dataset.note ?? "");
		});
	}

	private setState(url: string, state: State): void {
		this.states.set(url, state);
		const set = this.bars.get(url);
		if (!set) return;
		for (const bar of [...set]) {
			if (!bar.isConnected) set.delete(bar);
			else this.paint(bar, url);
		}
	}

	private async check(url: string, sourcePath: string): Promise<void> {
		this.states.set(url, "unknown");
		this.setState(url, (await this.isArchived(url, sourcePath)) ? "archived" : "remote");
	}

	private async isArchived(url: string, sourcePath: string): Promise<boolean> {
		const { plugin } = this;
		const local = storeFor(plugin.app.vault, resolve(url, sourcePath, plugin.settings));
		if (local && (await local.store.exists(local.path))) return true;
		return plugin.servers.storedAnywhere(url);
	}

	/** Archive the video at `url`; true if it is archived now. */
	async downloadOne(url: string, sourcePath: string, quiet = false): Promise<boolean> {
		const { plugin } = this;
		if (this.states.get(url) === "downloading") return false;
		if (Platform.isMobile) {
			const size = await contentLength(url);
			if (size !== null && size > PHONE_MAX_BYTES) {
				new Notice(t("archive.videoTooBigPhone", { size: formatSize(size) }), 10000);
				return false;
			}
		}
		this.setState(url, "downloading");
		const progress = quiet ? null : new Notice(t("archive.videoDownloading"), 0);
		try {
			const dest = resolve(url, sourcePath, plugin.settings);
			const r = await download(url, dest, plugin.app.vault, plugin.settings, plugin.servers, {
				onDemand: true,
				timeoutMs: VIDEO_TIMEOUT_MS,
			});
			const ok = r === "downloaded" || r === "skipped-exists";
			this.setState(url, ok ? "archived" : "remote");
			if (!quiet) new Notice(ok ? t("archive.noticeVideoArchived") : t("archive.noticeVideoFailed", { reason: r }));
			return ok;
		} catch (e) {
			this.setState(url, "remote");
			new Notice(t("archive.noticeVideoFailed", { reason: e instanceof Error ? e.message : String(e) }));
			return false;
		} finally {
			progress?.hide();
		}
	}

	async downloadAll(file: TFile): Promise<void> {
		const urls = extractUrls(await this.plugin.app.vault.read(file)).filter(isVideoUrl);
		if (urls.length === 0) {
			new Notice(t("archive.noticeNoVideos"));
			return;
		}
		const progress = new Notice(t("archive.noticeVideosStart", { total: urls.length }), 0);
		let ok = 0;
		for (const url of urls) {
			if (await this.downloadOne(url, file.path, true)) ok++;
		}
		progress.hide();
		new Notice(t("archive.noticeVideosDone", { ok, total: urls.length }));
	}
}

/** The size the server gives for `url`, or null if it doesn't say. */
async function contentLength(url: string): Promise<number | null> {
	try {
		const r = await requestUrl({ url, method: "HEAD", throw: false });
		const header = Object.entries(r.headers).find(([k]) => k.toLowerCase() === "content-length")?.[1];
		const n = header ? Number(header) : NaN;
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}
