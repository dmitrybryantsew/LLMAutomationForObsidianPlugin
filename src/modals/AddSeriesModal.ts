
import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { Domain, Subject, Topic } from "../utils/pathStructure/types";
import { AddTopicModal } from "./AddTopicModal";
import { sanitizeFilename } from "../utils/helpers";

export class AddSeriesModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private domains: Domain[] = []; // Cached domains
  private selectedDomainId: string = "";
  private selectedSubjectId: string = "";
  private selectedTopicId: string = "";
  private seriesName: string = "";
  private seriesDescription: string = "";
  private isProcessing: boolean = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() { // Make onOpen async
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Add New Series" });
    
    // Load available domains, subjects, and topics from cached structure
    try {
      const structure = this.plugin.services.pathManager.getStructure();
      this.domains = structure.structure.domains;
    } catch (error) {
      new Notice("Failed to load structure: " + (error instanceof Error ? error.message : "Unknown error"));
      this.close();
      return;
    }
    
    // Find domains with subjects that have topics
    const domainsWithTopics = this.domains.filter(d => 
      d.subjects && d.subjects.some(s => s.topics && s.topics.length > 0)
    );
    
    if (domainsWithTopics.length === 0) {
      contentEl.createEl("p", {
        text: "No topics available. Please create a topic first.",
        cls: "warning-text"
      });
      
      const createTopicButton = new ButtonComponent(contentEl)
        .setButtonText("Create Topic")
        .setCta()
        .onClick(() => {
          this.close();
          const modal = new AddTopicModal(this.app, this.plugin);
          modal.open();
        });
      
      return;
    }
    
    // Domain selector
    new Setting(contentEl)
      .setName("Domain")
      .setDesc("Select the domain")
      .addDropdown((dropdown: DropdownComponent) => {
        // Add domains with topics to dropdown
        domainsWithTopics.forEach(domain => {
          dropdown.addOption(domain.id, domain.name);
        });
        
        // Select first domain by default
        this.selectedDomainId = domainsWithTopics[0].id;
        dropdown.setValue(this.selectedDomainId);

        dropdown.onChange(value => {
          this.selectedDomainId = value;
          this.updateSubjectDropdown(); // Update subject dropdown when domain changes
        });
      });
    
    // Subject dropdown container
    const subjectContainer = contentEl.createDiv("subject-dropdown-container");
    
    // Topic dropdown container
    const topicContainer = contentEl.createDiv("topic-dropdown-container");
    // This will be populated by updateSubjectDropdown which calls updateTopicDropdown

    
    // Series name input
    new Setting(contentEl)
      .setName("Series Name")
      .setDesc("Enter the name of the series (e.g., Tank Tutorial, Character Creation)")
      .addText(text => text
        .setPlaceholder("e.g., Tank Tutorial")
        .setValue(this.seriesName)
        .onChange(value => {
          this.seriesName = value;
          this.updatePreview();
        }));
    
    // Series description input
    new Setting(contentEl)
      .setName("Description (Optional)")
      .setDesc("A brief description of this series")
      .addTextArea(text => text
        .setPlaceholder("e.g., Step-by-step tutorial for creating tanks in Unreal Engine 5")
        .setValue(this.seriesDescription)
        .onChange(value => {
          this.seriesDescription = value;
        }));
    
    // Preview ID and path
    const previewContainer = contentEl.createDiv("series-preview");
    const idPreview = previewContainer.createDiv();
    idPreview.innerHTML = "<strong>Generated ID:</strong> <span class='preview-id'></span>";
    
    const pathPreview = previewContainer.createDiv();
    pathPreview.innerHTML = "<strong>Path:</strong> <span class='preview-path'></span>";
    
    // Initialize dropdowns and preview
    this.updateSubjectDropdown(); // This cascades to update topic and preview
    
    // Add buttons
    const buttonContainer = contentEl.createDiv("modal-button-container");
    
    // Create button
    const createButton = new ButtonComponent(buttonContainer)
      .setButtonText("Create Series")
      .setCta()
      .onClick(async () => {
        await this.createSeries(createButton);
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
        .series-preview {
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
  
  // Load structure is now handled in onOpen from the cache
  private async loadStructure() {
      // This method is no longer needed as structure is loaded from cache in onOpen
  }
  
  private updateSubjectDropdown() {
    const container = this.contentEl.querySelector('.subject-dropdown-container') as HTMLElement;
    if (!container) return;
    
    container.empty();
    this.selectedSubjectId = ""; // Reset selected subject
    
    if (!this.selectedDomainId) return;
    
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (!domain || !domain.subjects || domain.subjects.length === 0) {
        container.createEl("p", { text: "No subjects available in this domain." });
        this.updateTopicDropdown(); // Clear cascade
        return;
    }
    
    // Filter subjects that have topics
    const subjectsWithTopics = domain.subjects.filter(s => s.topics && s.topics.length > 0);
    
    if (subjectsWithTopics.length === 0) {
      container.createEl("p", { text: "No subjects with topics available in this domain." });
      this.updateTopicDropdown(); // Clear cascade
      return;
    }
    
    new Setting(container)
      .setName("Subject")
      .setDesc("Select the subject")
      .addDropdown((dropdown: DropdownComponent) => {
        // Add subjects to dropdown
        subjectsWithTopics.forEach(subject => {
          dropdown.addOption(subject.id, subject.name);
        });
        
        // Select first subject by default
        this.selectedSubjectId = subjectsWithTopics[0].id;
        dropdown.setValue(this.selectedSubjectId);

        dropdown.onChange(value => {
          this.selectedSubjectId = value;
          this.updateTopicDropdown(); // Update topic dropdown when subject changes
        });
      });
    
    this.updateTopicDropdown(); // Populate topic dropdown based on default/selected subject
  }
  
  private updateTopicDropdown() {
    
    const container = this.contentEl.querySelector('.topic-dropdown-container') as HTMLElement;
    if (!container) return;
    
    container.empty();
    this.selectedTopicId = ""; // Reset selected topic
    
    if (!this.selectedDomainId || !this.selectedSubjectId) return;
    
    // Find the selected domain and subject from the cached list
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (!domain) return;
    
    const subject = domain.subjects.find(s => s.id === this.selectedSubjectId);
    if (!subject || !subject.topics || subject.topics.length === 0) {
      container.createEl("p", { text: "No topics available in this subject." });
      this.updatePreview(); // Update preview even if no topics
      return;
    }
    
    new Setting(container)
      .setName("Topic")
      .setDesc("Select the topic this series belongs to")
      .addDropdown((dropdown: DropdownComponent) => {
        // Add topics to dropdown
        subject.topics.forEach(topic => {
          dropdown.addOption(topic.id, topic.name);
        });
        
        // Select first topic by default
        this.selectedTopicId = subject.topics[0].id;
        dropdown.setValue(this.selectedTopicId);

        dropdown.onChange(value => {
          this.selectedTopicId = value;
          this.updatePreview(); // Update preview when topic changes
        });
      });
    
    this.updatePreview(); // Update preview based on default/selected topic
  }
  
  private updatePreview() {
    const idElement = this.contentEl.querySelector('.preview-id');
    const pathElement = this.contentEl.querySelector('.preview-path');
    
    if (!idElement || !pathElement) return;
    
    // Generate ID based on current input
    const id = this.seriesName ? this.plugin.services.pathManager["generateId"](this.seriesName) : "series-id-will-appear-here";
    
    // Find the selected hierarchy from the cached lists
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    let subject: Subject | undefined = undefined;
    let topic: Topic | undefined = undefined;
    
    if (domain) {
      subject = domain.subjects.find(s => s.id === this.selectedSubjectId);
      if (subject) {
        topic = subject.topics.find(t => t.id === this.selectedTopicId);
      }
    }
    
    let path = "path-will-appear-here";
    if (domain && subject && topic && this.seriesName) {
      const sanitizedName = sanitizeFilename(this.seriesName); // Use helper
       path = `${this.plugin.services.pathManager.getStructure().rootPath}/${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${sanitizedName}`;
    }
    
    idElement.textContent = id;
    pathElement.textContent = path;
  }
  
  private generateId(name: string): string {
    // Use PathManager's generateId for consistency if possible, or replicate logic
    return this.plugin.services.pathManager["generateId"](name); // Access private method for consistency
  }
  
  private async createSeries(button: ButtonComponent) {
    if (!this.selectedDomainId) {
      new Notice("Please select a domain");
      return;
    }
    
    if (!this.selectedSubjectId) {
      new Notice("Please select a subject");
      return;
    }
    
    if (!this.selectedTopicId) {
      new Notice("Please select a topic");
      return;
    }
    
    const seriesName = this.seriesName.trim();
    if (!seriesName) {
      new Notice("Please enter a series name");
      return;
    }

     // Check for potential duplicates in the selected topic's cached series
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    const subject = domain?.subjects.find(s => s.id === this.selectedSubjectId);
    const topic = subject?.topics.find(t => t.id === this.selectedTopicId);
     if (topic) {
         const potentialId = this.plugin.services.pathManager["generateId"](seriesName);
         if (topic.series.some(s => s.id === potentialId)) {
             new Notice(`Series with ID "${potentialId}" already exists in topic "${topic.name}". Please use a different name.`);
             return;
         }
     }

    if (this.isProcessing) {
      return;
    }
    
    try {
      this.isProcessing = true;
      button.setButtonText("Creating...").setDisabled(true);
      
      // Create the series using PathManager
      const series = await this.plugin.services.pathManager.addSeries({
        domainId: this.selectedDomainId,
        subjectId: this.selectedSubjectId,
        topicId: this.selectedTopicId,
        name: seriesName,
        description: this.seriesDescription
      });
      
      new Notice(`Series "${series.name}" created successfully`);
      this.close();
    } catch (error) {
      if (error instanceof Error) {
        new Notice(`Failed to create series: ${error.message}`);
      } else {
        new Notice("Failed to create series");
      }
    } finally {
      this.isProcessing = false;
      button.setButtonText("Create Series").setDisabled(false);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}