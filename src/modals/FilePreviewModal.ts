import { App, Modal, Setting, TFile, normalizePath } from "obsidian";
class FilePreviewModal extends Modal {
    private content: string;
    private fileName: string;
  
    constructor(app: App, fileName: string, content: string) {
      super(app);
      this.fileName = fileName;
      this.content = content;
    }
  
    onOpen() {
      const { contentEl } = this;
      contentEl.empty();
      
      contentEl.createEl("h2", { text: `Preview: ${this.fileName}` });
      
      const previewContainer = contentEl.createDiv({ cls: "preview-container" });
      const pre = previewContainer.createEl("pre");
      pre.createEl("code", { text: this.content });
  
      new Setting(contentEl)
        .addButton((btn) =>
          btn
            .setButtonText("Close")
            .onClick(() => {
              this.close();
            }));
  
      // Add styles
      contentEl.addClass("file-preview-modal");
      document.head.createEl("style", {
        text: `
          .file-preview-modal {
            width: 60vw;
            height: 70vh;
          }
          .file-preview-modal .preview-container {
            max-height: calc(70vh - 100px);
            overflow: auto;
            margin: 1em 0;
            padding: 1em;
            background: var(--code-background);
            border-radius: 4px;
          }
          .file-preview-modal pre {
            margin: 0;
            white-space: pre-wrap;
          }
        `
      });
    }
  
    onClose() {
      const { contentEl } = this;
      contentEl.empty();
    }
  }
  export { FilePreviewModal };