import { Menu, Notice, TFile, setIcon } from 'obsidian';
import type MediaTranscriptPlugin from '../main';
import type { IndexEntry, Job, TrashItem } from './client';
import { durationIn, formatDuration, isDatedName, isGenericName, isTranscriptNamedFor, openingWords, recordedAt } from './mediaInfo';
import { formatSize } from '../utils/format';
import { obsidianLanguage, t } from '../i18n';

const PAGE = 200;
const LOCALE = obsidianLanguage() === 'zh' ? 'zh-CN' : 'en';
const MONTH = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'long' });
const TIME = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const TIME_YEAR = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });
const DAY_YEAR = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });

/** When, as the row says it: no year for this year's, no time when only the day is known. */
function formatWhen(d: Date): string {
  const thisYear = d.getFullYear() === new Date().getFullYear();
  const dayOnly = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  return (dayOnly ? (thisYear ? DAY : DAY_YEAR) : (thisYear ? TIME : TIME_YEAR)).format(d);
}
const MEDIA_EXT = /\.(m4a|mp3|wav|aac|flac|ogg|opus|wma|mp4|mov|mkv|webm|avi|m4v)$/i;

/** One media file on the server, with what helps to tell it apart. */
interface Item {
  path: string;              // in the library
  name: string;
  collection: string;        // the library folder it is in
  vaultPath: string | null;  // this vault's own media: where it is in the vault
  size: number;
  backedUp: boolean;
  recorded: Date | null;
  title: string;             // the note it comes from (unless a daily note), or its name
  notes: TFile[];
  transcript: TFile | null;
}

export interface MediaHost {
  rerender(): void;
  rename(vaultPath: string): void;
  delete(vaultPath: string): void;
  restore(item: TrashItem): Promise<void>;
}

/**
 * The media on the Media One server, as the library tab lists it: this
 * vault's own recordings, and the collections kept beside them (recorded
 * streams, podcasts) whose transcripts are in the vault. Newest first, by
 * month, each row saying which note it comes from, when it was recorded and
 * how long it is.
 */
export class MediaList {
  private items: Item[] = [];
  private trash: TrashItem[] = [];
  private jobs = new Map<string, Job>();
  private collection: string | null = null;  // null: this vault's own
  private limit = PAGE;
  private error: string | null = null;
  /** Read from each shown transcript once: the media's length and opening words. */
  private details = new Map<string, { duration: number | null; words: string }>();
  private playing: HTMLElement | null = null;

  constructor(private readonly plugin: MediaTranscriptPlugin, private readonly host: MediaHost) {}

  private get own(): string {
    return this.plugin.library.folder;
  }

