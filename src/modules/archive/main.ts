import { MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import { ModulePlugin } from "../module";
import { resolve } from "./resolver";
import { extractUrls } from "./scanner";
import { download, DownloadResult, writeFile } from "./downloader";
import { ArchiveSettings, DEFAULT_SETTINGS, isExternalPath, isInScope, migrateSources } from "./settings";
import { ArchiveSettingTab } from "./settings-ui";
import { redirectAllMedia } from "./intercept";
import { createLivePreviewExtension } from "./live-preview";
import { MigrateModal } from "./migrate-modal";
import { findStaleCentralArchives, reconcile } from "./reconcile.ts";
import { ArchiveServers } from "./servers";
import { storeFor } from "./store";
import { t } from "../../i18n";

export default class ArchiveRedirectPlugin extends ModulePlugin {
	settings!: ArchiveSettings;
	readonly servers = new ArchiveServers(this);

	async start() {
		await this.loadSettings();
		// Ask the servers now, so the first note rendered doesn't wait for the answer;
		// one that answers also gets the files that were waiting for it.
		void this.servers.check();
		this.registerInterval(window.setInterval(() => void this.servers.flushAll(), 10 * 60_000));

		// Reading mode
		this.registerMarkdownPostProcessor((el, ctx) => this.interceptMedia(el, ctx));

		// Live Preview / Source mode (CM6)
		this.registerEditorExtension(createLivePreviewExtension(this));

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (!this.settings.autoArchiveOnModify) return;
				if (!(file instanceof TFile) || file.extension !== "md") return;
				if (!isInScope(file.path, this.settings.includedPaths)) return;
				await this.archiveMd(file);
			}),
		);

		this.addCommand({
			id: "archive-scan-vault",
			name: t("archive.commandScanVault"),
			callback: () => this.scanAll(),
		});

		this.addCommand({
			id: "archive-migrate-sibling-to-central",
			name: t("archive.commandMigrate"),
			callback: () => this.openMigrateModal(),
		});

		this.addCommand({
			id: "archive-reconcile-stale-central",
			name: t("archive.commandReconcile"),
			callback: () => this.reconcileStaleArchives(),
		});

		this.addSettingTab(new ArchiveSettingTab(this.app, this));
	}

	/** Migrate and reconcile move folders within the vault, so they need the central path there too. */
	centralPathInVault(): boolean {
		if (!isExternalPath(this.settings.centralArchivePath)) return true;
		new Notice(t("archive.noticeCentralOutsideVault"));
		return false;
	}

	openMigrateModal() {
		if (!this.centralPathInVault()) return;
		new MigrateModal(this.app, this.settings).open();
	}

	private async reconcileStaleArchives() {
		if (!this.centralPathInVault()) return;
		const target = this.settings.centralArchivePath;
		const stale = findStaleCentralArchives(this.app, target);
		if (stale.length === 0) {
			new Notice(t("archive.noticeNoStale"));
			return;
		}
		let okCount = 0;
		const failures: string[] = [];
		for (const s of stale) {
			const r = await reconcile(this.app, s.folderPath, target);
			if (r.ok) {
				okCount++;
			} else {
				const tail = "detail" in r && r.detail ? `: ${r.detail}` : "";
				failures.push(`${s.folderPath} (${r.reason})${tail}`);
			}
		}
		const summary = t("archive.noticeReconciled", { ok: okCount, total: stale.length, target }) +
			(failures.length ? t("archive.noticeReconcileFailures", { failures: failures.join("; ") }) : "");
		new Notice(summary);
	}

	private interceptMedia(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// Not awaited: Obsidian holds the whole note back until a returned promise
		// settles, and the server check behind it can take seconds, or longer in a
		// background window. Images are swapped once it answers.
		void redirectAllMedia(el, ctx.sourcePath, this.settings, this.app, this.servers);
	}

	private async archiveMd(file: TFile): Promise<{ ok: number; transient: number; permanent: number }> {
		const content = await this.app.vault.read(file);
		const urls = extractUrls(content);
		let ok = 0;
		let transient = 0;
		let permanent = 0;
		for (const url of urls) {
			const dest = resolve(url, file.path, this.settings);
			try {
				const r: DownloadResult = await download(url, dest, this.app.vault, this.settings, this.servers);
				if (r === "downloaded") ok++;
				else if (r === "failed-transient") transient++;
				else if (r === "failed-permanent") permanent++;
			} catch (e: unknown) {
				transient++;
				const msg = e instanceof Error ? e.message : String(e);
				console.warn(`[archive-redirect] ${file.path} ← ${url}: ${msg}`);
			}
		}
		return { ok, transient, permanent };
	}

	private async scanAll() {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => isInScope(f.path, this.settings.includedPaths));
		const scopeNote = this.settings.includedPaths.length
			? t("archive.noticeScanScope", { paths: this.settings.includedPaths.join(", ") })
			: "";
		new Notice(t("archive.noticeScanStart", { count: files.length, scope: scopeNote }));
		let totalOk = 0;
		let totalTransient = 0;
		let totalPermanent = 0;
		let processed = 0;
		for (const f of files) {
			const { ok, transient, permanent } = await this.archiveMd(f);
			totalOk += ok;
			totalTransient += transient;
			totalPermanent += permanent;
			processed++;
			if (processed % 25 === 0) {
				console.debug(
					`[archive-redirect] ${processed}/${files.length}  (+${totalOk} ok, ${totalTransient} transient, ${totalPermanent} permanent)`,
				);
			}
		}
		new Notice(
			t("archive.noticeScanDone", { ok: totalOk, transient: totalTransient, permanent: totalPermanent }),
		);
	}

	async loadSettings() {
		// Saved settings from any earlier version: the current fields, plus 0.6.0's serverUrl/sourceOrder.
		const raw = ((await this.loadData()) ?? {}) as Partial<ArchiveSettings> & { serverUrl?: unknown; sourceOrder?: unknown; pendingUploads?: unknown };
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
		// Migration: pre-v0.5 configs only had `archiveDirName`. Seed the new central
		// path with that value so a user who later flips to "central" mode keeps the
		// folder name they had been using, instead of getting a fresh "_archive".
		if (raw.archiveDirName && raw.centralArchivePath === undefined) {
			this.settings.centralArchivePath = raw.archiveDirName;
		}
		this.settings.sources = migrateSources(raw);
		delete (this.settings as { serverUrl?: unknown }).serverUrl;
		delete (this.settings as { sourceOrder?: unknown }).sourceOrder;
		// Earlier versions kept the upload queue here, in data.json, which Sync shares.
		const legacy = (this.settings as { pendingUploads?: Record<string, string[]> }).pendingUploads;
		delete (this.settings as { pendingUploads?: unknown }).pendingUploads;
		if (legacy && Object.keys(legacy).length) {
			this.servers.adopt(legacy);
			await this.saveSettings();
		}
	}

	async writeLocal(path: string, buf: ArrayBuffer): Promise<void> {
		const local = storeFor(this.app.vault, path);
		if (local) await writeFile(local, this.app.vault, this.settings, path, buf);
	}

	async removeLocal(path: string): Promise<void> {
		const local = storeFor(this.app.vault, path);
		if (local && (await local.store.exists(local.path))) await local.store.remove(local.path);
	}

	async readLocal(path: string): Promise<ArrayBuffer | null> {
		const local = storeFor(this.app.vault, path);
		return local && (await local.store.exists(local.path)) ? local.store.readBinary(local.path) : null;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
