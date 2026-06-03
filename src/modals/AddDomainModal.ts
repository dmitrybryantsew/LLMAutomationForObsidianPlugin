
import { App, Modal, Setting, Notice, ButtonComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { Domain } from "../utils/pathStructure/types"; // Assuming Domain type is needed

export class AddDomainModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private domainName: string = "";
  private domainDescription: string = "";
  private isProcessing: boolean = false;
  private existingDomains: Domain[] = []; // To check for duplicates


  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() { // Make onOpen async to load existing structure
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Add New Knowledge Domain" });

    // Load existing domains from the cached structure
    try {
        const structure = this.plugin.services.pathManager.getStructure();
        this.existingDomains = structure.structure.domains;
    } catch (error) {
        new Notice("Failed to load existing domains: " + (error instanceof Error ? error.message : "Unknown error"));
        // Don't close the modal, allow creation, but maybe warn about potential duplicates
        console.error("Failed to load existing domains:", error);
    }
    
    // Domain name input
    new Setting(contentEl)
      .setName("Domain Name")
      .setDesc("Enter the name of the knowledge domain (e.g., Programming, Psychology, Art)")
      .addText(text => text
        .setPlaceholder("e.g., Programming")
        .setValue(this.domainName)
        .onChange(value => {
          this.domainName = value;
          this.updatePreview(); // Update preview on change
        }));
    
    // Domain description input
    new Setting(contentEl)
      .setName("Description (Optional)")
      .setDesc("A brief description of this knowledge domain")
      .addTextArea(text => text
        .setPlaceholder("e.g., Programming concepts, languages, and paradigms")
        .setValue(this.domainDescription)
        .onChange(value => {
          this.domainDescription = value;
        }));
    
    // Preview ID
    const previewContainer = contentEl.createDiv("domain-id-preview");
    const previewLabel = previewContainer.createDiv();
    previewLabel.textContent = "Generated ID: ";
    
    const previewValue = previewContainer.createDiv();
    previewValue.textContent = this.generatePreviewId(this.domainName);
    
    // Update preview when name changes - already handled by onChange

    
    // Add buttons
    const buttonContainer = contentEl.createDiv("modal-button-container");
    
    // Create button
    const createButton = new ButtonComponent(buttonContainer)
      .setButtonText("Create Domain")
      .setCta()
      .onClick(async () => {
        await this.createDomain(createButton);
      });
    
    // Cancel button
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => {
        this.close();
      });
    
    // Add styles (keep styles defined once, ideally in a CSS file)
    // The current inline style addition is okay for a quick modal, but external CSS is better.
    // Keeping the inline style for consistency with original code structure.
    contentEl.createEl("style", {
      text: `
        .domain-id-preview {
          background: var(--background-secondary);
          padding: 10px;
          border-radius: 5px;
          margin-top: 20px;
          margin-bottom: 20px;
          display: flex;
          gap: 10px; /* Added gap for spacing */
          align-items: center; /* Vertically align */
        }
         .domain-id-preview div:first-child {
             font-weight: bold; /* Make label bold */
         }
        .modal-button-container {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }
      `
    });
     this.updatePreview(); // Initial preview update
  }
  
  private generatePreviewId(name: string): string {
    if (!name) return "domain-id-will-appear-here";
     // Use PathManager's generateId for consistency if possible, or replicate logic
    return this.plugin.services.pathManager["generateId"](name); // Access private method for consistency
  }
  
  private async createDomain(button: ButtonComponent) {
    const domainName = this.domainName.trim();
    if (!domainName) {
      new Notice("Please enter a domain name");
      return;
    }

    // Check for potential duplicates using the generated ID
    const potentialId = this.plugin.services.pathManager["generateId"](domainName);
     if (this.existingDomains.some(d => d.id === potentialId)) {
         new Notice(`Domain with ID "${potentialId}" already exists. Please use a different name or manage the existing domain.`);
         return;
     }
    
    if (this.isProcessing) {
      return;
    }
    
    try {
      this.isProcessing = true;
      button.setButtonText("Creating...").setDisabled(true);
      
      // Create the domain using PathManager
      const domain = await this.plugin.services.pathManager.addDomain({
        name: domainName,
        description: this.domainDescription
      });
      
      new Notice(`Domain "${domain.name}" created successfully`);
      this.close();
    } catch (error) {
      if (error instanceof Error) {
        new Notice(`Failed to create domain: ${error.message}`);
      } else {
        new Notice("Failed to create domain");
      }
    } finally {
      this.isProcessing = false;
      button.setButtonText("Create Domain").setDisabled(false);
    }
  }

  private updatePreview() {
       const idElement = this.contentEl.querySelector('.preview-id');
       if(idElement) {
           idElement.textContent = this.generatePreviewId(this.domainName);
       }
   }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
