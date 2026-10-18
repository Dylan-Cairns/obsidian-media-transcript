import { App, ItemView, Menu, Modal, Notice, Setting, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type MediaTranscriptPlugin from '../main';
import type { Job, LibraryFile, TrashItem } from './client';
import { deleteMedia, renameMedia, restoreMedia } from './actions';
import { t } from '../i18n';
import { formatSize } from '../utils/format';

export const VIEW_TYPE_LIBRARY = 'media-one-library';

/**
 * The library on the Media One server, as a folder: play, rename, move and
 * delete media that may no longer be on this device, and restore it from the
 * server's trash.
 */
export class LibraryView extends ItemView {
  private files: LibraryFile[] = [];
  private trashItems: TrashItem[] = [];
  private jobsByPath = new Map<string, Job>();
  private filter = '';
  private error: string | null = null;
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private playing: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: MediaTranscriptPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_LIBRARY;
  }

  getDisplayText(): string {
    return t('library.viewTitle');
  }

  getIcon(): string {
    return 'library';
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('mo-lib');
    const bar = root.createDiv('mo-lib-bar');
    const search = bar.createEl('input', { type: 'search', placeholder: t('library.filterPlaceholder'), cls: 'mo-lib-search' });
    search.addEventListener('input', () => {
      this.filter = search.value.trim().toLowerCase();
      this.renderList();
    });
    const refresh = bar.createEl('button', { cls: 'clickable-icon mo-lib-refresh', attr: { 'aria-label': t('library.refresh') } });
    setIcon(refresh, 'refresh-cw');
    refresh.addEventListener('click', () => { void this.refresh(); });
    this.statusEl = root.createDiv('mo-lib-status');
    this.listEl = root.createDiv('mo-lib-list');
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.stopPlaying();
  }

  async refresh(): Promise<void> {
    const { library } = this.plugin;
    if (!library.configured) {
      this.error = t('library.notConfigured');
      this.files = [];
      this.trashItems = [];
    } else {
      try {
        const [files, trash, jobs] = await Promise.all([library.files(), library.trash(), library.jobs()]);
        this.files = files;
        this.trashItems = trash;
        // The latest job of each file says whether it is being transcribed.
        this.jobsByPath = new Map();
        for (const j of jobs.jobs.sort((a, b) => a.created - b.created)) {
          this.jobsByPath.set(j.path.slice(j.path.indexOf('/') + 1), j);
        }
        this.error = null;
      } catch (e) {
        this.error = (e as Error).message;
      }
    }
    this.renderList();
  }

  private renderList(): void {
    const { listEl, statusEl } = this;
    listEl.empty();
    statusEl.empty();
    const waiting = this.plugin.uploader.pending.length;
    if (this.error) {
      statusEl.createSpan({ cls: 'mo-lib-error', text: this.error });
    } else {
      const size = this.files.reduce((n, f) => n + f.size, 0);
      const vars = { count: this.files.length, size: formatSize(size), waiting };
      statusEl.setText(waiting ? t('library.statusWaiting', vars) : t('library.status', vars));
    }

    const shown = this.files
      .filter(f => !this.filter || f.vaultPath.toLowerCase().includes(this.filter))
      .sort((a, b) => a.vaultPath.localeCompare(b.vaultPath));
    let folder: string | null = null;
    for (const f of shown) {
      const dir = f.vaultPath.includes('/') ? f.vaultPath.slice(0, f.vaultPath.lastIndexOf('/')) : '/';
      if (dir !== folder) {
        folder = dir;
        listEl.createDiv({ cls: 'mo-lib-folder', text: dir });
      }
      this.renderRow(listEl, f);
    }
    if (!this.error && shown.length === 0) {
      listEl.createDiv({ cls: 'mo-lib-empty', text: this.filter ? t('library.nothingMatches') : t('library.empty') });
    }

    if (this.trashItems.length > 0) {
      const details = listEl.createEl('details', { cls: 'mo-lib-trash' });
      details.createEl('summary', { text: t('library.trashSummary', { count: this.trashItems.length }) });
      for (const item of [...this.trashItems].sort((a, b) => b.trashed.localeCompare(a.trashed))) {
        const row = details.createDiv('mo-lib-row');
        const main = row.createDiv('mo-lib-main');
        main.createDiv({ cls: 'mo-lib-name', text: item.path.slice(item.path.indexOf('/') + 1) });
        main.createDiv({ cls: 'mo-lib-meta', text: t('library.deletedAt', { date: item.trashed.replace('T', ' ') }) });
        const restore = row.createEl('button', { text: t('library.restore'), cls: 'mo-lib-restore' });
        restore.addEventListener('click', () => { void this.restore(item); });
      }
    }
  }

  private renderRow(parent: HTMLElement, f: LibraryFile): void {
    const row = parent.createDiv('mo-lib-row');
    row.dataset.path = f.vaultPath;
    const main = row.createDiv('mo-lib-main');
    main.createDiv({ cls: 'mo-lib-name', text: nameOf(f.vaultPath) });
    const meta = main.createDiv('mo-lib-meta');
    meta.appendText(`${formatSize(f.size)}${f.added ? ' · ' + f.added.slice(0, 10) : ''}`);
    if (this.plugin.transcripts.transcriptsFor(nameOf(f.vaultPath)).length > 0) {
      meta.createSpan({ cls: 'mo-lib-badge', text: t('library.badgeTranscript') });
    }
    if (this.plugin.app.vault.getAbstractFileByPath(f.vaultPath) instanceof TFile) {
      meta.createSpan({ cls: 'mo-lib-badge', text: t('library.badgeOnDevice') });
    }
    if (!f.backup || Object.keys(f.backup).length === 0) {
      meta.createSpan({ cls: 'mo-lib-badge mo-lib-nobackup', text: t('library.badgeNoBackup'), attr: { title: t('library.badgeNoBackupTip') } });
    }
    const job = this.jobsByPath.get(f.vaultPath);
    if (job && job.state !== 'done' && job.state !== 'canceled') {
      const label = job.state === 'queued' ? t('library.jobQueued') : job.state === 'claimed' ? t('library.jobClaimed') : t('library.jobFailed');
      const badge = meta.createSpan({ cls: `mo-lib-badge mo-lib-job-${job.state}`, text: label });
      if (job.error) badge.setAttr('title', job.error);
    }
    main.addEventListener('click', () => { void this.play(f, row); });

    const actions = row.createDiv('mo-lib-actions');
    const rename = actions.createEl('button', { cls: 'clickable-icon mo-lib-rename', attr: { 'aria-label': t('library.renameOrMove') } });
    setIcon(rename, 'pencil');
    rename.addEventListener('click', () => this.askRename(f));
    const del = actions.createEl('button', { cls: 'clickable-icon mo-lib-delete', attr: { 'aria-label': t('library.delete') } });
    setIcon(del, 'trash-2');
    del.addEventListener('click', () => this.askDelete(f));

    row.addEventListener('contextmenu', evt => {
      const menu = new Menu();
      menu.addItem(i => i.setTitle(t('library.menuPlay')).setIcon('play').onClick(() => { void this.play(f, row); }));
      menu.addItem(i => i.setTitle(t('library.menuRename')).setIcon('pencil').onClick(() => this.askRename(f)));
      menu.addItem(i => i.setTitle(t('library.menuTranscribe')).setIcon('file-audio').onClick(() => { void this.transcribe(f); }));
      menu.addItem(i => i.setTitle(t('library.menuCopyEmbed')).setIcon('copy').onClick(() => {
        void navigator.clipboard.writeText(`![[${nameOf(f.vaultPath)}]]`);
        new Notice(t('library.copied'));
      }));
      menu.addItem(i => i.setTitle(t('library.delete')).setIcon('trash-2').setWarning(true).onClick(() => this.askDelete(f)));
      menu.showAtMouseEvent(evt);
    });
  }

  /** Open its transcript if there is one; else play it right here. */
  private async play(f: LibraryFile, row: HTMLElement): Promise<void> {
    const transcript = this.plugin.transcripts.transcriptsFor(nameOf(f.vaultPath))[0];
    if (transcript) {
      await this.plugin.openTranscript(transcript);
      return;
    }
    this.stopPlaying();
    const holder = row.createDiv('mo-lib-player');
    const audio = holder.createEl('audio', { attr: { controls: '', src: this.plugin.library.url(f.vaultPath) } });
    this.playing = holder;
    void audio.play().catch(() => { /* the controls are there to try again */ });
  }

  private stopPlaying(): void {
    if (!this.playing) return;
    this.playing.querySelector('audio')?.pause();
    this.playing.remove();
    this.playing = null;
  }

  askRename(f: LibraryFile): void {
    new RenameModal(this.app, f.vaultPath, async to => {
      try {
        await renameMedia(this.plugin, f.vaultPath, to);
        new Notice(t('library.renamedTo', { path: to }));
      } catch (e) {
        new Notice(t('library.renameFailed', { error: (e as Error).message }));
      }
      await this.refresh();
    }).open();
  }

  askDelete(f: LibraryFile): void {
    new ConfirmModal(this.app, t('library.deleteTitle', { name: nameOf(f.vaultPath) }),
      t('library.deleteDesc'),
      t('library.delete'), async () => {
        try {
          await deleteMedia(this.plugin, f.vaultPath);
          new Notice(t('library.deleted', { name: nameOf(f.vaultPath) }));
        } catch (e) {
          new Notice(t('library.deleteFailed', { error: (e as Error).message }));
        }
        await this.refresh();
      }).open();
  }

  private async transcribe(f: LibraryFile): Promise<void> {
    try {
      const job = await this.plugin.library.transcribe(f.vaultPath, true);
      new Notice(job ? t('library.transcribeQueued', { name: nameOf(f.vaultPath) }) : t('library.nothingToTranscribe'));
    } catch (e) {
      new Notice(t('library.transcribeFailed', { error: (e as Error).message }));
    }
    await this.refresh();
  }

  private async restore(item: TrashItem): Promise<void> {
    try {
      const path = await restoreMedia(this.plugin, item.id);
      new Notice(t('library.restored', { path }));
    } catch (e) {
      new Notice(t('library.restoreFailed', { error: (e as Error).message }));
    }
    await this.refresh();
  }
}

