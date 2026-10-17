import { App, Notice, Setting } from "obsidian";
import { ModuleSettingTab } from "../module";
import type ArchiveRedirectPlugin from "./main";
import { isExternalPath, normalizeServerUrl, type ArchiveMode, type ArchiveSource } from "./settings";
import { findStaleCentralArchives, reconcile } from "./reconcile.ts";

export class ArchiveSettingTab extends ModuleSettingTab {
	constructor(app: App, private plugin: ArchiveRedirectPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Archive mode")
			.setDesc(
				"Sibling: each Markdown file gets its own _archive subfolder next to it. " +
					"Central: one shared folder at the vault root holds every cached file, deduped across notes.",
			)
			.addDropdown((dd) => {
				dd.addOption("sibling", "Sibling (per-note folder)");
				dd.addOption("central", "Central (one shared folder)");
				dd.setValue(this.plugin.settings.archiveMode).onChange(async (value) => {
					this.plugin.settings.archiveMode = value as ArchiveMode;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.archiveMode === "sibling") {
			new Setting(containerEl)
				.setName("Archive directory name")
				.setDesc("Subdirectory (sibling to each Markdown file) that holds cached resources.")
				.addText((text) =>
					text.setValue(this.plugin.settings.archiveDirName).onChange(async (value) => {
						this.plugin.settings.archiveDirName = value || "_archive";
						await this.plugin.saveSettings();
					}),
				);
		} else {
			new Setting(containerEl)
				.setName("Central archive path")
				.setDesc(
					"Folder that holds all cached files: vault-relative, or an absolute path " +
						"(or ~/…) outside the vault. " +
						"Files are bucketed by hash prefix (e.g. _archive/ab/abcd1234….jpg).",
				)
				.addText((text) =>
					text
						.setPlaceholder("_archive")
						.setValue(this.plugin.settings.centralArchivePath)
						.onChange(async (value) => {
							this.plugin.settings.centralArchivePath =
								value.trim().replace(/\/+$/, "") || "_archive";
							await this.plugin.saveSettings();
						}),
				);

			if (!isExternalPath(this.plugin.settings.centralArchivePath)) this.renderInVaultTools(containerEl);
		}

		this.renderSources(containerEl);
		this.renderRest(containerEl);
	}

	private renderInVaultTools(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Migrate sibling archives")
			.setDesc(
				"Find every per-note sibling archive folder in this vault and move (or copy) " +
					"its files into the central path above. Opens a preview before any file is touched.",
			)
			.addButton((b) =>
				b
					.setButtonText("Migrate now…")
					.setCta()
					.onClick(() => this.plugin.openMigrateModal()),
			);

		this.renderStaleArchives(containerEl);
	}

	private renderSources(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Sources")
			.setHeading()
			.setDesc(
				"Where archived copies are shown from, first choice first. A copy that fails to load " +
					"(server off, file not there yet) hands over to the next; the original URL comes last. " +
					"New downloads are saved to the local archive and uploaded to every server; a server " +
					"that can't be reached gets them once it's back.",
			);

		const sources = this.plugin.settings.sources;
		const save = async () => {
			await this.plugin.saveSettings();
			this.display();
		};
		sources.forEach((source, i) => {
			const row = new Setting(containerEl)
				.setName(source.kind === "local" ? "Local archive" : source.url)
				.setDesc(source.kind === "local" ? this.localLabel() : "Server (WebDAV)");
			row.addExtraButton((b) =>
				b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(async () => {
					[sources[i - 1], sources[i]] = [sources[i], sources[i - 1]];
					await save();
				}),
			);
			row.addExtraButton((b) =>
				b.setIcon("arrow-down").setTooltip("Move down").setDisabled(i === sources.length - 1).onClick(async () => {
					[sources[i + 1], sources[i]] = [sources[i], sources[i + 1]];
					await save();
				}),
			);
			// The local archive always stays: new downloads are kept there too.
			if (source.kind === "server") {
				row.addExtraButton((b) =>
					b.setIcon("trash").setTooltip("Remove").onClick(async () => {
						sources.splice(i, 1);
						delete this.plugin.settings.pendingUploads[source.url];
						await save();
					}),
				);
			}
		});

		let draft = "";
		new Setting(containerEl)
			.setName("Add server")
			.setDesc("WebDAV folder laid out like the central archive (<url>/ab/abcd1234….jpg), readable and writable.")
			.addText((text) => text.setPlaceholder("WebDAV folder URL").onChange((v) => (draft = v)))
			.addButton((b) =>
				b.setButtonText("Add").onClick(async () => {
					const url = normalizeServerUrl(draft);
					if (!/^https?:\/\//.test(url)) {
						new Notice("Enter the server's http(s) address.");
						return;
					}
					if (sources.some((s) => s.kind === "server" && s.url === url)) return;
					const server: ArchiveSource = { kind: "server", url };
					sources.unshift(server);
					await save();
				}),
			);

		const pending = this.plugin.servers.pendingCount();
		if (pending > 0) {
			new Setting(containerEl)
				.setName("Waiting to upload")
				.setDesc(`${pending} file(s) are saved locally but not on every server yet.`)
				.addButton((b) =>
					b.setButtonText("Upload now").onClick(async () => {
						await this.plugin.servers.flushAll();
						const left = this.plugin.servers.pendingCount();
						new Notice(left ? `${left} file(s) still waiting: server not reachable.` : "All uploaded.");
						this.display();
					}),
				);
		}
	}

	private localLabel(): string {
		const s = this.plugin.settings;
		return s.archiveMode === "central" ? s.centralArchivePath : `<note folder>/${s.archiveDirName}`;
	}

	private renderStaleArchives(containerEl: HTMLElement): void {
		const stale = findStaleCentralArchives(this.app, this.plugin.settings.centralArchivePath);
		if (stale.length === 0) return;

		const target = this.plugin.settings.centralArchivePath;
		const intro = new Setting(containerEl)
			.setName("⚠ Stale central archives detected")
			.setDesc(
				`These folders contain the Archive Redirect marker but are not at the current central path (${target}). ` +
					"They were likely created by a previous setting and are no longer being served. Move each one to the current path:",
			);
		intro.settingEl.setCssStyles({ borderTop: "1px solid var(--background-modifier-border)" });

		for (const s of stale) {
			new Setting(containerEl)
				.setName(s.folderPath + "/")
				.setDesc(`Move into ${target}/`)
				.addButton((b) =>
					b
						.setButtonText("Move here")
						.setWarning()
						.onClick(async () => {
							const r = await reconcile(this.app, s.folderPath, target);
							if (r.ok) {
								new Notice(`Moved ${r.from} → ${r.to}`);
								this.display();
							} else {
								const tail = "detail" in r && r.detail ? `: ${r.detail}` : "";
								new Notice(`Reconcile failed (${r.reason})${tail}`);
							}
						}),
				);
		}
	}

	private renderRest(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Auto-archive on file modify")
			.setDesc("Scan and download new remote resources whenever a Markdown file is modified.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoArchiveOnModify).onChange(async (value) => {
					this.plugin.settings.autoArchiveOnModify = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Included paths")
			.setDesc("Only archive files under these vault-relative paths (one per line). Empty = entire vault.")
			.addTextArea((ta) => {
				ta.setValue(this.plugin.settings.includedPaths.join("\n"));
				ta.onChange(async (value) => {
					this.plugin.settings.includedPaths = value
						.split("\n")
						.map((s) => s.trim().replace(/\/+$/, ""))
						.filter((s) => s.length > 0);
					await this.plugin.saveSettings();
				});
				ta.inputEl.rows = 4;
				ta.inputEl.cols = 30;
			});
	}
}
