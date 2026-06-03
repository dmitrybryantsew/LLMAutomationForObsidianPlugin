import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { Domain, Subject } from "../utils/pathStructure/types";
import { AddSubjectModal } from "./AddSubjectModal";
import { AddDomainModal } from "./AddDomainModal";
import { sanitizeFilename } from "../utils/helpers";

export class AddTopicModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private domains: Domain[] = []; // Cached domains
  private selectedDomainId: string = "";
  private selectedSubjectId: string = "";
  private topicName: string = "";
  private topicDescription: string = "";
  private isProcessing: boolean = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() { // Make onOpen async
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Add New Topic" });
    
    // Load available domains and subjects from cached structure
    try {
      const structure = this.plugin.services.pathManager.getStructure();
      this.domains = structure.structure.domains;
    } catch (error) {
      new Notice("Failed to load structure: " + (error instanceof Error ? error.message : "Unknown error"));
      this.close();
      return;
    }
    
    if (this.domains.length === 0) {
      contentEl.createEl("p", {
        text: "No domains available. Please create a domain first.",
        cls: "warning-text"
      });
      
      const createDomainButton = new ButtonComponent(contentEl)
        .setButtonText("Create Domain")
        .setCta()
        .onClick(() => {
          this.close();
          const modal = new AddDomainModal(this.app, this.plugin);
          modal.open();
        });
      
      return;
    }
    
    // Find domains with subjects
    const domainsWithSubjects = this.domains.filter(d => d.subjects && d.subjects.length > 0);
    
    if (domainsWithSubjects.length === 0) {
      contentEl.createEl("p", {
        text: "No subjects available. Please create a subject first.",
        cls: "warning-text"
      });
      
      const createSubjectButton = new ButtonComponent(contentEl)
        .setButtonText("Create Subject")
        .setCta()
        .onClick(() => {
          this.close();
          const modal = new AddSubjectModal(this.app, this.plugin);
          modal.open();
        });
      
      return;
    }
    
    // Domain selector
    const domainSetting = new Setting(contentEl)
      .setName("Domain")
      .setDesc("Select the domain")
      .addDropdown((dropdown: DropdownComponent) => {
        // Add domains to dropdown (only those with subjects)
        domainsWithSubjects.forEach(domain => {
          dropdown.addOption(domain.id, domain.name);
        });
        
        // Select first domain with subjects by default
        if (domainsWithSubjects.length > 0) {
          this.selectedDomainId = domainsWithSubjects[0].id;
          dropdown.setValue(this.selectedDomainId);
        }

        dropdown.onChange(value => {
          this.selectedDomainId = value;
          this.updateSubjectDropdown(); // Update subject dropdown when domain changes
          this.updatePreview();
        });
      });
    
    // Subject selector
    const subjectDropdownContainer = contentEl.createDiv("subject-dropdown-container");
    // This will be populated by updateSubjectDropdown based on default selectedDomainId

    
    // Topic name input
    new Setting(contentEl)
      .setName("Topic Name")
      .setDesc("Enter the name of the topic (e.g., Game Development, Web Development)")
      .addText(text => text
        .setPlaceholder("e.g., Game Development")
        .setValue(this.topicName)
        .onChange(value => {
          this.topicName = value;
          this.updatePreview();
        }));
    
    // Topic description input
    new Setting(contentEl)
      .setName("Description (Optional)")
      .setDesc("A brief description of this topic")
      .addTextArea(text => text
        .setPlaceholder("e.g., Game development techniques and tutorials")
        .setValue(this.topicDescription)
        .onChange(value => {
          this.topicDescription = value;
        }));
    
    // Preview ID and path
    const previewContainer = contentEl.createDiv("topic-preview");
    const idPreview = previewContainer.createDiv();
    idPreview.innerHTML = "<strong>Generated ID:</strong> <span class='preview-id'></span>";
    
    const pathPreview = previewContainer.createDiv();
    pathPreview.innerHTML = "<strong>Path:</strong> <span class='preview-path'></span>";
    
    // Initialize dropdowns and preview
    this.updateSubjectDropdown(); // This populates the subject dropdown based on the default domain
    this.updatePreview(); // Initial preview update
    
    // Add buttons
    const buttonContainer = contentEl.createDiv("modal-button-container");
    
    // Create button
    const createButton = new ButtonComponent(buttonContainer)
      .setButtonText("Create Topic")
      .setCta()
      .onClick(async () => {
        await this.createTopic(createButton);
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
        .topic-preview {
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
  
  // Load domains and subjects is now handled in onOpen from the cache
  private async loadDomainsAndSubjects() {
      // This method is no longer needed as structure is loaded from cache in onOpen
  }
  
  private createSubjectDropdown(container: HTMLElement) {
    container.empty();
    
    if (!this.selectedDomainId) return;
    
    // Find the selected domain from the cached list
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (!domain || !domain.subjects || domain.subjects.length === 0) {
        container.createEl("p", { text: "No subjects available in this domain." });
        this.selectedSubjectId = ""; // Reset selected subject if no subjects found
        this.updatePreview(); // Update preview after clearing subject
        return;
    }
    
    new Setting(container)
      .setName("Subject")
      .setDesc("Select the subject this topic belongs to")
      .addDropdown((dropdown: DropdownComponent) => {
        // Add subjects to dropdown
        domain.subjects.forEach(subject => {
          dropdown.addOption(subject.id, subject.name);
        });
        
        // Select first subject by default
        if (domain.subjects.length > 0) {
          this.selectedSubjectId = domain.subjects[0].id;
          dropdown.setValue(this.selectedSubjectId);
        } else {
            this.selectedSubjectId = "";
        }

        dropdown.onChange(value => {
          this.selectedSubjectId = value;
          this.updatePreview();
        });
      });
    // Ensure preview is updated after dropdown is created and default value is set
    this.updatePreview();
  }
  
  private updateSubjectDropdown() {
    const container = this.contentEl.querySelector('.subject-dropdown-container');
    if (container) {
      this.createSubjectDropdown(container as HTMLElement);
    }
  }
  
  private updatePreview() {
    const idElement = this.contentEl.querySelector('.preview-id');
    const pathElement = this.contentEl.querySelector('.preview-path');
    
    if (!idElement || !pathElement) return;
    
    // Generate ID and path based on current input
    const id = this.topicName ? this.plugin.services.pathManager["generateId"](this.topicName) : "topic-id-will-appear-here";
    
    // Find the selected domain and subject from the cached list
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    let subject: Subject | undefined = undefined;

    if (domain) {
        subject = domain.subjects.find(s => s.id === this.selectedSubjectId);
    }
    
    let path = "path-will-appear-here";
    if (domain && subject && this.topicName) {
      const sanitizedName = sanitizeFilename(this.topicName); // Use helper
       path = `${this.plugin.services.pathManager.getStructure().rootPath}/${domain.folderPath}/${subject.folderPath}/${sanitizedName}`;
    }
    
    idElement.textContent = id;
    pathElement.textContent = path;
  }
  
  private generateId(name: string): string {
    // Use PathManager's generateId for consistency if possible, or replicate logic
    return this.plugin.services.pathManager["generateId"](name); // Access private method for consistency
  }
  
  private async createTopic(button: ButtonComponent) {
    if (!this.selectedDomainId) {
      new Notice("Please select a domain");
      return;
    }
    
    if (!this.selectedSubjectId) {
      new Notice("Please select a subject");
      return;
    }
    
    const topicName = this.topicName.trim();
    if (!topicName) {
      new Notice("Please enter a topic name");
      return;
    }

    // Check for potential duplicates in the selected subject's cached topics
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    const subject = domain?.subjects.find(s => s.id === this.selectedSubjectId);
     if (subject) {
         const potentialId = this.plugin.services.pathManager["generateId"](topicName);
         if (subject.topics.some(t => t.id === potentialId)) {
             new Notice(`Topic with ID "${potentialId}" already exists in subject "${subject.name}". Please use a different name.`);
             return;
         }
     }

    if (this.isProcessing) {
      return;
    }
    
    try {
      this.isProcessing = true;
      button.setButtonText("Creating...").setDisabled(true);
      
      // Create the topic using PathManager
      const topic = await this.plugin.services.pathManager.addTopic({
        domainId: this.selectedDomainId,
        subjectId: this.selectedSubjectId,
        name: topicName,
        description: this.topicDescription
      });
      
      new Notice(`Topic "${topic.name}" created successfully`);
      this.close();
    } catch (error) {
      if (error instanceof Error) {
        new Notice(`Failed to create topic: ${error.message}`);
      } else {
        new Notice("Failed to create topic");
      }
    } finally {
      this.isProcessing = false;
      button.setButtonText("Create Topic").setDisabled(false);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}