export class RenameModal extends Modal {
  constructor(app: App, private readonly current: string, private readonly onSubmit: (to: string) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('library.renameOrMove'));
    let value = this.current;
    const submit = () => {
      const to = value.trim();
      this.close();
      if (to && to !== this.current) void this.onSubmit(to);
    };
    new Setting(this.contentEl)
      .setName(t('library.newPath'))
      .setDesc(t('library.newPathDesc'))
      .addText(text => {
        text.setValue(value).onChange(v => { value = v; });
        text.inputEl.addClass('mo-lib-rename-input');
        text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        // Select the name without the extension, ready to type over.
        const start = value.lastIndexOf('/') + 1;
        const end = value.lastIndexOf('.') > start ? value.lastIndexOf('.') : value.length;
        window.setTimeout(() => { text.inputEl.focus(); text.inputEl.setSelectionRange(start, end); }, 0);
      });
    new Setting(this.contentEl).addButton(b => b.setButtonText(t('library.rename')).setCta().onClick(submit));
  }
}

export class ConfirmModal extends Modal {
  constructor(app: App, private readonly heading: string, private readonly body: string,
    private readonly confirm: string, private readonly onConfirm: () => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.heading);
    this.contentEl.createEl('p', { text: this.body });
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText(t('library.cancel')).onClick(() => this.close()))
      .addButton(b => b.setButtonText(this.confirm).setWarning().onClick(() => {
        this.close();
        void this.onConfirm();
      }));
  }
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

