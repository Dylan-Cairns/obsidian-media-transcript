import { App, Modal, TFile, setIcon } from 'obsidian';
import { formatSize } from '../utils/format';
import { t } from '../i18n';

export interface PreviewItem {
  kind: 'image' | 'video' | 'other';
  src: string;               // the archived copy
  title: string;             // the note it is in, or what it is called
  fileName: string;          // the original file's name, from its link
  size: number;
  modified: string;
  url?: string;              // where it was saved from
  notes: TFile[];
  transcript?: TFile;
  canTranscribe: boolean;
}

export interface PreviewActions {
  openNote(note: TFile): void;
  openTranscript(file: TFile): void;
  transcribe(): void;
  delete(): void;
}

/**
 * An archived image or video, looked at where it is: the media library stays
 * underneath, and closing (or going back, on a phone) returns to it. What to
 * do with it next is below: its notes, its original link, its transcript.
 */
export class ArchivePreview extends Modal {
  constructor(app: App, private readonly item: PreviewItem, private readonly actions: PreviewActions) {
    super(app);
  }

  onOpen(): void {
    const { item, actions } = this;
    this.modalEl.addClass('mo-preview');
    this.setTitle(item.title);
    const { contentEl } = this;
    const stage = contentEl.createDiv('mo-preview-stage');
    if (item.kind === 'image') stage.createEl('img', { attr: { src: item.src, alt: item.fileName } });
    else if (item.kind === 'video') stage.createEl('video', { attr: { src: item.src, controls: '', playsinline: '', preload: 'metadata' } });
    else setIcon(stage.createDiv('mo-preview-file'), 'file');

    const facts = contentEl.createDiv('mo-preview-facts');
    facts.createDiv({ cls: 'mo-preview-name', text: item.fileName });
    facts.createDiv({ cls: 'mo-preview-meta', text: `${formatSize(item.size)} · ${item.modified.slice(0, 10)}` });

    const bar = contentEl.createDiv('mo-preview-actions');
    const button = (icon: string, text: string, onClick: () => void, cls = '') => {
      const b = bar.createEl('button', { cls });
      setIcon(b.createSpan('mo-preview-icon'), icon);
      b.appendText(text);
      b.addEventListener('click', () => {
        this.close();
        onClick();
      });
    };
    for (const note of item.notes.slice(0, 3)) {
      button('file-text', item.notes.length > 1 ? note.basename : t('library.previewOpenNote'), () => actions.openNote(note));
    }
    if (item.transcript) {
      const tr = item.transcript;
      button('captions', t('library.menuOpenTranscript'), () => actions.openTranscript(tr));
    } else if (item.canTranscribe) {
      button('captions', t('library.menuTranscribe'), () => actions.transcribe());
    }
    if (item.url) {
      const url = item.url;
      button('external-link', t('library.previewOriginal'), () => { window.open(url); });
    }
    button('trash-2', t('library.menuDeleteCopy'), () => actions.delete(), 'mod-warning');
  }

  onClose(): void {
    this.contentEl.querySelector('video')?.pause();
    this.contentEl.empty();
  }
}
