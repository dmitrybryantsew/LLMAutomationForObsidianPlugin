import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { Domain, Subject } from "../utils/pathStructure/types";
import { AddDomainModal } from "./AddDomainModal"; // Import directly
import { sanitizeFilename } from "../utils/helpers";

export class AddSubjectModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private selectedDomainId: string = "";
  private subjectName: string = "";
  private subjectDescription: string = "";
  private domains: Domain[] = []; // Cached domains
  private isProcessing: boolean = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() { // Make onOpen async
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Add New Subject" });
    
    // Load available domains from cached structure
    try {
      const structure = this.plugin.services.pathManager.getStructure();
      this.domains = structure.structure.domains;
    } catch (error) {
      new Notice("Failed to load domains: " + (error instanceof Error ? error.message : "Unknown error"));
      this.close();
      return;
    }
    
    if (this.domains.length === 0) {
      contentEl.createEl("p", {
        text: "No domains available. Please create a domain first.",
        cls: "warning-text"
      });
      
      // Add a button to create domain
      const createDomainButton = new ButtonComponent(contentEl)
  .setButtonText("Create Domain")
  .setCta()
  .onClick(() => {
    this.close();
    // Create the modal directly instead of accessing it through plugin.modals
    const modal = new AddDomainModal(this.app, this.plugin);
    modal.open();
  });
      
      return;
    }
    
    // Domain selector
    const domainSetting = new Setting(contentEl)
      .setName("Parent Domain")
      .setDesc("Select the domain this subject belongs to")
      .addDropdown((dropdown: DropdownComponent) => {
        // Add domains to dropdown
        this.domains.forEach(domain => {
          dropdown.addOption(domain.id, domain.name);
        });
        
        // Select first domain by default
        if (this.domains.length > 0) {
          this.selectedDomainId = this.domains[0].id;
          dropdown.setValue(this.selectedDomainId);
        }

        dropdown.onChange(value => {
          this.selectedDomainId = value;
          this.updatePreview();
        });
      });
    
    // Subject name input
    new Setting(contentEl)
      .setName("Subject Name")
      .setDesc("Enter the name of the subject (e.g., Unreal Engine 5, Python)")
      .addText(text => text
        .setPlaceholder("e.g., Unreal Engine 5")
        .setValue(this.subjectName)
        .onChange(value => {
          this.subjectName = value;
          this.updatePreview();
        }));
    
    // Subject description input
    new Setting(contentEl)
      .setName("Description (Optional)")
      .setDesc("A brief description of this subject")
      .addTextArea(text => text
        .setPlaceholder("e.g., Game development with Unreal Engine 5")
        .setValue(this.subjectDescription)
        .onChange(value => {
          this.subjectDescription = value;
        }));
    
    // Preview ID and path
    const previewContainer = contentEl.createDiv("subject-preview");
    const idPreview = previewContainer.createDiv();
    idPreview.innerHTML = "<strong>Generated ID:</strong> <span class='preview-id'></span>";
    
    const pathPreview = previewContainer.createDiv();
    pathPreview.innerHTML = "<strong>Path:</strong> <span class='preview-path'></span>";
    
    // Update the preview initially
    this.updatePreview();
    
    // Add buttons
    const buttonContainer = contentEl.createDiv("modal-button-container");
    
    // Create button
    const createButton = new ButtonComponent(buttonContainer)
      .setButtonText("Create Subject")
      .setCta()
      .onClick(async () => {
        await this.createSubject(createButton);
      });
    
    // Cancel button
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => {
        this.close();
      });
    
    // Add styles (inline styles, ideally in CSS file)
    contentEl.createEl("style", {
      text: `
        .subject-preview {
          background: var(--background-secondary);
          padding: 10px;
          border-radius: 5px;
          margin-top: 15px;
          margin-bottom: 15px;
        }
        .warning-text {
          color: var(--text-warning);
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
  
  // Load domains is now handled in onOpen from the cache
  private async loadDomains() {
      // This method is no longer needed as domains are loaded from cache in onOpen
  }
  
  private updatePreview() {
    const idElement = this.contentEl.querySelector('.preview-id');
    const pathElement = this.contentEl.querySelector('.preview-path');
    
    if (!idElement || !pathElement) return;
    
    // Generate ID and path based on current input
     const id = this.subjectName ? this.plugin.services.pathManager["generateId"](this.subjectName) : "subject-id-will-appear-here";
    
    // Find the selected domain from the cached list
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    
    let path = "path-will-appear-here";
    if (domain && this.subjectName) {
      const sanitizedName = sanitizeFilename(this.subjectName); // Use helper
      path = `${this.plugin.services.pathManager.getStructure().rootPath}/${domain.folderPath}/${sanitizedName}`;
    }
    
    idElement.textContent = id;
    pathElement.textContent = path;
  }
  
  private generateId(name: string): string {
    // Use PathManager's generateId for consistency if possible, or replicate logic
    return this.plugin.services.pathManager["generateId"](name); // Access private method for consistency
  }
  
  private async createSubject(button: ButtonComponent) {
    if (!this.selectedDomainId) {
      new Notice("Please select a domain");
      return;
    }
    
    const subjectName = this.subjectName.trim();
    if (!subjectName) {
      new Notice("Please enter a subject name");
      return;
    }

    // Check for potential duplicates in the selected domain's cached subjects
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (domain) {
        const potentialId = this.plugin.services.pathManager["generateId"](subjectName);
        if (domain.subjects.some(s => s.id === potentialId)) {
            new Notice(`Subject with ID "${potentialId}" already exists in domain "${domain.name}". Please use a different name.`);
            return;
        }
    }


    if (this.isProcessing) {
      return;
    }
    
    try {
      this.isProcessing = true;
      button.setButtonText("Creating...").setDisabled(true);
      
      // Create the subject using PathManager
      const subject = await this.plugin.services.pathManager.addSubject({
        domainId: this.selectedDomainId,
        name: subjectName,
        description: this.subjectDescription
      });
      
      new Notice(`Subject "${subject.name}" created successfully`);
      this.close();
    } catch (error) {
      if (error instanceof Error) {
        new Notice(`Failed to create subject: ${error.message}`);
      } else {
        new Notice("Failed to create subject");
      }
    } finally {
      this.isProcessing = false;
      button.setButtonText("Create Subject").setDisabled(false);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}