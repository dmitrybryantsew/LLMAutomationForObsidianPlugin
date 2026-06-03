import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { Domain, Subject, Topic, Series, Author } from "../utils/pathStructure/types";
import { AddSeriesModal } from "./AddSeriesModal";
import { sanitizeFilename } from "../utils/helpers";


export class AddAuthorModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private domains: Domain[] = []; // Cached domains
  private selectedDomainId: string = "";
  private selectedSubjectId: string = "";
  private selectedTopicId: string = "";
  private selectedSeriesId: string = "";
  private authorName: string = "";
  private authorDescription: string = ""; // Description is optional
  private isProcessing: boolean = false;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() { // Make onOpen async
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Add New Author" });
    
    // Load available structure from cached structure
    try {
      const structure = this.plugin.services.pathManager.getStructure();
      this.domains = structure.structure.domains;
    } catch (error) {
      new Notice("Failed to load structure: " + (error instanceof Error ? error.message : "Unknown error"));
      this.close();
      return;
    }
    
    // Find domains with subjects that have topics that have series
    const domainsWithSeries = this.domains.filter(d => 
      d.subjects && d.subjects.some(s => 
        s.topics && s.topics.some(t => 
          t.series && t.series.length > 0
        )
      )
    );
    
    if (domainsWithSeries.length === 0) {
      contentEl.createEl("p", {
        text: "No series available. Please create a series first.",
        cls: "warning-text"
      });
      
      const createSeriesButton = new ButtonComponent(contentEl)
        .setButtonText("Create Series")
        .setCta()
        .onClick(() => {
          this.close();
          const modal = new AddSeriesModal(this.app, this.plugin);
          modal.open();
        });
      
      return;
    }
    
    // Domain selector
    new Setting(contentEl)
      .setName("Domain")
      .setDesc("Select the domain")
      .addDropdown((dropdown: DropdownComponent) => {
        domainsWithSeries.forEach(domain => {
          dropdown.addOption(domain.id, domain.name);
        });
        this.selectedDomainId = domainsWithSeries[0].id; // Default to first
        dropdown.setValue(this.selectedDomainId);
        
        dropdown.onChange(value => {
          this.selectedDomainId = value;
          this.updateSubjectDropdown(); // Update cascade
        });
      });
    
    // Subject dropdown container
    const subjectContainer = contentEl.createDiv("subject-dropdown-container");
    
    // Topic dropdown container
    const topicContainer = contentEl.createDiv("topic-dropdown-container");
    
    // Series dropdown container
    const seriesContainer = contentEl.createDiv("series-dropdown-container");
    
    // Author name input
    new Setting(contentEl)
      .setName("Author Name")
      .setDesc("Enter the name of the author (e.g., Ryan Laley)")
      .addText(text => text
        .setPlaceholder("e.g., Ryan Laley")
        .setValue(this.authorName)
        .onChange(value => {
          this.authorName = value;
          this.updatePreview();
        }));
    
    // Author description input (Optional)
    new Setting(contentEl)
      .setName("Description (Optional)")
      .setDesc("A brief description of this author or their style")
      .addTextArea(text => text
        .setPlaceholder("e.g., Creator of high-quality Unreal Engine tutorials")
        .setValue(this.authorDescription)
        .onChange(value => {
          this.authorDescription = value;
        }));
    
    // Preview ID and path
    const previewContainer = contentEl.createDiv("author-preview");
    const idPreview = previewContainer.createDiv();
    idPreview.innerHTML = "<strong>Generated ID:</strong> <span class='preview-id'></span>";
    
    const pathPreview = previewContainer.createDiv();
    pathPreview.innerHTML = "<strong>Path in Structure:</strong> <span class='preview-path'></span>";
    
    // Initialize dropdowns
    this.updateSubjectDropdown(); // This will cascade and update topic and series
    
    // Add buttons
    const buttonContainer = contentEl.createDiv("modal-button-container");
    
    // Create button
    const createButton = new ButtonComponent(buttonContainer)
      .setButtonText("Create Author")
      .setCta()
      .onClick(async () => {
        await this.createAuthor(createButton);
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
        .author-preview {
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
      // This method is no longer needed
  }
  
  private updateSubjectDropdown() {
    const container = this.contentEl.querySelector('.subject-dropdown-container') as HTMLElement;
    if (!container) return;
    container.empty();
    this.selectedSubjectId = ""; // Reset selected subject
    
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (!domain || !domain.subjects || domain.subjects.length === 0) {
        container.createEl("p", { text: "No subjects available in this domain." });
        this.updateTopicDropdown(); // Clear cascade
        return;
    }
    
    const subjectsWithSeries = domain.subjects.filter(s => s.topics && s.topics.some(t => t.series && t.series.length > 0));
    
    if (subjectsWithSeries.length === 0) {
      container.createEl("p", { text: "No subjects with series available in this domain." });
      this.updateTopicDropdown(); // Clear cascade
      return;
    }
    
    new Setting(container)
      .setName("Subject")
      .setDesc("Select the subject")
      .addDropdown((dropdown: DropdownComponent) => {
        subjectsWithSeries.forEach(subject => {
          dropdown.addOption(subject.id, subject.name);
        });
        this.selectedSubjectId = subjectsWithSeries[0].id; // Default to first
        dropdown.setValue(this.selectedSubjectId);
        
        dropdown.onChange(value => {
          this.selectedSubjectId = value;
          this.updateTopicDropdown(); // Update cascade
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
    
    // Find selected domain and subject from cached list
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (!domain) return;
    
    const subject = domain.subjects.find(s => s.id === this.selectedSubjectId);
    if (!subject || !subject.topics || subject.topics.length === 0) {
      container.createEl("p", { text: "No topics available in this subject." });
      this.updateSeriesDropdown(); // Clear cascade
      return;
    }
    
    const topicsWithSeries = subject.topics.filter(t => t.series && t.series.length > 0);
    
    if (topicsWithSeries.length === 0) {
      container.createEl("p", { text: "No topics with series available in this subject." });
      this.updateSeriesDropdown(); // Clear cascade
      return;
    }
    
    new Setting(container)
      .setName("Topic")
      .setDesc("Select the topic")
      .addDropdown((dropdown: DropdownComponent) => {
        topicsWithSeries.forEach(topic => {
          dropdown.addOption(topic.id, topic.name);
        });
        this.selectedTopicId = topicsWithSeries[0].id; // Default to first
        dropdown.setValue(this.selectedTopicId);
        
        dropdown.onChange(value => {
          this.selectedTopicId = value;
          this.updateSeriesDropdown(); // Update cascade
        });
      });
    
    this.updateSeriesDropdown(); // Populate series dropdown based on default/selected topic
  }
  
  private updateSeriesDropdown() {
    const container = this.contentEl.querySelector('.series-dropdown-container') as HTMLElement;
    if (!container) return;
    container.empty();
    this.selectedSeriesId = ""; // Reset selected series
    
    if (!this.selectedDomainId || !this.selectedSubjectId || !this.selectedTopicId) return;

    // Find selected domain, subject, topic from cached list
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (!domain) return;
    
    const subject = domain.subjects.find(s => s.id === this.selectedSubjectId);
    if (!subject) return;
    
    const topic = subject.topics.find(t => t.id === this.selectedTopicId);
    if (!topic || !topic.series || topic.series.length === 0) {
      container.createEl("p", { text: "No series available in this topic." });
      this.updatePreview(); // Update preview even if no series
      return;
    }
    
    new Setting(container)
      .setName("Series")
      .setDesc("Select the series this author is associated with")
      .addDropdown((dropdown: DropdownComponent) => {
        topic.series.forEach(series => {
          dropdown.addOption(series.id, series.name);
        });
        this.selectedSeriesId = topic.series[0].id; // Default to first
        dropdown.setValue(this.selectedSeriesId);
        
        dropdown.onChange(value => {
          this.selectedSeriesId = value;
          this.updatePreview(); // Update preview when series changes
        });
      });
    
    this.updatePreview(); // Update preview based on default/selected series
  }
  
  private updatePreview() {
    const idElement = this.contentEl.querySelector('.preview-id');
    const pathElement = this.contentEl.querySelector('.preview-path');
    
    if (!idElement || !pathElement) return;
    
    // Generate ID based on current input
     const id = this.authorName ? this.plugin.services.pathManager["generateId"](this.authorName) : "author-id-will-appear-here";
    
    // Find the selected hierarchy from the cached lists
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    let subject: Subject | undefined, topic: Topic | undefined, series: Series | undefined;
    
    if (domain) {
      subject = domain.subjects.find(s => s.id === this.selectedSubjectId);
      if (subject) {
        topic = subject.topics.find(t => t.id === this.selectedTopicId);
        if (topic) {
          series = topic.series.find(ser => ser.id === this.selectedSeriesId);
        }
      }
    }
    
    let path = "path-will-appear-here";
    if (domain && subject && topic && series && this.authorName) {
      const sanitizedAuthorName = sanitizeFilename(this.authorName); // Use helper
      // Author MD file goes inside the Series folder
       path = `${this.plugin.services.pathManager.getStructure().rootPath}/${domain.folderPath}/${subject.folderPath}/${topic.folderPath}/${series.folderPath}/${sanitizedAuthorName}.md`; // Use sanitized name for file path preview
    }
    
    idElement.textContent = id;
    pathElement.textContent = path;
  }
  
  private generateId(name: string): string {
    // Use PathManager's generateId for consistency if possible, or replicate logic
    return this.plugin.services.pathManager["generateId"](name); // Access private method for consistency
  }
  
  private async createAuthor(button: ButtonComponent) {
    if (!this.selectedDomainId || !this.selectedSubjectId || !this.selectedTopicId || !this.selectedSeriesId) {
      new Notice("Please select a parent series");
      return;
    }
    
    const authorName = this.authorName.trim();
    if (!authorName) {
      new Notice("Please enter an author name");
      return;
    }
    
    // Check for potential duplicates in the selected series' cached authors
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    const subject = domain?.subjects.find(s => s.id === this.selectedSubjectId);
    const topic = subject?.topics.find(t => t.id === this.selectedTopicId);
    const series = topic?.series.find(ser => ser.id === this.selectedSeriesId);
     if (series) {
         const potentialId = this.plugin.services.pathManager["generateId"](authorName);
         if (series.authors.some(a => a.id === potentialId)) {
             new Notice(`Author with ID "${potentialId}" already exists in series "${series.name}". Please use a different name.`);
             return;
         }
     }

    if (this.isProcessing) {
      return;
    }
    
    try {
      this.isProcessing = true;
      button.setButtonText("Creating...").setDisabled(true);
      
      // Create the author using PathManager
      const author = await this.plugin.services.pathManager.addAuthor({
        domainId: this.selectedDomainId,
        subjectId: this.selectedSubjectId,
        topicId: this.selectedTopicId,
        seriesId: this.selectedSeriesId,
        name: authorName,
        description: this.authorDescription
      });
      
      new Notice(`Author "${author.name}" created successfully`);
      this.close();
    } catch (error) {
      if (error instanceof Error) {
        new Notice(`Failed to create author: ${error.message}`);
      } else {
        new Notice("Failed to create author");
      }
    } finally {
      this.isProcessing = false;
      button.setButtonText("Create Author").setDisabled(false);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}