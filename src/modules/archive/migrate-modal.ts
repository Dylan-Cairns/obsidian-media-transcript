import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { execute, formatBytes, MigrationPlan, scan } from "./migrate";
import type { ArchiveSettings } from "./settings";

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
		contentEl.createEl("h2", { text: "Migrate sibling archives → central" });

		const status = contentEl.createEl("p", { text: "Scanning vault…" });

		try {
			this.plan = await scan(this.app, this.settings);
		} catch (e) {
			status.setText(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		contentEl.empty();
		contentEl.createEl("h2", { text: "Migration plan" });

		const dl = contentEl.createEl("dl");
		this.kv(dl, "Files to migrate", String(this.plan.moves.length));
		this.kv(dl, "Duplicates (will skip)", String(this.plan.duplicates.length));
		this.kv(dl, "Total size", formatBytes(this.plan.totalBytes));
		this.kv(dl, "Destination", this.settings.centralArchivePath + "/");
		if (this.plan.failedLogs.length > 0) {
			this.kv(dl, ".failed.jsonl logs to merge", String(this.plan.failedLogs.length));
		}
		if (this.plan.skippedNonHashed.length > 0) {
			this.kv(
				dl,
				"Skipped (not SHA1-named)",
				`${this.plan.skippedNonHashed.length} (left in place)`,
			);
		}

		if (this.plan.moves.length === 0) {
			contentEl.createEl("p", {
				text: "Nothing to migrate. All cached files are already in the central archive (or none exist).",
			});
			new Setting(contentEl).addButton((b) =>
				b
					.setButtonText("Close")
					.setCta()
					.onClick(() => this.close()),
			);
			return;
		}

		const note = contentEl.createEl("p");
		note.createSpan({
			text:
				"Move: rename files (fast, atomic, removes originals). " +
				"Copy: write to central and keep originals as backup (you delete them later).",
		});

		new Setting(contentEl)
			.setName("Also delete empty sibling _archive folders")
			.setDesc("Only applies to Move. Empty folders are sent to system trash.")
			.addToggle((t) =>
				t.setValue(this.deleteEmptyDirs).onChange((v) => (this.deleteEmptyDirs = v)),
			);

		const buttons = new Setting(contentEl);
		buttons.addButton((b: ButtonComponent) =>
			b.setButtonText("Cancel").onClick(() => this.close()),
		);
		buttons.addButton((b: ButtonComponent) =>
			b.setButtonText("Copy").onClick(() => this.run({ deleteSource: false })),
		);
		buttons.addButton((b: ButtonComponent) =>
			b
				.setButtonText("Move")
				.setWarning()
				.onClick(() => this.run({ deleteSource: true })),
		);
	}

	private async run(opts: { deleteSource: boolean }) {
		if (!this.plan) return;
		const total = this.plan.moves.length;

		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Migrating…" });

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
			b.setButtonText("Cancel").setWarning().onClick(() => {
				controller.abort();
				b.setButtonText("Cancelling…").setDisabled(true);
			});
		});

		const r = await execute(this.app, this.plan, this.settings, {
			deleteSource: opts.deleteSource,
			deleteEmptyDirs: this.deleteEmptyDirs,
			signal: controller.signal,
			onProgress: ({ done, total: t, bytesProcessed }) => {
				bar.value = done;
				const elapsedSec = (performance.now() - startedAt) / 1000;
				const rate = elapsedSec > 0 ? bytesProcessed / elapsedSec : 0;
				progressLine.setText(
					`${done} / ${t}  •  ${formatBytes(bytesProcessed)} processed` +
						(rate > 0 ? `  •  ${formatBytes(rate)}/s` : ""),
				);
			},
		});

		cancelRow.settingEl.remove();
		void cancelButton;

		const head = r.cancelled ? "Cancelled" : "Done";
		this.contentEl.createEl("p", {
			text:
				`${head}. Moved ${r.moved}, skipped ${r.skipped}, errors ${r.errors.length}. ` +
				`Empty dirs removed: ${r.emptyDirsRemoved}. ` +
				`.failed.jsonl files merged: ${r.failedLogMerged}.`,
		});

		new Notice(
			r.cancelled
				? `Archive Redirect: migration cancelled (${r.moved} files moved before cancel).`
				: `Archive Redirect: migration complete (${r.moved} moved, ${r.errors.length} errors).`,
		);

		if (r.errors.length > 0) {
			const errBox = this.contentEl.createEl("details");
			errBox.createEl("summary", { text: `${r.errors.length} errors (click to expand)` });
			const pre = errBox.createEl("pre");
			pre.setText(r.errors.map((e) => `${e.path}\n  ${e.error}`).join("\n\n"));
		}

		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText("Close")
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
