import { Menu, Notice, TFile, setIcon } from 'obsidian';
import type MediaTranscriptPlugin from '../main';
import type { ArchiveFile } from './client';
import { archiveName } from '../modules/archive/resolver';
import { formatSize } from '../utils/format';
import { t } from '../i18n';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'm4v', 'mov']);
const PAGE = 200;
// Remote media in a note: ![](…), and <img>/<video>/<source>/<audio src="…">.
const MEDIA_LINK = /(?:!\[[^\]]*\]\(|<(?:img|video|source|audio)\b[^>]*?\ssrc=["'])(https?:\/\/[^)\s"'<>]+)/g;

type Kind = 'all' | 'video' | 'image' | 'unused';
type Sort = 'new' | 'size';

interface Ref {
  url: string;
  notes: TFile[];
}

export interface ArchiveHost {
  confirm(heading: string, body: string, action: string, onConfirm: () => Promise<void>): void;
  rerender(): void;
}

/**
 * The web archive on the server, as a list: what is kept (images and videos
 * saved from notes), how big, and which notes show each — found by scanning
 * the notes for the links the files were saved from.
 */
export class ArchiveList {
  private files: ArchiveFile[] = [];
  private refs = new Map<string, Ref>();
  private kind: Kind = 'all';
  private sort: Sort = 'new';
  private limit = PAGE;
  private error: string | null = null;
  private scanning = false;
  loaded = false;

  constructor(private readonly plugin: MediaTranscriptPlugin, private readonly host: ArchiveHost) {}

  async refresh(): Promise<void> {
    const { library } = this.plugin;
    if (!library.configured) {
      this.error = t('library.notConfigured');
      this.files = [];
      return;
    }
    this.scanning = true;
    this.host.rerender();
    try {
      const [files, refs] = await Promise.all([library.archive(), this.scanNotes()]);
      this.files = files;
      this.refs = refs;
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.scanning = false;
      this.loaded = true;
    }
  }

  /** Archive name → the link it is saved from and the notes that show it. */
  private async scanNotes(): Promise<Map<string, Ref>> {
    const refs = new Map<string, Ref>();
    const { vault } = this.plugin.app;
    for (const file of vault.getMarkdownFiles()) {
      const text = await vault.cachedRead(file);
      if (!text.includes('http')) continue;
      for (const m of text.matchAll(MEDIA_LINK)) {
        const name = archiveName(m[1]);
        const ref = refs.get(name) ?? { url: m[1], notes: [] };
        if (!ref.notes.includes(file)) ref.notes.push(file);
        refs.set(name, ref);
      }
    }
    return refs;
  }

  render(list: HTMLElement, status: HTMLElement, filter: string): void {
    if (this.error) {
      status.createSpan({ cls: 'mo-lib-error', text: this.error });
      return;
    }
    const size = this.files.reduce((n, f) => n + f.size, 0);
    status.setText(t('library.archiveStatus', { count: this.files.length, size: formatSize(size) }));
    if (this.scanning) status.createSpan({ cls: 'mo-lib-badge', text: t('library.archiveScanning') });

    const unused = this.files.filter(f => !this.refs.get(f.name)?.notes.length);
    this.renderControls(list, unused);

    const shown = this.files
      .filter(f => this.kind === 'all'
        || (this.kind === 'video' && VIDEO_EXTS.has(extOf(f.name)))
        || (this.kind === 'image' && IMAGE_EXTS.has(extOf(f.name)))
        || (this.kind === 'unused' && !this.refs.get(f.name)?.notes.length))
      .filter(f => !filter || this.searchText(f).includes(filter))
      .sort((a, b) => this.sort === 'size' ? b.size - a.size : b.modified.localeCompare(a.modified));
    for (const f of shown.slice(0, this.limit)) this.renderRow(list, f);
    if (shown.length > this.limit) {
      const more = list.createEl('button', { cls: 'mo-lib-more', text: t('library.archiveShowMore', { count: Math.min(PAGE, shown.length - this.limit) }) });
      more.addEventListener('click', () => {
        this.limit += PAGE;
        this.host.rerender();
      });
    }
    if (!this.scanning && shown.length === 0) {
      list.createDiv({ cls: 'mo-lib-empty', text: filter || this.kind !== 'all' ? t('library.nothingMatches') : t('library.archiveEmpty') });
    }
  }

  private renderControls(list: HTMLElement, unused: ArchiveFile[]): void {
    const bar = list.createDiv('mo-lib-archive-controls');
    const kinds: [Kind, string][] = [
      ['all', t('library.archiveKindAll')],
      ['video', t('library.archiveKindVideo')],
      ['image', t('library.archiveKindImage')],
      ['unused', t('library.archiveKindUnused', { count: unused.length })],
    ];
    const group = bar.createDiv('mo-lib-segments');
    for (const [kind, label] of kinds) {
      const b = group.createEl('button', { text: label, cls: kind === this.kind ? 'is-active' : '' });
      b.addEventListener('click', () => {
        this.kind = kind;
        this.limit = PAGE;
        this.host.rerender();
      });
    }
    const sort = bar.createEl('select', { cls: 'dropdown mo-lib-sort' });
    sort.createEl('option', { value: 'new', text: t('library.archiveSortNew') });
    sort.createEl('option', { value: 'size', text: t('library.archiveSortSize') });
    sort.value = this.sort;
    sort.addEventListener('change', () => {
      this.sort = sort.value as Sort;
      this.host.rerender();
    });
    if (this.kind === 'unused' && unused.length > 0 && !this.scanning) {
      const clean = bar.createEl('button', { cls: 'mod-warning', text: t('library.archiveCleanUnused', { count: unused.length }) });
      clean.addEventListener('click', () => this.askDelete(unused, true));
    }
  }

  private searchText(f: ArchiveFile): string {
    const ref = this.refs.get(f.name);
    return [f.name, f.url ?? '', ref?.url ?? '', ...(ref?.notes.map(n => n.path) ?? [])].join('\n').toLowerCase();
  }

  private renderRow(list: HTMLElement, f: ArchiveFile): void {
    const ref = this.refs.get(f.name);
    const url = ref?.url ?? f.url;
    const ext = extOf(f.name);
    const media = f.name.slice(3);
    const transcript = VIDEO_EXTS.has(ext) ? this.plugin.transcripts.transcriptsFor(media).find(x => x.extension === 'json') : undefined;

    const row = list.createDiv('mo-lib-row mo-lib-archive-row');
    const thumb = row.createDiv('mo-lib-thumb');
    if (IMAGE_EXTS.has(ext)) {
      thumb.createEl('img', { attr: { src: this.plugin.library.archiveUrl(f.name), loading: 'lazy', alt: '' } });
    } else if (VIDEO_EXTS.has(ext)) {
      // A frame from the start, fetched only when the row comes into view.
      const video = thumb.createEl('video', { attr: { preload: 'none', muted: '', playsinline: '' } });
      whenVisible(thumb, () => {
        video.preload = 'metadata';
        video.src = `${this.plugin.library.archiveUrl(f.name)}#t=1`;
      });
    } else {
      setIcon(thumb, 'file');
    }
    const main = row.createDiv('mo-lib-main');
    // Saved before devices said where from, and shown by no note: its hash, shortened.
    main.createDiv({ cls: 'mo-lib-name', text: ref?.notes[0]?.basename ?? (url ? tail(url) : `${media.slice(0, 8)}….${ext}`) });
    const meta = main.createDiv('mo-lib-meta');
    meta.appendText(`${formatSize(f.size)} · ${f.modified.slice(0, 10)}`);
    const count = ref?.notes.length ?? 0;
    if (count > 0) meta.createSpan({ cls: 'mo-lib-badge', text: t('library.archiveNotes', { count }) });
    else if (!this.scanning) meta.createSpan({ cls: 'mo-lib-badge mo-lib-nobackup', text: t('library.archiveUnused') });
    if (transcript) meta.createSpan({ cls: 'mo-lib-badge', text: t('library.badgeTranscript') });

    main.addEventListener('click', () => {
      if (transcript) void this.plugin.openTranscript(transcript);
      else if (ref?.notes[0]) void this.plugin.app.workspace.getLeaf(false).openFile(ref.notes[0]);
      else window.open(this.plugin.library.archiveUrl(f.name));
    });
    row.addEventListener('contextmenu', evt => this.menu(evt, f, ref, url, transcript));
  }

  private menu(evt: MouseEvent, f: ArchiveFile, ref: Ref | undefined, url: string | undefined, transcript: TFile | undefined): void {
    const menu = new Menu();
    for (const note of (ref?.notes ?? []).slice(0, 10)) {
      menu.addItem(i => i.setTitle(t('library.menuOpenNote', { name: note.basename })).setIcon('file-text')
        .onClick(() => { void this.plugin.app.workspace.getLeaf(false).openFile(note); }));
    }
    menu.addItem(i => i.setTitle(t('library.menuOpenCopy')).setIcon('archive')
      .onClick(() => { window.open(this.plugin.library.archiveUrl(f.name)); }));
    if (url) {
      menu.addItem(i => i.setTitle(t('library.menuOpenOriginal')).setIcon('external-link').onClick(() => { window.open(url); }));
      menu.addItem(i => i.setTitle(t('library.menuCopyOriginal')).setIcon('copy').onClick(() => {
        void navigator.clipboard.writeText(url);
        new Notice(t('library.copied'));
      }));
    }
    if (VIDEO_EXTS.has(extOf(f.name))) {
      if (transcript) {
        menu.addItem(i => i.setTitle(t('library.menuOpenTranscript')).setIcon('captions')
          .onClick(() => { void this.plugin.openTranscript(transcript); }));
      } else if (url) {
        menu.addItem(i => i.setTitle(t('library.menuTranscribe')).setIcon('captions')
          .onClick(() => { void this.transcribe(f, url, ref); }));
      }
    }
    menu.addItem(i => i.setTitle(t('library.menuDeleteCopy')).setIcon('trash-2').setWarning(true)
      .onClick(() => this.askDelete([f], false)));
    menu.showAtMouseEvent(evt);
  }

  private async transcribe(f: ArchiveFile, url: string, ref: Ref | undefined): Promise<void> {
    try {
      const job = await this.plugin.library.transcribeArchived(f.name, url, ref?.notes[0]?.basename ?? '');
      if (job) this.plugin.transcriptSync.remember([job]);
      new Notice(job ? t('archive.noticeTranscribeQueued') : t('archive.noticeTranscribeExists'));
      if (!job || job.state === 'done') void this.plugin.transcriptSync.sync();
    } catch (e) {
      new Notice(t('archive.noticeTranscribeFailed', { reason: (e as Error).message }));
    }
  }

  private askDelete(files: ArchiveFile[], unused: boolean): void {
    const heading = unused
      ? t('library.archiveCleanTitle', { count: files.length })
      : t('library.archiveDeleteTitle');
    const body = unused ? t('library.archiveCleanDesc', { vault: this.plugin.app.vault.getName() }) : t('library.archiveDeleteDesc');
    this.host.confirm(heading, body, t('library.delete'), async () => {
      let deleted = 0;
      try {
        for (let i = 0; i < files.length; i += 200) {
          deleted += (await this.plugin.library.archiveDelete(files.slice(i, i + 200).map(f => f.name))).length;
        }
        new Notice(t('library.archiveDeleted', { count: deleted }));
      } catch (e) {
        new Notice(t('library.deleteFailed', { error: (e as Error).message }));
      }
      await this.refresh();
      this.host.rerender();
    });
  }
}

function extOf(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}

function tail(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || url;
  } catch {
    return url;
  }
}

/** Run `fn` once `el` is (nearly) on screen. */
function whenVisible(el: HTMLElement, fn: () => void): void {
  const io = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    io.disconnect();
    fn();
  }, { rootMargin: '200px' });
  io.observe(el);
}
