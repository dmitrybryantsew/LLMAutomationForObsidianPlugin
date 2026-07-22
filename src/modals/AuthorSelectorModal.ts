import { App, SuggestModal, TFile } from "obsidian";

/**
 * Modal to select an author value from vault frontmatter.
 * Scans all markdown files for an "author" property and lists unique values.
 */
export class AuthorSelectorModal extends SuggestModal<string> {
  private onSelect: (author: string) => void;
  private authors: string[] = [];

  constructor(app: App, onSelect: (author: string) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Type to filter authors...");
    this.authors = this.collectAuthors();
  }

  private collectAuthors(): string[] {
    const authorSet = new Set<string>();
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      if (!frontmatter) continue;

      // Check both "author" and "channel" properties (video summaries use "author" = channel name)
      const authorValue = frontmatter.author ?? frontmatter.channel;
      if (!authorValue) continue;

      // Could be a string or an array — handle both
      if (Array.isArray(authorValue)) {
        for (const v of authorValue) {
          if (typeof v === 'string' && v.trim()) authorSet.add(v.trim());
        }
      } else if (typeof authorValue === 'string' && authorValue.trim()) {
        authorSet.add(authorValue.trim());
      }
    }

    return Array.from(authorSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  getSuggestions(query: string): string[] {
    if (!query) return this.authors;

    const lowerQuery = query.toLowerCase();
    return this.authors.filter(author => author.toLowerCase().includes(lowerQuery));
  }

  renderSuggestion(author: string, el: HTMLElement): void {
    el.createEl("div", { text: author });
    // Show note count for this author
    const count = this.countNotesByAuthor(author);
    el.createEl("small", { text: `${count} note${count !== 1 ? 's' : ''}`, cls: "quick-switcher-path" });
  }

  onChooseSuggestion(author: string): void {
    this.onSelect(author);
  }

  private countNotesByAuthor(author: string): number {
    let count = 0;
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;
      const value = fm.author ?? fm.channel;
      if (!value) continue;
      if (Array.isArray(value) && value.includes(author)) { count++; continue; }
      if (value === author) count++;
    }
    return count;
  }
}
