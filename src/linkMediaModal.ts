import { App, SuggestModal } from 'obsidian';
import type { MediaChoice } from './mediaLocator';
import { t } from './i18n';

/** Pick, from every media file we can see, the one a transcript belongs to. */
export class LinkMediaModal extends SuggestModal<MediaChoice> {
  constructor(app: App, private choices: MediaChoice[], private onPick: (choice: MediaChoice) => void) {
    super(app);
    this.setPlaceholder(t('core.linkMediaPlaceholder'));
    this.limit = 200;
  }

  getSuggestions(query: string): MediaChoice[] {
    const q = query.trim().toLowerCase();
    return q ? this.choices.filter(c => c.name.toLowerCase().includes(q)) : this.choices;
  }

  renderSuggestion(choice: MediaChoice, el: HTMLElement) {
    el.createDiv({ text: choice.name });
    el.createEl('small', { cls: 'mt-link-where', text: choice.where });
  }

  onChooseSuggestion(choice: MediaChoice) {
    this.onPick(choice);
  }
}
