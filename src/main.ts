import { App, Component, Plugin, TFile, WorkspaceLeaf, parseLinktext, setIcon } from 'obsidian';
import { EmbedCreator, TranscriptCards, embedRegistry } from './embeds';
import { MediaTranscriptView, VIEW_TYPE_MEDIA_TRANSCRIPT } from './MediaTranscriptView';
import { MediaTranscriptSettingTab, DEFAULT_SETTINGS } from './settings';
import type { MediaTranscriptSettings } from './settings';
import { SUBTITLE_EXTENSIONS, findSubtitleFiles } from './utils/subtitleFinder';
import { parseTimeFragment } from './utils/timeFragment';
import { MediaLocator } from './mediaLocator';

// Subtitle extensions we globally register for click-to-open. Clicking any of
// these opens the transcript view, which reverse-resolves the matching media
// (video first, else audio) and plays it. `.json` is included: this reliably
// routes every `.json` here (a non-subtitle one just shows a "no media" hint),
// which is the tradeoff for click-to-play working every time — a conditional
// per-file takeover isn't possible since registration is per-extension.
const CLICKABLE_SUBTITLE_EXTS = SUBTITLE_EXTENSIONS;

// Media extensions (mp3/mp4/…) are owned by Obsidian core, so `registerExtensions`
// throws for them. To open media in our transcript view we take them over via
// `viewRegistry.unregisterExtensions` — undocumented but stable, and used by
// directory plugins (Custom File Extensions, obsd.any). We register the same
// extensions and clean up on unload.
interface ViewRegistry {
  unregisterExtensions(exts: string[]): void;
}
function viewRegistry(app: App): ViewRegistry {
  return (app as unknown as { viewRegistry: ViewRegistry }).viewRegistry;
}

// `![[talk.m4a]]` doesn't go through the view registry at all — embeds have
// their own registry (see embeds.ts), so taking over the extension above never
// reached them. We wrap the core factory rather than replace it: the native
// player stays, we only add a "Transcript" button.

export default class MediaTranscriptPlugin extends Plugin {
  settings!: MediaTranscriptSettings;
  mediaLocator!: MediaLocator;
  private cards!: TranscriptCards;
  // Core embed factories we wrapped, by extension, to put back on unload.
  private wrappedEmbeds = new Map<string, { original: EmbedCreator; wrapper: EmbedCreator }>();

