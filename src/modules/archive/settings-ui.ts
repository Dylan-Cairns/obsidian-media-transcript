import { App, Notice, Setting } from "obsidian";
import { ModuleSettingTab } from "../module";
import type ArchiveRedirectPlugin from "./main";
import { isExternalPath, normalizeServerUrl, serverUrls, type ArchiveMode, type ArchiveSource } from "./settings";
import { findStaleCentralArchives, reconcile } from "./reconcile.ts";
import { t } from "../../i18n";

export class ArchiveSettingTab extends ModuleSettingTab {
	constructor(app: App, private plugin: ArchiveRedirectPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t("archive.settingMode"))
			.setDesc(t("archive.settingModeDesc"))
			.addDropdown((dd) => {
				dd.addOption("sibling", t("archive.modeSibling"));
				dd.addOption("central", t("archive.modeCentral"));
				dd.setValue(this.plugin.settings.archiveMode).onChange(async (value) => {
					this.plugin.settings.archiveMode = value as ArchiveMode;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.archiveMode === "sibling") {
			new Setting(containerEl)
				.setName(t("archive.settingDirName"))
				.setDesc(t("archive.settingDirNameDesc"))
				.addText((text) =>
					text.setValue(this.plugin.settings.archiveDirName).onChange(async (value) => {
						this.plugin.settings.archiveDirName = value || "_archive";
						await this.plugin.saveSettings();
					}),
				);
		} else {
			new Setting(containerEl)
				.setName(t("archive.settingCentralPath"))
				.setDesc(t("archive.settingCentralPathDesc"))
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
			.setName(t("archive.settingMigrate"))
			.setDesc(t("archive.settingMigrateDesc"))
			.addButton((b) =>
				b
					.setButtonText(t("archive.buttonMigrateNow"))
					.setCta()
					.onClick(() => this.plugin.openMigrateModal()),
			);

		this.renderStaleArchives(containerEl);
	}

	private renderSources(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t("archive.settingSources"))
			.setHeading()
			.setDesc(t("archive.settingSourcesDesc"));

		const sources = this.plugin.settings.sources;
		const save = async () => {
			await this.plugin.saveSettings();
			this.display();
		};
		sources.forEach((source, i) => {
			const row = new Setting(containerEl)
				.setName(source.kind === "local" ? t("archive.sourceLocal") : source.url)
				.setDesc(source.kind === "local" ? this.localLabel() : t("archive.sourceServer"));
			row.addExtraButton((b) =>
				b.setIcon("arrow-up").setTooltip(t("archive.tooltipMoveUp")).setDisabled(i === 0).onClick(async () => {
					[sources[i - 1], sources[i]] = [sources[i], sources[i - 1]];
					await save();
				}),
			);
			row.addExtraButton((b) =>
				b.setIcon("arrow-down").setTooltip(t("archive.tooltipMoveDown")).setDisabled(i === sources.length - 1).onClick(async () => {
					[sources[i + 1], sources[i]] = [sources[i], sources[i + 1]];
					await save();
				}),
			);
			// The local archive always stays: new downloads are kept there too.
			if (source.kind === "server") {
				row.addExtraButton((b) =>
					b.setIcon("trash").setTooltip(t("archive.tooltipRemove")).onClick(async () => {
						sources.splice(i, 1);
						this.plugin.servers.forget(source.url);
						await save();
					}),
				);
			}
		});

		let draft = "";
		new Setting(containerEl)
			.setName(t("archive.settingAddServer"))
			.setDesc(t("archive.settingAddServerDesc"))
			.addText((text) => text.setPlaceholder(t("archive.placeholderServerUrl")).onChange((v) => (draft = v)))
			.addButton((b) =>
				b.setButtonText(t("archive.buttonAdd")).onClick(async () => {
					const url = normalizeServerUrl(draft);
					if (!/^https?:\/\//.test(url)) {
						new Notice(t("archive.noticeEnterServerUrl"));
						return;
					}
					if (sources.some((s) => s.kind === "server" && s.url === url)) return;
					const server: ArchiveSource = { kind: "server", url };
					sources.unshift(server);
					await save();
				}),
			);

		if (serverUrls(sources).length > 0) {
			new Setting(containerEl)
				.setName(t("archive.settingKeepLocal"))
				.setDesc(t("archive.settingKeepLocalDesc"))
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.keepLocalCopies).onChange(async (v) => {
						this.plugin.settings.keepLocalCopies = v;
						await this.plugin.saveSettings();
					}),
				);
		}

		const pending = this.plugin.servers.pendingCount();
		if (pending > 0) {
			new Setting(containerEl)
				.setName(t("archive.settingWaitingUpload"))
				.setDesc(
					t(pending === 1 ? "archive.settingWaitingUploadDescOne" : "archive.settingWaitingUploadDescMany", { count: pending }),
				)
				.addButton((b) =>
					b.setButtonText(t("archive.buttonUploadNow")).onClick(async () => {
						await this.plugin.servers.flushAll();
						const left = this.plugin.servers.pendingCount();
						new Notice(
							left
								? t(left === 1 ? "archive.noticeStillWaitingOne" : "archive.noticeStillWaitingMany", { count: left })
								: t("archive.noticeAllUploaded"),
						);
						this.display();
					}),
				);
		}
	}

	private localLabel(): string {
		const s = this.plugin.settings;
		return s.archiveMode === "central" ? s.centralArchivePath : t("archive.localNoteFolder", { dir: s.archiveDirName });
	}

	private renderStaleArchives(containerEl: HTMLElement): void {
		const stale = findStaleCentralArchives(this.app, this.plugin.settings.centralArchivePath);
		if (stale.length === 0) return;

		const target = this.plugin.settings.centralArchivePath;
		const intro = new Setting(containerEl)
			.setName(t("archive.settingStale"))
			.setDesc(t("archive.settingStaleDesc", { target }));
		intro.settingEl.setCssStyles({ borderTop: "1px solid var(--background-modifier-border)" });

		for (const s of stale) {
			new Setting(containerEl)
				.setName(s.folderPath + "/")
				.setDesc(t("archive.staleMoveInto", { target }))
				.addButton((b) =>
					b
						.setButtonText(t("archive.buttonMoveHere"))
						.setWarning()
						.onClick(async () => {
							const r = await reconcile(this.app, s.folderPath, target);
							if (r.ok) {
								new Notice(t("archive.noticeMoved", { from: r.from, to: r.to }));
								this.display();
							} else {
								const tail = "detail" in r && r.detail ? `: ${r.detail}` : "";
								new Notice(t("archive.noticeReconcileFailed", { reason: r.reason, detail: tail }));
							}
						}),
				);
		}
	}

	private renderRest(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t("archive.settingAutoArchive"))
			.setDesc(t("archive.settingAutoArchiveDesc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoArchiveOnModify).onChange(async (value) => {
					this.plugin.settings.autoArchiveOnModify = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(t("archive.settingIncludedPaths"))
			.setDesc(t("archive.settingIncludedPathsDesc"))
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
