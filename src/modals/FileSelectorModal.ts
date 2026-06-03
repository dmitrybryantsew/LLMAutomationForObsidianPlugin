import { 
    App, 
    Setting, 
    Modal, 
  } from "obsidian";

  import type GptFreeTextGeneratorPlugin from '../main'; 

class FileSelectorModal extends Modal {
  private onSelect: (filePath: string) => void;
  private folder: string;

  constructor(app: App, folder: string, onSelect: (filePath: string) => void) {
    super(app);
    this.folder = folder;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Select History File" });

    // Get all files from the history folder
    this.app.vault.adapter.list(this.folder).then(({ files }) => {
      files.forEach(filePath => {
        if (filePath.endsWith('.md')) {
          new Setting(contentEl)
            .setName(filePath.split('/').pop() || '')
            .addButton(btn => btn
              .setButtonText("Load")
              .onClick(() => {
                this.onSelect(filePath);
                this.close();
              }));
        }
      });
    });
  }
}

export { FileSelectorModal };