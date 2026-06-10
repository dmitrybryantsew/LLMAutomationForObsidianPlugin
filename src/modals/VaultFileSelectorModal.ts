
import { App, SuggestModal, TFile } from "obsidian";

export interface VaultFileSelectorOptions {
  placeholder?: string;
  filter?: (file: TFile) => boolean;
}

/**
 * Modal to select an existing vault file.
 */
export class VaultFileSelectorModal extends SuggestModal<TFile> {
  private onSelect: (file: TFile) => void;
  private filter: (file: TFile) => boolean;

  constructor(app: App, onSelect: (file: TFile) => void, options: VaultFileSelectorOptions = {}) {
    super(app);
    this.onSelect = onSelect;
    this.filter = options.filter ?? ((file) => file.extension === 'md' || file.extension === 'pdf');
    this.setPlaceholder(options.placeholder ?? "Type to filter files...");
  }

  // Returns all available files accepted by the configured filter
  getSuggestions(query: string): TFile[] {
    const allFiles = this.app.vault.getFiles();
    const supportedFiles = allFiles.filter((file) => this.filter(file));
    
    if (!query) {
      return supportedFiles;
    }
    
    const lowerCaseQuery = query.toLowerCase();
    // Filter files by filename (case-insensitive)
    // Also allow searching by path for better selection
    return supportedFiles.filter(file => 
      file.basename.toLowerCase().includes(lowerCaseQuery) ||
      file.path.toLowerCase().includes(lowerCaseQuery) // Add path search
    );
  }

  // Renders each suggestion item
  renderSuggestion(file: TFile, el: HTMLElement): void {
    // Display the filename (basename) for clarity
    el.createEl("div", { text: file.basename });
    // Optionally display the path as well in a smaller font
    el.createEl("small", { text: file.path, cls: "quick-switcher-path" });
  }

  // Called when a suggestion is selected (CORRECTED METHOD NAME)
  onChooseSuggestion(item: TFile, evt: MouseEvent | KeyboardEvent): void {
    this.onSelect(item); // Call the user-provided callback
  }
}
