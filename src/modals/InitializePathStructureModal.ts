// modals/InitializePathStructureModal.ts

import { App, Modal, Setting, Notice, ButtonComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';

export class InitializePathStructureModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private isProcessing: boolean = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Initialize Path Structure" });
    
    // Check if structure already exists
    const structureExists = await this.plugin.services.pathManager.rootStructureExists();
    
    if (structureExists) {
      contentEl.createEl("p", { 
        text: "A path structure already exists in your vault. Reinitializing will not affect existing domains but may overwrite the root index file.",
        cls: "warning-text"
      });
    } else {
      contentEl.createEl("p", { 
        text: "This will create the initial folder structure for organizing your knowledge paths:",
        cls: "info-text" 
      });
      
      const structurePreview = contentEl.createEl("div", { cls: "structure-preview" });
      structurePreview.createEl("pre", { 
        text: 
`[Vault Root]/
├── Paths/
│   ├── path_structure.json
│   ├── backups/
│   └── Domains/
│       └── index.md`
      });
    }
    
    // Add buttons
    const buttonContainer = contentEl.createDiv("modal-button-container");
    
    // Initialize button
    const initButton = new ButtonComponent(buttonContainer)
      .setButtonText(structureExists ? "Reinitialize Structure" : "Initialize Structure")
      .setCta()
      .onClick(async () => {
        await this.initializeStructure(initButton);
      });
    
    // Cancel button
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => {
        this.close();
      });
    
    // Add styles
    contentEl.createEl("style", {
      text: `
        .structure-preview {
          background: var(--background-secondary);
          padding: 10px;
          border-radius: 5px;
          margin-top: 15px;
          margin-bottom: 15px;
        }
        .structure-preview pre {
          margin: 0;
          font-family: monospace;
        }
        .warning-text {
          color: var(--text-warning);
        }
        .info-text {
          color: var(--text-normal);
        }
        .modal-button-container {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }
      `
    });
  }
  
  private async initializeStructure(button: ButtonComponent) {
    if (this.isProcessing) {
      return;
    }
    
    try {
      this.isProcessing = true;
      button.setButtonText("Initializing...").setDisabled(true);
      
      // Create the structure
      await this.plugin.services.pathManager.createRootStructure();
      
      new Notice("Path structure initialized successfully");
      this.close();
    } catch (error) {
      if (error instanceof Error) {
        new Notice(`Failed to initialize structure: ${error.message}`);
      } else {
        new Notice("Failed to initialize structure");
      }
    } finally {
      this.isProcessing = false;
      button.setButtonText("Initialize Structure").setDisabled(false);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}