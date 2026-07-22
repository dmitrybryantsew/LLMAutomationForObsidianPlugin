import { App, FuzzySuggestModal, TFolder } from "obsidian";

/**
 * Modal for selecting a folder from the vault.
 * Uses Obsidian's built-in FuzzySuggestModal with all top-level folders.
 */
export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  private folders: TFolder[];
  private onChoose: (folder: TFolder) => void;

  constructor(app: App, onChoose: (folder: TFolder) => void) {
    super(app);
    this.onChoose = onChoose;
    // Collect all folders in the vault
    this.folders = this.collectFolders(app.vault.getRoot());
  }

  private collectFolders(root: TFolder, out: TFolder[] = []): TFolder[] {
    for (const child of root.children) {
      if (child instanceof TFolder) {
        out.push(child);
        this.collectFolders(child, out);
      }
    }
    return out;
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(item: TFolder): string {
    return item.path;
  }

  onChooseItem(item: TFolder, _evt: MouseEvent | KeyboardEvent): void {
    this.onChoose(item);
  }
}
