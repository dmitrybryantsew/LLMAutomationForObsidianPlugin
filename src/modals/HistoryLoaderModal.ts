import {
    App,
    Modal,
    Setting,
    TFile,
  } from "obsidian";
  import type GptFreeTextGeneratorPlugin from '../main';

  interface HistoryMetadata {
    id: string;
    date_created: string;
    model: string;
    total_interactions: number;
    title?: string;
  }
  
  class HistoryLoaderModal extends Modal {
    private plugin: GptFreeTextGeneratorPlugin;
    private onSelect: (filePath: string) => void;
    private currentPath: string[];
    private loading: boolean = false;
  
    constructor(app: App, plugin: GptFreeTextGeneratorPlugin, onSelect: (filePath: string) => void) {
      super(app);
      this.plugin = plugin;
      this.onSelect = onSelect;
      this.currentPath = ["GeneratedText"];
    }
  
    async onOpen() {
      const { contentEl } = this;
      contentEl.empty();
  
      // Add header with navigation
      const headerEl = contentEl.createEl("div", { cls: "history-loader-header" });
      headerEl.createEl("h2", { text: "Load Conversation History" });
  
      // Add breadcrumb navigation
      const breadcrumbEl = headerEl.createEl("div", { cls: "history-breadcrumb" });
      this.updateBreadcrumbs(breadcrumbEl);
  
      // Add search box
      const searchEl = new Setting(contentEl)
        .setName("Search")
        .addText(text => text
          .setPlaceholder("Search conversations...")
          .onChange(async (value) => {
            if (value.length >= 2) {
              await this.displaySearchResults(value);
            } else if (value.length === 0) {
              await this.displayCurrentFolder();
            }
          }));
  
      // Add content container
      const contentContainer = contentEl.createEl("div", { cls: "history-content" });
      await this.displayCurrentFolder(contentContainer);
  
      // Add styles
      this.addStyles();
    }
  
    private formatDate(dateStr: string): string {
      try {
        const date = new Date(dateStr);
        return date.toLocaleString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (e) {
        return dateStr;
      }
    }
  
    private addStyles() {
      const styles = `
        .history-loader-header {
          margin-bottom: 20px;
        }
        .history-breadcrumb {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 10px;
          flex-wrap: wrap;
        }
        .breadcrumb-item {
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .breadcrumb-item:hover {
          background: var(--background-modifier-hover);
        }
        .history-content {
          max-height: 400px;
          overflow-y: auto;
          margin-top: 10px;
        }
        .history-item {
          padding: 10px;
          margin: 5px 0;
          border-radius: 4px;
          border: 1px solid var(--background-modifier-border);
        }
        .history-item:hover {
          background: var(--background-modifier-hover);
        }
        .history-item-title {
          font-weight: bold;
          margin-bottom: 5px;
        }
        .history-item-meta {
          font-size: 0.8em;
          color: var(--text-muted);
        }
        .folder-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          cursor: pointer;
        }
        .folder-item:hover {
          background: var(--background-modifier-hover);
        }
      `;
  
      const styleEl = document.createElement('style');
      styleEl.textContent = styles;
      document.head.appendChild(styleEl);
    }
  
    private updateBreadcrumbs(containerEl: HTMLElement) {
      containerEl.empty();
      this.currentPath.forEach((part, index) => {
        if (index > 0) {
          containerEl.createSpan({ text: " > " });
        }
        containerEl.createSpan({
          text: part,
          cls: "breadcrumb-item",
          attr: { "data-index": index.toString() }
        }).addEventListener("click", () => {
          this.currentPath = this.currentPath.slice(0, index + 1);
          this.refreshDisplay();
        });
      });
    }
  
    private async displayCurrentFolder(containerEl?: HTMLElement) {
      if (this.loading) return;
      this.loading = true;
  
      const container = containerEl || this.contentEl.querySelector(".history-content");
      if (!container) return;
  
      container.empty();
      const fullPath = `${this.plugin.settings.historyFolder}/${this.currentPath.join("/")}`;
  
      try {
        const { folders, files } = await this.app.vault.adapter.list(fullPath);
        
        // Sort folders in reverse chronological order
        folders.sort((a, b) => b.localeCompare(a));
        
        // Display folders
        for (const folder of folders) {
          const folderName = folder.split("/").pop();
          if (!folderName) continue;
  
          const folderEl = container.createEl("div", { cls: "folder-item" });
          folderEl.createEl("span", { text: "📁" });
          folderEl.createEl("span", { text: folderName });
          folderEl.addEventListener("click", () => {
            this.currentPath.push(folderName);
            this.refreshDisplay();
          });
        }
  
        // Display conversation files
        for (const file of files) {
          if (!file.endsWith("conversation.md")) continue;
          const metadata = await this.getConversationMetadata(file);
          if (!metadata) continue;
  
          const itemEl = container.createEl("div", { cls: "history-item" });
          itemEl.createEl("div", { 
            cls: "history-item-title",
            text: metadata.title || metadata.id 
          });
          itemEl.createEl("div", { 
            cls: "history-item-meta",
            text: `Created: ${this.formatDate(metadata.date_created)} | Model: ${metadata.model} | Messages: ${metadata.total_interactions}`
          });
  
          new Setting(itemEl)
            .addButton(btn => btn
              .setButtonText("Load")
              .onClick(() => {
                this.onSelect(file);
                this.close();
              }));
        }
      } catch (error) {
        console.error("Error loading history:", error);
        container.createEl("div", { text: "Error loading history files" });
      }
  
      this.loading = false;
    }
  
    private async displaySearchResults(query: string) {
      const container = this.contentEl.querySelector(".history-content");
      if (!container) return;
      container.empty();
  
      const results = await this.searchConversations(query);
      results.forEach(result => {
        const itemEl = container.createEl("div", { cls: "history-item" });
        itemEl.createEl("div", { text: result.id, cls: "history-item-title" });
        itemEl.createEl("div", { 
          text: `Created: ${this.formatDate(result.date_created)} | Model: ${result.model}`,
          cls: "history-item-meta"
        });
  
        new Setting(itemEl)
          .addButton(btn => btn
            .setButtonText("Load")
            .onClick(() => {
              this.onSelect(result.filePath);
              this.close();
            }));
      });
    }
  
    private async getConversationMetadata(filePath: string): Promise<HistoryMetadata | null> {
      try {
        const content = await this.app.vault.adapter.read(filePath);
        const metadataMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!metadataMatch) return null;
  
        const metadata: any = {};
        metadataMatch[1].split("\n").forEach(line => {
          const [key, value] = line.split(": ");
          if (key && value) {
            metadata[key.trim()] = value.trim();
          }
        });
  
        return metadata;
      } catch (error) {
        console.error("Error reading metadata:", error);
        return null;
      }
    }
  
    private async searchConversations(query: string) {
      const results: (HistoryMetadata & { filePath: string })[] = [];
      const baseFolder = `${this.plugin.settings.historyFolder}/GeneratedText`;
  
      const searchInFolder = async (folderPath: string) => {
        const { folders, files } = await this.app.vault.adapter.list(folderPath);
  
        for (const file of files) {
          if (!file.endsWith("conversation.md")) continue;
  
          const metadata = await this.getConversationMetadata(file);
          if (!metadata) continue;
  
          const searchableContent = `${metadata.id} ${metadata.title || ""}`.toLowerCase();
          if (searchableContent.includes(query.toLowerCase())) {
            results.push({ ...metadata, filePath: file });
          }
        }
  
        for (const folder of folders) {
          await searchInFolder(folder);
        }
      };
  
      await searchInFolder(baseFolder);
      return results;
    }
  
    private async refreshDisplay() {
      const breadcrumbEl = this.contentEl.querySelector(".history-breadcrumb");
      if (breadcrumbEl instanceof HTMLElement) {
        this.updateBreadcrumbs(breadcrumbEl);
      }
      await this.displayCurrentFolder();
    }
  
    onClose() {
      const { contentEl } = this;
      contentEl.empty();
    }
  }
  
  export { HistoryLoaderModal };