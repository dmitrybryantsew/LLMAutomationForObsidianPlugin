import { App, Modal, Setting, TFile, normalizePath } from "obsidian";
import * as path from 'path';

interface SelectedFile {
  path: string;
  name: string;
  content?: string;
}

class FilePickerModal extends Modal {
  private selectedFiles: Map<string, SelectedFile> = new Map();
  private onChoose: (files: SelectedFile[]) => void;
  private fileListEl!: HTMLElement;  // Using definite assignment assertion
  private previewEl: HTMLElement | null = null;

  constructor(app: App, onChoose: (files: SelectedFile[]) => void) {
    super(app);
    this.onChoose = onChoose;
  }

  async openSystemFileDialog() {
    // Use HTML5 file input as a fallback for system file picker
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '*.*';

    input.onchange = async (e: Event) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            const content = await file.text();
            await this.addFile({
              path: file.name,  // Using filename as path since we have the content
              name: file.name,
              content: content
            });
          } catch (error) {
            console.error('Error reading file:', error);
          }
        }
      }
    };

    input.click();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("file-picker-modal");

    // Add title
    contentEl.createEl("h2", { text: "Select Files for Context" });

    // Create main layout
    const mainContainer = contentEl.createDiv({ cls: "file-picker-container" });
    
    // Create file selection area
    const selectionArea = mainContainer.createDiv({ cls: "file-selection-area" });
    
    // Add file picker button
    new Setting(selectionArea)
      .addButton((btn) =>
        btn
          .setButtonText("Choose Files")
          .setCta()
          .onClick(() => {
            this.openSystemFileDialog();
          }));

    // Add vault file browser button
    new Setting(selectionArea)
      .addButton((btn) =>
        btn
          .setButtonText("Browse Vault Files")
          .onClick(() => {
            // You could add vault file browsing here if needed
          }));

    // Create selected files list
    this.fileListEl = selectionArea.createDiv({ cls: "selected-files-list" });

    // Create preview area
    this.previewEl = mainContainer.createDiv({ cls: "file-preview-area" });
    this.previewEl.createEl("div", { 
      text: "Select a file to preview its contents",
      cls: "preview-placeholder" 
    });

    // Add confirmation buttons
    const buttonContainer = contentEl.createDiv({ cls: "file-picker-buttons" });
    
    new Setting(buttonContainer)
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .onClick(() => {
            this.close();
          }))
      .addButton((btn) =>
        btn
          .setButtonText("Add Selected")
          .setCta()
          .onClick(() => {
            this.onChoose(Array.from(this.selectedFiles.values()));
            this.close();
          }));

    // Add styles
    this.addStyles();
  }

  private async addFile(fileInfo: SelectedFile) {
    if (this.selectedFiles.has(fileInfo.path)) {
      return;
    }

    this.selectedFiles.set(fileInfo.path, fileInfo);
    this.updateFileList();
  }

  private updateFileList() {
    this.fileListEl.empty();

    for (const [filePath, fileInfo] of this.selectedFiles) {
      const fileItem = this.fileListEl.createDiv({ cls: "file-item" });

      // Add file icon based on extension
      const iconEl = fileItem.createSpan({ cls: "file-icon" });
      iconEl.innerHTML = this.getFileIcon(fileInfo.name);

      // Add file name
      fileItem.createSpan({ text: fileInfo.name, cls: "file-name" });

      // Add preview button
      const previewButton = fileItem.createEl("button", { 
        cls: "file-preview-button",
        text: "Preview"
      });
      previewButton.onclick = () => this.showPreview(fileInfo);

      // Add remove button
      const removeButton = fileItem.createEl("button", {
        cls: "file-remove-button",
        text: "×"
      });
      removeButton.onclick = () => {
        this.selectedFiles.delete(filePath);
        this.updateFileList();
      };
    }
  }

  private showPreview(file: SelectedFile) {
    if (!this.previewEl) return;

    this.previewEl.empty();

    // Add preview header
    const previewHeader = this.previewEl.createDiv({ cls: "preview-header" });
    previewHeader.createEl("h3", { text: `Preview: ${file.name}` });
    previewHeader.createEl("button", { 
      text: "Close",
      cls: "preview-close-button"
    }).onclick = () => this.closePreview();

    // Add content
    const previewContent = this.previewEl.createEl("pre", { cls: "preview-content" });
    previewContent.createEl("code", { text: file.content });
  }

  private closePreview() {
    if (!this.previewEl) return;
    
    this.previewEl.empty();
    this.previewEl.createEl("div", { 
      text: "Select a file to preview its contents",
      cls: "preview-placeholder" 
    });
  }

  private getFileIcon(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const icons: { [key: string]: string } = {
      '.js': '📜',
      '.ts': '📜',
      '.py': '🐍',
      '.md': '📝',
      '.txt': '📄',
      '.json': '{}',
      '.html': '🌐',
      '.css': '🎨',
      '.cpp': '⚙️',
      '.h': '📐',
      '.java': '☕',
    };
    return icons[ext] || '📄';
  }

  private addStyles() {
    const styles = `
      .file-picker-modal {
        width: 80vw;
        height: 80vh;
        display: flex;
        flex-direction: column;
      }

      .file-picker-container {
        display: flex;
        flex: 1;
        gap: 20px;
        min-height: 0;
      }

      .file-selection-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--background-modifier-border);
        padding-right: 20px;
      }

      .selected-files-list {
        flex: 1;
        overflow-y: auto;
        margin-top: 20px;
      }

      .file-item {
        display: flex;
        align-items: center;
        padding: 8px;
        margin: 4px 0;
        border-radius: 4px;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
      }

      .file-icon {
        margin-right: 8px;
        font-size: 1.2em;
      }

      .file-name {
        flex: 1;
        margin-right: 8px;
      }

      .file-preview-button,
      .file-remove-button {
        padding: 4px 8px;
        margin-left: 8px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        background: var(--interactive-normal);
        color: var(--text-normal);
      }

      .file-remove-button {
        background: var(--text-error-bg);
        color: var(--text-error);
      }

      .file-preview-area {
        flex: 1;
        overflow-y: auto;
        background: var(--background-primary);
        border-radius: 4px;
        padding: 16px;
      }

      .preview-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }

      .preview-content {
        white-space: pre-wrap;
        overflow-x: auto;
        background: var(--code-background);
        padding: 16px;
        border-radius: 4px;
      }

      .preview-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
      }

      .file-picker-buttons {
        margin-top: 20px;
        border-top: 1px solid var(--background-modifier-border);
        padding-top: 20px;
      }
    `;

    const styleEl = document.head.createEl('style');
    styleEl.textContent = styles;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
export {FilePickerModal}