  async onload() {
    await this.loadSettings();
    this.mediaLocator = new MediaLocator(this.app, () => this.settings);
    this.app.workspace.onLayoutReady(() => this.mediaLocator.warm());

    this.registerView(
      VIEW_TYPE_MEDIA_TRANSCRIPT,
      leaf => new MediaTranscriptView(leaf, this),
    );

    // Media extensions, plus subtitle extensions (.srt / .vtt / .json) so
    // clicking a subtitle opens here and reverse-resolves its media.
    for (const ext of [...this.mediaExts(), ...CLICKABLE_SUBTITLE_EXTS]) {
      try {
        this.registerExtensions([ext], VIEW_TYPE_MEDIA_TRANSCRIPT);
      } catch {
        // Owned by core/another plugin — take it over so it opens here.
        try {
          viewRegistry(this.app).unregisterExtensions([ext]);
          this.registerExtensions([ext], VIEW_TYPE_MEDIA_TRANSCRIPT);
        } catch {
          // Give up on this one; the command / file-menu below still works.
        }
      }
    }

    // Explicit "open in this view" — fallback for any extension we couldn't
    // take (and the only entry point for .json subtitles). Works for both
    // media files and subtitle files (which resolve to their media).
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && (this.isMedia(file) || this.isSubtitle(file))) {
          menu.addItem(item =>
            item
              .setTitle('Open in Media Transcript')
              .setIcon('play-circle')
              .onClick(() => { void this.openInView(file); }),
          );
        }
      }),
    );

    this.addCommand({
      id: 'open-current-media-file',
      name: 'Open current media file in transcript view',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || (!this.isMedia(file) && !this.isSubtitle(file))) {
          return false;
        }
        if (!checking) void this.openInView(file);
        return true;
      },
    });

    // Focus the transcript search box (bind a hotkey to it if you like).
    this.addCommand({
      id: 'search-transcript',
      name: 'Search transcript',
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MediaTranscriptView);
        if (!view) return false;
        if (!checking) view.focusSearch();
        return true;
      },
    });

    // Paste a link to the playing moment into the note you're writing:
    // `[[talk.m4a#t=83|1:23]]`. Clicking it later jumps back there.
    this.addCommand({
      id: 'insert-timestamp-link',
      name: 'Insert link to current playback time',
      editorCheckCallback: (checking, editor, ctx) => {
        const view = this.transcriptViews().find(v => v.getCurrentTime() !== null);
        if (!view) return false;
        if (!checking) {
          editor.replaceSelection(view.timestampLink(view.getCurrentTime() ?? 0, ctx.file?.path ?? ''));
        }
        return true;
      },
    });

    this.wrapMediaEmbeds();
    this.cards = new TranscriptCards(this);
    this.app.workspace.onLayoutReady(() => this.cards.start());
    this.routeMediaLinks();

    this.addSettingTab(new MediaTranscriptSettingTab(this.app, this));
  }

  /**
   * Open `file`'s transcript beside the current note, never in place of it —
   * the note is what you're working on, the recording is the source.
   * Reuses a transcript pane that already shows this media (else any open
   * transcript pane) so repeated clicks don't pile up splits.
   */
  async openTranscript(file: TFile, seconds: number | null = null, play = true) {
    const ws = this.app.workspace;
    const leaves = ws.getLeavesOfType(VIEW_TYPE_MEDIA_TRANSCRIPT);
    let leaf = leaves.find(
      l => l.view instanceof MediaTranscriptView &&
        (l.view.file === file || l.view.getMediaFile() === file),
    );
    if (!leaf) {
      leaf = leaves[0] ?? ws.getLeaf('split', 'vertical');
      await leaf.setViewState({ type: VIEW_TYPE_MEDIA_TRANSCRIPT, state: { file: file.path } });
    }
    await ws.revealLeaf(leaf);
    if (seconds !== null && leaf.view instanceof MediaTranscriptView) {
      leaf.view.seekTo(seconds, play);
    }
  }

  private hasSubtitles(file: TFile): boolean {
    return findSubtitleFiles(file, this.app.vault, this.settings).length > 0;
  }

  private transcriptViews(): MediaTranscriptView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MEDIA_TRANSCRIPT)
      .map(l => l.view)
      .filter((v): v is MediaTranscriptView => v instanceof MediaTranscriptView);
  }

  private wrapMediaEmbeds() {
    const registry = embedRegistry(this.app);
    if (!registry?.embedByExtension) return;

    for (const ext of this.mediaExts()) {
      const original = registry.embedByExtension[ext];
      if (!original) continue;
      const wrapper: EmbedCreator = (ctx, file, subpath) => {
        const component = original(ctx, file, subpath);
        // The core component fills containerEl when it loads the file, and
        // may clear it first — so decorate after that too, not only now.
        const c = component as Component & { loadFile?: () => Promise<unknown> };
        const loadFile = c.loadFile?.bind(c);
        if (loadFile) {
          c.loadFile = async () => {
            const r = await loadFile();
            this.decorateEmbed(ctx.containerEl, file);
            return r;
          };
        }
        this.decorateEmbed(ctx.containerEl, file);
        return component;
      };
      // Through the registry's own API, not by assigning into the map —
      // assignment alone doesn't reach embeds (the same swap pdf-plus does).
      registry.unregisterExtension(ext);
      registry.registerExtension(ext, wrapper);
      this.wrappedEmbeds.set(ext, { original, wrapper });
    }
  }

  private unwrapMediaEmbeds() {
    const registry = embedRegistry(this.app);
    for (const [ext, { original, wrapper }] of this.wrappedEmbeds) {
      // Only undo our own wrap — if someone wrapped on top, leave theirs alone.
      if (registry?.embedByExtension[ext] === wrapper) {
        registry.unregisterExtension(ext);
        registry.registerExtension(ext, original);
      }
    }
    this.wrappedEmbeds.clear();
  }

  // Only when a transcript exists: an embed with nothing to show stays native.
  private decorateEmbed(containerEl: HTMLElement, file: TFile) {
    if (!containerEl || containerEl.querySelector(':scope > .mt-embed-btn')) return;
    if (!this.hasSubtitles(file)) return;

    containerEl.addClass('mt-embed');
    const btn = containerEl.createEl('button', {
      cls: 'mt-embed-btn',
      attr: { 'aria-label': 'Open the transcript beside this note' },
    });
    setIcon(btn.createSpan('mt-embed-btn-icon'), 'captions');
    btn.createSpan({ text: 'Transcript' });

    // Live Preview treats a press inside an embed as "edit the source".
    btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      // Hand over to the transcript where the inline player was, so two
      // players never talk over each other.
      const media = containerEl.querySelector('audio, video');
      let at: number | null = null;
      let playing = false;
      if (media instanceof HTMLMediaElement) {
        playing = !media.paused;
        if (media.currentTime > 0) at = media.currentTime;
        media.pause();
      }
      void this.openTranscript(file, at, playing);
    });
  }

  /**
   * Plain clicks on `[[talk.m4a]]` / `[[talk.m4a#t=83]]` in a note open the
   * transcript beside the note (and seek), instead of replacing the note.
   * Subtitle links too — they're what a timestamp link points at once the
   * media has moved out of the vault.
   * Modifier clicks (new tab / split / window) keep Obsidian's behaviour; the
   * view still honours `#t=` there via setEphemeralState.
   */
  private routeMediaLinks() {
    const ws = this.app.workspace;
    const original = ws.openLinkText;
    let active = true;
    const wrapper: typeof ws.openLinkText = async (linktext, sourcePath, newLeaf, openViewState) => {
      if (active && !newLeaf) {
        const { path, subpath } = parseLinktext(linktext);
        const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
        if (file && ((this.isMedia(file) && this.hasSubtitles(file)) || this.isSubtitle(file))) {
          await this.openTranscript(file, parseTimeFragment(subpath));
          return;
        }
        // Media that has left the vault: its transcript is what's still here.
        // Falling through would have Obsidian offer to create the missing file.
        const transcript = !file && this.cards.isMediaName(path) ? this.cards.transcriptFor(path) : null;
        if (transcript) {
          await this.openTranscript(transcript, parseTimeFragment(subpath));
          return;
        }
      }
      return original.call(ws, linktext, sourcePath, newLeaf, openViewState);
    };
    ws.openLinkText = wrapper;
    this.register(() => {
      active = false;
      if (ws.openLinkText === wrapper) ws.openLinkText = original;
    });
  }

  onunload() {
    this.unwrapMediaEmbeds();
    this.cards?.stop();
    // Release the extensions we took over (they stay registered otherwise).
    try {
      viewRegistry(this.app).unregisterExtensions([
        ...this.mediaExts(),
        ...CLICKABLE_SUBTITLE_EXTS,
      ]);
    } catch {
      // ignore
    }
  }

  /** Push the current transcript font size into every open transcript view. */
  applyFontSizeToOpenViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MEDIA_TRANSCRIPT)) {
      if (leaf.view instanceof MediaTranscriptView) {
        leaf.view.applyFontSize(this.settings.transcriptFontSize);
      }
    }
  }

  private mediaExts(): string[] {
    return [
      ...this.settings.supportedVideoExtensions,
      ...this.settings.supportedAudioExtensions,
    ];
  }

  private isMedia(file: TFile): boolean {
    const ext = file.extension.toLowerCase();
    return this.mediaExts().includes(ext);
  }

  private isSubtitle(file: TFile): boolean {
    return SUBTITLE_EXTENSIONS.includes(file.extension.toLowerCase());
  }

  private async openInView(file: TFile) {
    const leaf = this.app.workspace.getLeaf(false);
    await this.swapLeafToView(leaf, file);
  }

  // Point an existing leaf at our transcript view for the given file.
  private async swapLeafToView(leaf: WorkspaceLeaf, file: TFile) {
    await leaf.setViewState({
      type: VIEW_TYPE_MEDIA_TRANSCRIPT,
      state: { file: file.path },
      active: true,
    });
  }

  async loadSettings() {
    // loadData() is typed `any`; narrow it so the merge stays type-checked.
    const saved = (await this.loadData()) as Partial<MediaTranscriptSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