  async refresh(): Promise<void> {
    const { library } = this.plugin;
    if (!library.configured) {
      this.error = t('library.notConfigured');
      this.items = [];
      this.trash = [];
      return;
    }
    try {
      const [index, trash, jobs] = await Promise.all([library.index(), library.trash(), library.jobs()]);
      this.trash = trash;
      this.jobs = new Map();
      for (const j of jobs.jobs.sort((a, b) => a.created - b.created)) this.jobs.set(j.path, j);
      this.items = this.build(index);
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private build(index: IndexEntry[]): Item[] {
    const { app, transcripts } = this.plugin;
    // Transcripts by the media name their file name gives, for those whose
    // recorded source is out of date.
    const byName = new Map<string, TFile[]>();
    for (const f of app.vault.getFiles()) {
      if (f.extension !== 'json' || f.name.endsWith('.anno.json')) continue;
      const base = f.name.replace(/\.[^./]+\.json$/, '');
      const list = byName.get(base) ?? [];
      list.push(f);
      byName.set(base, list);
    }
    // Notes that embed or link a file, by its name: the media is often no
    // longer in the vault, so the links are unresolved and kept by name.
    const notesByName = new Map<string, Set<string>>();
    const note = (source: string, target: string) => {
      const name = target.slice(target.lastIndexOf('/') + 1).toLowerCase();
      if (!MEDIA_EXT.test(name)) return;
      const set = notesByName.get(name) ?? new Set();
      set.add(source);
      notesByName.set(name, set);
    };
    const { resolvedLinks, unresolvedLinks } = app.metadataCache;
    for (const [source, targets] of Object.entries(resolvedLinks)) for (const target of Object.keys(targets)) note(source, target);
    for (const [source, targets] of Object.entries(unresolvedLinks)) for (const target of Object.keys(targets)) note(source, target);

    return index.filter(e => MEDIA_EXT.test(e.path)).map(e => {
      const collection = e.path.slice(0, e.path.indexOf('/'));
      const name = e.path.slice(e.path.lastIndexOf('/') + 1);
      const base = name.slice(0, name.lastIndexOf('.'));
      const notes = [...(notesByName.get(name.toLowerCase()) ?? [])]
        .map(p => app.vault.getAbstractFileByPath(p))
        .filter((f): f is TFile => f instanceof TFile);
      const transcript = transcripts.transcriptsFor(name).find(f => f.extension === 'json')
        ?? (byName.get(base) ?? []).find(f => isTranscriptNamedFor(f.name, name))
        ?? null;
      return {
        path: e.path,
        name,
        collection,
        vaultPath: collection === this.own ? e.path.slice(collection.length + 1) : null,
        size: e.size,
        backedUp: !!e.backup && Object.keys(e.backup).length > 0,
        // Its own media was uploaded as it was made; a collection was brought in all at once.
        recorded: recordedAt(name) ?? (collection === this.own && e.added ? new Date(e.added) : null),
        title: notes[0] && !isDatedName(notes[0].basename) ? notes[0].basename : base,
        notes,
        transcript,
      };
    });
  }

  render(list: HTMLElement, status: HTMLElement, filter: string): void {
    if (this.error) {
      status.createSpan({ cls: 'mo-lib-error', text: this.error });
      return;
    }
    const counts = new Map<string, Item[]>();
    for (const it of this.items) counts.set(it.collection, [...(counts.get(it.collection) ?? []), it]);
    const current = this.collection ?? this.own;
    const inView = this.collection === '*' ? this.items : counts.get(current) ?? [];
    const size = (items: Item[]) => formatSize(items.reduce((n, i) => n + i.size, 0));
    const waiting = this.plugin.uploader.pending.length;
    status.setText(t(waiting ? 'library.mediaStatusWaiting' : 'library.mediaStatus', {
      count: inView.length, size: size(inView), total: size(this.items), waiting,
    }));

    this.renderCollections(list, counts, current);

    const shown = inView
      .filter(it => !filter || [it.path, it.title, this.details.get(it.path)?.words ?? '', ...it.notes.map(n => n.path)].join('\n').toLowerCase().includes(filter))
      .sort((a, b) => (b.recorded?.getTime() ?? 0) - (a.recorded?.getTime() ?? 0) || a.name.localeCompare(b.name));
    let group: string | null = null;
    for (const it of shown.slice(0, this.limit)) {
      const g = it.recorded ? MONTH.format(it.recorded) : t('library.undated');
      if (g !== group) {
        group = g;
        list.createDiv({ cls: 'mo-lib-folder', text: g });
      }
      this.renderRow(list, it);
    }
    if (shown.length > this.limit) {
      const more = list.createEl('button', { cls: 'mo-lib-more', text: t('library.archiveShowMore', { count: Math.min(PAGE, shown.length - this.limit) }) });
      more.addEventListener('click', () => {
        this.limit += PAGE;
        this.host.rerender();
      });
    }
    if (shown.length === 0) {
      list.createDiv({ cls: 'mo-lib-empty', text: filter ? t('library.nothingMatches') : t('library.empty') });
    }
    if (current === this.own && this.collection !== '*') this.renderTrash(list);
  }

  private renderCollections(list: HTMLElement, counts: Map<string, Item[]>, current: string): void {
    if (counts.size <= 1 && counts.has(this.own)) return;
    const bar = list.createDiv('mo-lib-segments mo-lib-collections');
    const others = [...counts.keys()].filter(c => c !== this.own).sort((a, b) => counts.get(b)!.length - counts.get(a)!.length);
    const add = (key: string | null, label: string, n: number) => {
      const active = key === '*' ? this.collection === '*' : this.collection !== '*' && (key ?? this.own) === current;
      const b = bar.createEl('button', { text: `${label} ${n}`, cls: active ? 'is-active' : '' });
      b.addEventListener('click', () => {
        this.collection = key;
        this.limit = PAGE;
        this.host.rerender();
      });
    };
    add(null, t('library.collectionMine'), counts.get(this.own)?.length ?? 0);
    for (const c of others) add(c, c, counts.get(c)!.length);
    add('*', t('library.collectionAll'), this.items.length);
  }

  private renderRow(list: HTMLElement, it: Item): void {
    const row = list.createDiv('mo-lib-row mo-lib-media-row');
    row.dataset.path = it.path;
    const icon = row.createDiv({ cls: 'mo-lib-kind', attr: { 'aria-label': it.transcript ? t('library.menuOpenTranscript') : t('library.menuPlay') } });
    setIcon(icon, it.transcript ? 'file-text' : 'play');
    const main = row.createDiv('mo-lib-main');
    const title = main.createDiv({ cls: 'mo-lib-name', text: it.title });
    const meta = main.createDiv('mo-lib-meta');
    const when = it.recorded ? formatWhen(it.recorded) : '';
    const facts = meta.createSpan();
    const context = main.createDiv({ cls: 'mo-lib-file' });
    const base = it.name.slice(0, it.name.lastIndexOf('.'));
    const generic = isGenericName(it.name) && it.title === base;
    const show = (d?: { duration: number | null; words: string }) => {
      facts.setText([when, d?.duration ? formatDuration(d.duration) : '', formatSize(it.size)].filter(Boolean).join(' · '));
      // A name a recorder gave (a timestamp) says least: then what was said
      // names it best. A name someone chose is kept.
      const name = (generic && d?.words) || it.title;
      title.setText(name);
      const parts = [it.notes[0]?.basename, it.name].filter((x): x is string => !!x && x !== name && !(x === it.name && name === base));
      context.setText(parts.join(' · '));
      context.toggle(parts.length > 0);
    };
    show(this.details.get(it.path));
    if (it.transcript && !this.details.has(it.path)) void this.loadDetails(it).then(show);

    // Only what is out of the ordinary: a transcript is the rule.
    const job = this.jobs.get(it.path);
    if (job && (job.state === 'queued' || job.state === 'claimed' || job.state === 'failed')) {
      const label = job.state === 'queued' ? t('library.jobQueued') : job.state === 'claimed' ? t('library.jobClaimed') : t('library.jobFailed');
      const badge = meta.createSpan({ cls: `mo-lib-badge mo-lib-job-${job.state}`, text: label });
      if (job.error) badge.setAttr('title', job.error);
    } else if (!it.transcript) {
      meta.createSpan({ cls: 'mo-lib-badge', text: t('library.badgeNoTranscript') });
    }
    // Backups are kept track of for this vault's own media only.
    if (!it.backedUp && it.vaultPath) meta.createSpan({ cls: 'mo-lib-badge mo-lib-nobackup', text: t('library.badgeNoBackup'), attr: { title: t('library.badgeNoBackupTip') } });
    if (it.vaultPath && this.plugin.app.vault.getAbstractFileByPath(it.vaultPath) instanceof TFile) {
      meta.createSpan({ cls: 'mo-lib-badge', text: t('library.badgeOnDevice') });
    }

    const open = () => {
      if (it.transcript) void this.plugin.openTranscript(it.transcript);
      else this.play(it, row);
    };
    icon.addEventListener('click', open);
    main.addEventListener('click', open);
    const more = row.createEl('button', { cls: 'clickable-icon mo-lib-more-actions', attr: { 'aria-label': t('library.moreActions') } });
    setIcon(more, 'more-horizontal');
    more.addEventListener('click', evt => this.menu(evt, it, row));
    row.addEventListener('contextmenu', evt => {
      evt.preventDefault();
      this.menu(evt, it, row);
    });
  }

  private async loadDetails(it: Item): Promise<{ duration: number | null; words: string }> {
    let d = { duration: null as number | null, words: '' };
    try {
      if (it.transcript) {
        const text = await this.plugin.app.vault.cachedRead(it.transcript);
        d = { duration: durationIn(text), words: openingWords(text) };
      }
    } catch {
      // nothing more to show
    }
    this.details.set(it.path, d);
    return d;
  }

  private menu(evt: MouseEvent, it: Item, row: HTMLElement): void {
    const menu = new Menu();
    menu.addItem(i => i.setTitle(t('library.menuPlay')).setIcon('play').onClick(() => this.play(it, row)));
    if (it.transcript) {
      const tr = it.transcript;
      menu.addItem(i => i.setTitle(t('library.menuOpenTranscript')).setIcon('file-text').onClick(() => { void this.plugin.openTranscript(tr); }));
    }
    for (const n of it.notes.slice(0, 5)) {
      menu.addItem(i => i.setTitle(t('library.menuOpenNote', { name: n.basename })).setIcon('sticky-note')
        .onClick(() => { void this.plugin.app.workspace.getLeaf(false).openFile(n); }));
    }
    menu.addSeparator();
    const vaultPath = it.vaultPath;
    if (vaultPath) {
      menu.addItem(i => i.setTitle(t('library.menuRename')).setIcon('pencil').onClick(() => this.host.rename(vaultPath)));
      menu.addItem(i => i.setTitle(t('library.menuTranscribe')).setIcon('captions').onClick(() => { void this.transcribe(vaultPath, it.name); }));
      menu.addItem(i => i.setTitle(t('library.menuCopyEmbed')).setIcon('copy').onClick(() => {
        void navigator.clipboard.writeText(`![[${it.name}]]`);
        new Notice(t('library.copied'));
      }));
      menu.addSeparator();
      menu.addItem(i => i.setTitle(t('library.delete')).setIcon('trash-2').setWarning(true).onClick(() => this.host.delete(vaultPath)));
    } else {
      menu.addItem(i => i.setTitle(t('library.menuCopyLink')).setIcon('link').onClick(() => {
        void navigator.clipboard.writeText(this.plugin.library.libraryUrl(it.path));
        new Notice(t('library.copied'));
      }));
    }
    menu.showAtMouseEvent(evt);
  }

  private play(it: Item, row: HTMLElement): void {
    const again = this.playing?.parentElement === row;
    this.stop();
    if (again) return;
    const holder = row.createDiv('mo-lib-player');
    const audio = holder.createEl('audio', { attr: { controls: '', src: this.plugin.library.libraryUrl(it.path) } });
    this.playing = holder;
    void audio.play().catch(() => { /* the controls are there to try again */ });
  }

  stop(): void {
    if (!this.playing) return;
    this.playing.querySelector('audio')?.pause();
    this.playing.remove();
    this.playing = null;
  }

  private async transcribe(vaultPath: string, name: string): Promise<void> {
    try {
      const job = await this.plugin.library.transcribe(vaultPath, true);
      new Notice(job ? t('library.transcribeQueued', { name }) : t('library.nothingToTranscribe'));
    } catch (e) {
      new Notice(t('library.transcribeFailed', { error: (e as Error).message }));
    }
    await this.refresh();
    this.host.rerender();
  }

  private renderTrash(list: HTMLElement): void {
    if (this.trash.length === 0) return;
    const details = list.createEl('details', { cls: 'mo-lib-trash' });
    details.createEl('summary', { text: t('library.trashSummary', { count: this.trash.length }) });
    for (const item of [...this.trash].sort((a, b) => b.trashed.localeCompare(a.trashed))) {
      const row = details.createDiv('mo-lib-row');
      const main = row.createDiv('mo-lib-main');
      main.createDiv({ cls: 'mo-lib-name', text: item.path.slice(item.path.indexOf('/') + 1) });
      main.createDiv({ cls: 'mo-lib-meta', text: t('library.deletedAt', { date: item.trashed.replace('T', ' ') }) });
      const restore = row.createEl('button', { text: t('library.restore'), cls: 'mo-lib-restore' });
      restore.addEventListener('click', () => { void this.host.restore(item); });
    }
  }
}
