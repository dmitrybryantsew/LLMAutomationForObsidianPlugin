import { App, FuzzySuggestModal, TFile } from 'obsidian';

/**
 * Note picker for selecting any markdown file in the vault.
 * Used in flashcard focus mode where the file explorer is hidden.
 */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.files = app.vault.getMarkdownFiles();
    this.setPlaceholder('Find note for flashcard question...');
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile, _evt: MouseEvent | KeyboardEvent): void {
    this.onChoose(item);
  }
}
