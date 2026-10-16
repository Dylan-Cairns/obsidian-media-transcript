import { App, PluginSettingTab, Setting } from 'obsidian';
import type MediaTranscriptPlugin from './main';
import { parseFolderList } from './utils/mediaMatch';
import {
  MediaTranscriptView,
  VIEW_TYPE_MEDIA_TRANSCRIPT,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from './MediaTranscriptView';

export interface SubtitlePriority {
  marker: string;
  label: string;
}

export interface MediaTranscriptSettings {
  // ── Subtitle matching ────────────────────────────────────────────────────
  subtitleDirectory: string;
  priorities: SubtitlePriority[];

  // ── Media lookup ─────────────────────────────────────────────────────────
  // Where to look for a subtitle's media after its own folder, in order.
  // Vault-relative folders, or absolute ones outside the vault (desktop only).
  mediaFolders: string[];
  // Then these URL prefixes, e.g. a home server over Tailscale. Streamed.
  mediaUrls: string[];
  // Ask those servers before looking on disk at all.
  preferRemote: boolean;
  // Media picked by hand for a transcript that can't name its own (an .srt or
  // .vtt has nowhere to keep a `source`): transcript path → media filename.
  mediaLinks: Record<string, string>;

  // ── Media file types ─────────────────────────────────────────────────────
  supportedVideoExtensions: string[];
  supportedAudioExtensions: string[];

  // ── Layout ───────────────────────────────────────────────────────────────
  playerWidthPercent: number; // video: left player width (%), remembered after dragging the divider
  transcriptFontSize: number; // transcript text size in px (A−/A+ buttons update this too)

  // ── Playback ─────────────────────────────────────────────────────────────
  autoScroll: boolean;      // keep the playing line centered in the transcript
  videoAudioOnly: boolean;  // play videos without showing the picture
}

export const DEFAULT_SETTINGS: MediaTranscriptSettings = {
  subtitleDirectory: '',
  priorities: [{ marker: '', label: 'Default (no marker)' }],
  mediaFolders: [],
  mediaUrls: [],
  preferRemote: false,
  mediaLinks: {},
  supportedVideoExtensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'],
  supportedAudioExtensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'],
  playerWidthPercent: 75,
  transcriptFontSize: 15,
  autoScroll: true,
  videoAudioOnly: false,
};

// ── Settings Tab ──────────────────────────────────────────────────────────────

export class MediaTranscriptSettingTab extends PluginSettingTab {
  plugin: MediaTranscriptPlugin;

  constructor(app: App, plugin: MediaTranscriptPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Obsidian shows the plugin name as the heading automatically.
    new Setting(containerEl).setName('Subtitles').setHeading();

    new Setting(containerEl)
      .setName('Subtitle folder')
      .setDesc("Leave empty to use each media file's own folder (reads a same-named .json / .srt / .vtt).")
      .addText(t =>
        t.setPlaceholder("Empty = media file's folder")
          .setValue(this.plugin.settings.subtitleDirectory)
          .onChange(async v => {
            this.plugin.settings.subtitleDirectory = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Subtitle priority')
      .setDesc('Order of filename [marker] tags, comma-separated (empty = no marker, e.g. video.srt).')
      .addText(t =>
        t.setPlaceholder('vibevoice-4bit, whisper,')
          .setValue(this.plugin.settings.priorities.map(p => p.marker).join(', '))
          .onChange(async v => {
            const markers = v.split(',').map(s => s.trim()).filter((m, i, a) => a.indexOf(m) === i);
            this.plugin.settings.priorities = markers.map(m => ({ marker: m, label: m || 'Default' }));
            await this.plugin.saveSettings();
          }),
      );

    // ── Media ───────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Media').setHeading();

    new Setting(containerEl)
      .setName('Media folders')
      .setDesc(
        "Where to find a transcript's audio/video when it isn't in the transcript's own folder. " +
          'One folder per line, searched in order, subfolders included; matched by filename. ' +
          'A vault folder (附件/media) or, on desktop, an absolute folder outside the vault ' +
          '(/Volumes/2T/Media, ~/Recordings). With no media found, the transcript opens for reading only.',
      )
      .addTextArea(t => {
        t.setPlaceholder('附件/media\n/Volumes/2T/Media')
          .setValue(this.plugin.settings.mediaFolders.join('\n'))
          .onChange(async v => {
            this.plugin.settings.mediaFolders = parseFolderList(v);
            await this.plugin.saveSettings();
            this.plugin.mediaLocator.invalidate();
          });
        t.inputEl.rows = 4;
      });

    new Setting(containerEl)
      .setName('Remote media URLs')
      .setDesc(
        'Searched after the folders above: a server holding the media, streamed with seeking — ' +
          'e.g. a home computer over Tailscale (https://old-mac.example.ts.net/recordings). ' +
          'One URL per line. A server with an index.json (written by the offload script) can keep files ' +
          'in any folders; otherwise files are expected directly under the URL, by name. ' +
          "If a server doesn't answer within 5 seconds, the transcript opens for reading only.",
      )
      .addTextArea(t => {
        t.setPlaceholder('https://old-mac.example.ts.net/recordings')
          .setValue(this.plugin.settings.mediaUrls.join('\n'))
          .onChange(async v => {
            this.plugin.settings.mediaUrls = parseFolderList(v);
            await this.plugin.saveSettings();
            this.plugin.mediaLocator.invalidate();
          });
        t.inputEl.rows = 3;
      });

    new Setting(containerEl)
      .setName('Play from a server first')
      .setDesc(
        'Look for media on the servers above before the vault and media folders, and use the vault copy ' +
          "only when no server has it or none answers. Useful when local copies live in iCloud and " +
          'would have to download before playing.',
      )
      .addToggle(t =>
        t.setValue(this.plugin.settings.preferRemote).onChange(async v => {
          this.plugin.settings.preferRemote = v;
          await this.plugin.saveSettings();
        }),
      );

    // ── Layout ──────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Layout').setHeading();

    new Setting(containerEl)
      .setName('Video pane width')
      .setDesc(
        'How much horizontal space the video takes in video mode (the rest goes to the transcript). ' +
          '75% ≈ 3:1, 67% ≈ 2:1, 50% = 1:1. Dragging the divider updates this too. Audio mode is always full-width.',
      )
      .addSlider(s =>
        s
          .setLimits(20, 75, 1)
          .setValue(this.plugin.settings.playerWidthPercent)
          .onChange(async v => {
            this.plugin.settings.playerWidthPercent = v;
            await this.plugin.saveSettings();
            // Live-apply to any open video views.
            for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MEDIA_TRANSCRIPT)) {
              if (leaf.view instanceof MediaTranscriptView) leaf.view.applyPlayerWidth(v);
            }
          }),
      );

    new Setting(containerEl)
      .setName('Transcript font size')
      .setDesc(
        `Text size of the transcript, in pixels (${MIN_FONT_SIZE}–${MAX_FONT_SIZE}). ` +
          'The A− / A+ buttons in the transcript toolbar change this too.',
      )
      .addSlider(s =>
        s
          .setLimits(MIN_FONT_SIZE, MAX_FONT_SIZE, 1)
          .setValue(this.plugin.settings.transcriptFontSize)
          .onChange(async v => {
            this.plugin.settings.transcriptFontSize = v;
            await this.plugin.saveSettings();
            this.plugin.applyFontSizeToOpenViews();
          }),
      );

    // ── Playback ────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Playback').setHeading();

    new Setting(containerEl)
      .setName('Auto-scroll transcript')
      .setDesc(
        'While playing, keep the current line vertically centered. ' +
          'Scrolling by hand pauses this for a few seconds so you can read ahead.',
      )
      .addToggle(t =>
        t.setValue(this.plugin.settings.autoScroll).onChange(async v => {
          this.plugin.settings.autoScroll = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Play videos as audio only')
      .setDesc(
        "Don't show the picture for video files — a slim control bar and a full-width " +
          'transcript instead. The 🎧 / 🎬 button in the transcript toolbar toggles this per view.',
      )
      .addToggle(t =>
        t.setValue(this.plugin.settings.videoAudioOnly).onChange(async v => {
          this.plugin.settings.videoAudioOnly = v;
          await this.plugin.saveSettings();
          for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MEDIA_TRANSCRIPT)) {
            if (leaf.view instanceof MediaTranscriptView) await leaf.view.applyAudioOnly();
          }
        }),
      );
  }
}
