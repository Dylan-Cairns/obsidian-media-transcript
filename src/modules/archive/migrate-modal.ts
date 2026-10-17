import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { execute, formatBytes, MigrationPlan, scan } from "./migrate";
import type { ArchiveSettings } from "./settings";
import { t } from "../../i18n";

/**
 * Two-step modal:
 *   1. On open, run scan() and show stats so the user can sanity-check
 *      the plan before any file is touched.
 *   2. User picks Move / Copy / Cancel. Anything but Cancel runs execute().
 */
export class MigrateModal extends Modal {
	private plan: MigrationPlan | null = null;
	private deleteEmptyDirs = true;

	constructor(app: App, private settings: ArchiveSettings) {
		super(app);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: t("archive.migrateTitle") });

		const status = contentEl.createEl("p", { text: t("archive.migrateScanning") });

		try {
			this.plan = await scan(this.app, this.settings);
		} catch (e) {
			status.setText(t("archive.migrateScanFailed", { error: e instanceof Error ? e.message : String(e) }));
			return;
		}

		contentEl.empty();
		contentEl.createEl("h2", { text: t("archive.migratePlanTitle") });

		const dl = contentEl.createEl("dl");
		this.kv(dl, t("archive.migrateFilesToMigrate"), String(this.plan.moves.length));
		this.kv(dl, t("archive.migrateDuplicates"), String(this.plan.duplicates.length));
		this.kv(dl, t("archive.migrateTotalSize"), formatBytes(this.plan.totalBytes));
		this.kv(dl, t("archive.migrateDestination"), this.settings.centralArchivePath + "/");
		if (this.plan.failedLogs.length > 0) {
			this.kv(dl, t("archive.migrateFailedLogs"), String(this.plan.failedLogs.length));
		}
		if (this.plan.skippedNonHashed.length > 0) {
			this.kv(
				dl,
				t("archive.migrateSkippedNonHashed"),
				t("archive.migrateLeftInPlace", { count: this.plan.skippedNonHashed.length }),
			);
		}

		if (this.plan.moves.length === 0) {
			contentEl.createEl("p", {
				text: t("archive.migrateNothing"),
			});
			new Setting(contentEl).addButton((b) =>
				b
					.setButtonText(t("archive.buttonClose"))
					.setCta()
					.onClick(() => this.close()),
			);
			return;
		}

		const note = contentEl.createEl("p");
		note.createSpan({
			text: t("archive.migrateMoveCopyNote"),
		});

		new Setting(contentEl)
			.setName(t("archive.migrateDeleteEmptyName"))
			.setDesc(t("archive.migrateDeleteEmptyDesc"))
			.addToggle((toggle) =>
				toggle.setValue(this.deleteEmptyDirs).onChange((v) => (this.deleteEmptyDirs = v)),
			);

		const buttons = new Setting(contentEl);
		buttons.addButton((b: ButtonComponent) =>
			b.setButtonText(t("archive.buttonCancel")).onClick(() => this.close()),
		);
		buttons.addButton((b: ButtonComponent) =>
			b.setButtonText(t("archive.buttonCopy")).onClick(() => this.run({ deleteSource: false })),
		);
		buttons.addButton((b: ButtonComponent) =>
			b
				.setButtonText(t("archive.buttonMove"))
				.setWarning()
				.onClick(() => this.run({ deleteSource: true })),
		);
	}

	private async run(opts: { deleteSource: boolean }) {
		if (!this.plan) return;
		const total = this.plan.moves.length;

		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: t("archive.migrateRunning") });

		const progressLine = this.contentEl.createEl("p", { text: `0 / ${total}` });
		const bar = this.contentEl.createEl("progress");
		bar.max = total;
		bar.value = 0;
		bar.setCssStyles({ width: "100%" });

		const controller = new AbortController();
		const startedAt = performance.now();

		let cancelButton: ButtonComponent | null = null;
		const cancelRow = new Setting(this.contentEl).addButton((b: ButtonComponent) => {
			cancelButton = b;
			b.setButtonText(t("archive.buttonCancel")).setWarning().onClick(() => {
				controller.abort();
				b.setButtonText(t("archive.buttonCancelling")).setDisabled(true);
			});
		});

		const r = await execute(this.app, this.plan, this.settings, {
			deleteSource: opts.deleteSource,
			deleteEmptyDirs: this.deleteEmptyDirs,
			signal: controller.signal,
			onProgress: ({ done, total: planned, bytesProcessed }) => {
				bar.value = done;
				const elapsedSec = (performance.now() - startedAt) / 1000;
				const rate = elapsedSec > 0 ? bytesProcessed / elapsedSec : 0;
				progressLine.setText(
					t("archive.migrateProgress", { done, total: planned, bytes: formatBytes(bytesProcessed) }) +
						(rate > 0 ? t("archive.migrateRate", { rate: formatBytes(rate) }) : ""),
				);
			},
		});

		cancelRow.settingEl.remove();
		void cancelButton;

		const head = r.cancelled ? t("archive.migrateCancelled") : t("archive.migrateDone");
		this.contentEl.createEl("p", {
			text: t("archive.migrateResult", {
				head,
				moved: r.moved,
				skipped: r.skipped,
				errors: r.errors.length,
				dirs: r.emptyDirsRemoved,
				logs: r.failedLogMerged,
			}),
		});

		new Notice(
			r.cancelled
				? t("archive.noticeMigrateCancelled", { moved: r.moved })
				: t("archive.noticeMigrateComplete", { moved: r.moved, errors: r.errors.length }),
		);

		if (r.errors.length > 0) {
			const errBox = this.contentEl.createEl("details");
			errBox.createEl("summary", { text: t("archive.migrateErrorsSummary", { count: r.errors.length }) });
			const pre = errBox.createEl("pre");
			pre.setText(r.errors.map((e) => `${e.path}\n  ${e.error}`).join("\n\n"));
		}

		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText(t("archive.buttonClose"))
				.setCta()
				.onClick(() => this.close()),
		);
	}

	private kv(dl: HTMLElement, key: string, value: string) {
		dl.createEl("dt", { text: key });
		dl.createEl("dd", { text: value });
	}

	onClose() {
		this.contentEl.empty();
	}
}
