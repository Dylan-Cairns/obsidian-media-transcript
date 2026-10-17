import { App, Setting } from 'obsidian';
import { ModuleSettingTab } from '../module';
import type AttentionPlugin from './main';
import { formatWhen, TIME_FORMAT_EXAMPLES } from './ui/time';
import { ViewModePreference, ViewModeSettings } from './viewMode';
import { t } from '../../i18n';

export interface AttentionSettings extends ViewModeSettings {
  /**
   * The one colour marks are drawn in. Per-annotation colours were dropped:
   * choosing between five swatches every time is a decision the act of
   * marking shouldn't require, and how often a passage caught you carries
   * more than which shade you happened to pick.
   */
  markColor: string;

  /**
   * How a mark is drawn. Underline by default: marks are meant to be many, a
   * page full of filled blocks is unreadable, and a background fill looks
   * exactly like Obsidian's own ==highlight== — the one thing that most needs
   * telling apart, since that syntax lives in the note and these don't.
   */
  markStyle: 'underline' | 'background';

  /**
   * How timestamps are shown: a moment format string. Empty falls back to
   * relative ("3 days ago"), which is locale-aware.
   */
  timeFormat: string;

  /**
   * Pop the colour swatches up as soon as a selection is made. The right-click
   * menu works regardless — it only ever appends to Obsidian's own menu — so
   * this is purely about whether capture also happens without asking.
   */
  popoverOnSelection: boolean;

  /** Annotate markdown files (needs the CodeMirror layer). */
  enableMarkdownHost: boolean;
  /** Annotate the Media Transcript plugin's transcript panel. */
  enableTranscriptHost: boolean;
  /** Annotate PDFs, through PDF++. */
  enablePdfHost: boolean;

  /**
   * Count how often a transcript segment gets replayed. Implicit attention —
   * denser than highlights but more personal, so it's off unless asked for.
   */
  trackReplays: boolean;

  /** Reveal the panel when opening a note that has annotations. */
  autoRevealPanel: boolean;

  /** How many annotations the review view resurfaces at a time. */
  resurfaceCount: number;

  /** Keep the sidecar when its target file is deleted (recoverable mistakes). */
  keepOrphanedSidecars: boolean;

  /**
   * Whether the one-time move of transcript marks onto their track has run.
   * Not a preference — a note to self, so the vault isn't walked every start.
   */
  transcriptMarksOnTrack: boolean;
}

export const DEFAULT_SETTINGS: AttentionSettings = {
  markColor: '#f5c542',
  markStyle: 'underline',
  timeFormat: 'YYYY-MM-DD HH:mm:ss',
  popoverOnSelection: true,
  enableMarkdownHost: true,
  enableTranscriptHost: true,
  enablePdfHost: true,
  trackReplays: false,
  autoRevealPanel: true,
  resurfaceCount: 10,
  keepOrphanedSidecars: true,
  transcriptMarksOnTrack: false,
  // Off by default: deciding how someone's notes open is not this plugin's
  // business until they ask for it.
  forceViewMode: false,
  defaultViewMode: 'reading',
  folderViewModes: [],
};

const modeLabels = (): Record<ViewModePreference, string> => ({
  reading: t('attention.modeReading'),
  live: t('attention.modeLive'),
  source: t('attention.modeSource'),
  default: t('attention.modeDefault'),
});

export class AttentionSettingTab extends ModuleSettingTab {
  constructor(app: App, private plugin: AttentionPlugin) {
    super(app, plugin);
  }

  /** Redrawn on its own, so flipping the switch doesn't rebuild the whole tab. */
  private viewModeRules: HTMLElement | null = null;

