
import { App, SuggestModal, TFile } from "obsidian";

/**
 * Modal to select an existing Markdown file from the vault.
 */
export class VaultFileSelectorModal extends SuggestModal<TFile> {
  private onSelect: (file: TFile) => void;

  constructor(app: App, onSelect: (file: TFile) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Type to filter files...");
  }

  // Returns all available markdown and PDF files
  getSuggestions(query: string): TFile[] {
    const allFiles = this.app.vault.getFiles();
    const supportedFiles = allFiles.filter(file => 
      file.extension === 'md' || file.extension === 'pdf'
    );
    
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