  private renderViewModeRules(): void {
    const root = this.viewModeRules;
    if (!root) return;
    root.empty();
    if (!this.plugin.settings.forceViewMode) return;

    new Setting(root)
      .setName(t('attention.settingDefaultMode'))
      .setDesc(t('attention.settingDefaultModeDesc'))
      .addDropdown(d =>
        d
          .addOptions(modeLabels())
          .setValue(this.plugin.settings.defaultViewMode)
          .onChange(async v => {
            this.plugin.settings.defaultViewMode = v as ViewModePreference;
            await this.plugin.saveSettings();
            this.plugin.applyViewModes();
          }),
      );

    new Setting(root)
      .setName(t('attention.settingFolderModes'))
      .setDesc(t('attention.settingFolderModesDesc'))
      .addButton(b =>
        b.setButtonText(t('attention.buttonAddFolder')).setCta().onClick(async () => {
          this.plugin.settings.folderViewModes.push({ folder: '', mode: 'live' });
          await this.plugin.saveSettings();
          this.renderViewModeRules();
        }),
      );

    this.plugin.settings.folderViewModes.forEach((rule, i) => {
      new Setting(root)
        .setClass('at-folder-rule')
        .addText(text =>
          text
            .setPlaceholder(t('attention.placeholderFolder'))
            .setValue(rule.folder)
            .onChange(async v => {
              rule.folder = v;
              await this.plugin.saveSettings();
            }),
        )
        .addDropdown(d =>
          d
            .addOptions(modeLabels())
            .setValue(rule.mode)
            .onChange(async v => {
              rule.mode = v as ViewModePreference;
              await this.plugin.saveSettings();
              this.plugin.applyViewModes();
            }),
        )
        .addExtraButton(b =>
          b.setIcon('trash-2').setTooltip(t('attention.tooltipRemove')).onClick(async () => {
            this.plugin.settings.folderViewModes.splice(i, 1);
            await this.plugin.saveSettings();
            this.renderViewModeRules();
          }),
        );
    });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(t('attention.headingAppearance')).setHeading();

    new Setting(containerEl)
      .setName(t('attention.settingMarkColour'))
      .setDesc(t('attention.settingMarkColourDesc'))
      .addColorPicker(c =>
        c.setValue(this.plugin.settings.markColor).onChange(async v => {
          this.plugin.settings.markColor = v;
          await this.plugin.saveSettings();
          this.plugin.applyMarkColor();
        }),
      );

    const sample = new Date().toISOString();
    const timeSetting = new Setting(containerEl)
      .setName(t('attention.settingTimeFormat'))
      .addText(text =>
        text
          .setPlaceholder(t('attention.placeholderTimeFormat'))
          .setValue(this.plugin.settings.timeFormat)
          .onChange(async v => {
            this.plugin.settings.timeFormat = v.trim();
            await this.plugin.saveSettings();
            describeTime();
            this.plugin.refreshPanels();
          }),
      );
    const describeTime = () => {
      const f = this.plugin.settings.timeFormat;
      timeSetting.setDesc(
        f
          ? t('attention.settingTimeFormatDescFormat', { sample: formatWhen(sample, f) })
          : t('attention.settingTimeFormatDescRelative', {
            sample: formatWhen(sample, f),
            examples: TIME_FORMAT_EXAMPLES.join(' / '),
          }),
      );
    };
    describeTime();

    new Setting(containerEl).setName(t('attention.headingWhere')).setHeading();

    new Setting(containerEl)
      .setName(t('attention.settingMarkdown'))
      .setDesc(t('attention.settingMarkdownDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.enableMarkdownHost).onChange(async v => {
          this.plugin.settings.enableMarkdownHost = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('attention.settingTranscripts'))
      .setDesc(t('attention.settingTranscriptsDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.enableTranscriptHost).onChange(async v => {
          this.plugin.settings.enableTranscriptHost = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('attention.settingPdf'))
      .setDesc(t('attention.settingPdfDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.enablePdfHost).onChange(async v => {
          this.plugin.settings.enablePdfHost = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('attention.settingMarkStyle'))
      .setDesc(t('attention.settingMarkStyleDesc'))
      .addDropdown(d =>
        d
          .addOption('underline', t('attention.styleUnderline'))
          .addOption('background', t('attention.styleBackground'))
          .setValue(this.plugin.settings.markStyle)
          .onChange(async v => {
            this.plugin.settings.markStyle = v as 'underline' | 'background';
            await this.plugin.saveSettings();
            this.plugin.applyMarkStyle();
          }),
      );

    new Setting(containerEl)
      .setName(t('attention.settingSwatches'))
      .setDesc(t('attention.settingSwatchesDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.popoverOnSelection).onChange(async v => {
          this.plugin.settings.popoverOnSelection = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(t('attention.headingHowNotesOpen')).setHeading();

    new Setting(containerEl)
      .setName(t('attention.settingForceViewMode'))
      .setDesc(t('attention.settingForceViewModeDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.forceViewMode).onChange(async v => {
          this.plugin.settings.forceViewMode = v;
          await this.plugin.saveSettings();
          this.plugin.applyViewModes();
          this.renderViewModeRules();
        }),
      );

    // Only this part changes when the switch is flipped or a folder is added,
    // so only this part is redrawn — rebuilding the whole tab would scroll the
    // reader back to the top of it for no reason.
    this.viewModeRules = containerEl.createDiv();
    this.renderViewModeRules();

    new Setting(containerEl).setName(t('attention.headingReview')).setHeading();

    new Setting(containerEl)
      .setName(t('attention.settingAutoReveal'))
      .setDesc(t('attention.settingAutoRevealDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.autoRevealPanel).onChange(async v => {
          this.plugin.settings.autoRevealPanel = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('attention.settingResurfaceCount'))
      .setDesc(t('attention.settingResurfaceCountDesc'))
      .addSlider(s =>
        s.setLimits(3, 50, 1)
          .setValue(this.plugin.settings.resurfaceCount)
          .onChange(async v => {
            this.plugin.settings.resurfaceCount = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName(t('attention.headingAdvanced')).setHeading();

    new Setting(containerEl)
      .setName(t('attention.settingCountReplays'))
      .setDesc(t('attention.settingCountReplaysDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.trackReplays).onChange(async v => {
          this.plugin.settings.trackReplays = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('attention.settingKeepSidecars'))
      .setDesc(t('attention.settingKeepSidecarsDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.keepOrphanedSidecars).onChange(async v => {
          this.plugin.settings.keepOrphanedSidecars = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('attention.settingRebuildIndex'))
      .setDesc(t('attention.settingRebuildIndexDesc'))
      .addButton(b =>
        b.setButtonText(t('attention.buttonRebuild')).onClick(async () => {
          await this.plugin.rebuildIndex();
        }),
      );
  }
}
