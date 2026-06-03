import { App, Modal, Setting, Notice, ButtonComponent, DropdownComponent, TFile } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { Domain, Subject, Topic, Series, Author, ContentMetadata } from "../utils/pathStructure/types";
import { VaultFileSelectorModal } from "./VaultFileSelectorModal"; // Import the new modal
import { sanitizeFilename } from "../utils/helpers";


export class AddContentModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private domains: Domain[] = []; // Cached domains
  private selectedDomainId: string = "";
  private selectedSubjectId: string = "";
  private selectedTopicId: string = "";
  private selectedSeriesId: string = "";
  private selectedAuthorId: string = "";
  
  private contentTitle: string = "";
  private contentSubtitle: string = ""; // Optional subtitle
  private contentFilePath: string = ""; // Path to the actual MD file in the vault
  private contentVideoUrl: string = ""; // Optional video URL
  private contentPosition: number | undefined; // Optional part number
  private contentTotalParts: number | undefined; // Optional total parts
  
  private isProcessing: boolean = false;

  // Store the text input element to update it later after file selection
  private filePathTextInput: HTMLInputElement | null = null; 
  private titleTextInput: HTMLInputElement | null = null;


  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() { // Make onOpen async
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Link Existing Content to Path Structure" });
    
    // Load available structure from cached structure
    try {
      const structure = this.plugin.services.pathManager.getStructure();
      this.domains = structure.structure.domains;
    } catch (error) {
      new Notice("Failed to load structure: " + (error instanceof Error ? error.message : "Unknown error"));
      this.close();
      return;
    }
    
    // Find domains with subjects->topics->series->authors
    const domainsWithAuthors = this.domains.filter(d => 
      d.subjects && d.subjects.some(s => 
        s.topics && s.topics.some(t => 
          t.series && t.series.some(ser => 
            ser.authors && ser.authors.length > 0
          )
        )
      )
    );
    
    if (domainsWithAuthors.length === 0) {
      contentEl.createEl("p", {
        text: "No authors available in the structure. Please create an author first.",
        cls: "warning-text"
      });
      // Option to create author could be added here if needed
      return;
    }
    
    // Domain selector
    new Setting(contentEl)
      .setName("Domain")
      .setDesc("Select the domain")
      .addDropdown((dropdown: DropdownComponent) => {
        domainsWithAuthors.forEach(domain => {
          dropdown.addOption(domain.id, domain.name);
        });
        this.selectedDomainId = domainsWithAuthors[0].id; // Default to first
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
    
    // Author dropdown container
    const authorContainer = contentEl.createDiv("author-dropdown-container");
    
    // Content Title input
    new Setting(contentEl)
      .setName("Content Title")
      .setDesc("Enter the title for this content item (defaults to filename)")
      .addText(text => {
          text.setPlaceholder("e.g., Blueprint Communication Fundamentals")
              .setValue(this.contentTitle)
              .onChange(value => {
                  this.contentTitle = value;
                  this.updatePreview();
              });
            this.titleTextInput = text.inputEl; // Store ref
      });

    // Content Subtitle input (Optional)
    new Setting(contentEl)
      .setName("Subtitle (Optional)")
      .setDesc("Enter an optional subtitle")
      .addText(text => text
        .setPlaceholder("e.g., Part 1")
        .setValue(this.contentSubtitle)
        .onChange(value => {
          this.contentSubtitle = value;
        }));
    
    // File Path input and picker
    new Setting(contentEl)
      .setName("Content File")
      .setDesc("Select the existing Markdown file (e.g., video summary)")
      .addText(text => {
        // Use the text input primarily for display and manual entry
        text.setPlaceholder("Path to the file (e.g., VideoSummaries/AuthorName/Summary.md)")
        .setValue(this.contentFilePath)
        .onChange(value => {
          this.contentFilePath = value;
          this.updatePreview();
        });
        this.filePathTextInput = text.inputEl; // Store ref
      })
      .addButton(btn => btn
        .setButtonText("Browse Vault")
        .onClick(() => {
           // Use the new VaultFileSelectorModal
           new VaultFileSelectorModal(this.app, (selectedFile: TFile) => {
             this.contentFilePath = selectedFile.path; // This is the correct vault path
             
             // Update the text input field
             if (this.filePathTextInput) {
               this.filePathTextInput.value = this.contentFilePath;
             }

             // Attempt to set title from filename if title is empty
             if (!this.contentTitle && this.titleTextInput) {
               this.contentTitle = selectedFile.basename; // Use basename (filename without extension)
               this.titleTextInput.value = this.contentTitle; // Update the title input field
             }
             
             new Notice(`Selected file: ${this.contentFilePath}`);
             this.updatePreview();
           }).open();
        }));

    // Optional Fields Section
    contentEl.createEl("h3", { text: "Optional Content Details" });
    
    new Setting(contentEl) // Use contentEl directly, not a separate container for optional fields
      .setName("Video URL (Optional)")
      .setDesc("Original video URL if applicable")
      .addText(text => text
        .setPlaceholder("https://youtube.com/watch?v=...")
        .setValue(this.contentVideoUrl)
        .onChange(value => {
          this.contentVideoUrl = value;
        }));
        
    new Setting(contentEl)
      .setName("Position in Series (Optional)")
      .setDesc("Number in the series (e.g., 1 for Part 1)")
      .addText(text => text
        .setPlaceholder("e.g., 1")
        .setValue(this.contentPosition?.toString() || "")
        .onChange(value => {
          const num = parseInt(value);
          this.contentPosition = isNaN(num) ? undefined : num;
        }));
        
    new Setting(contentEl)
      .setName("Total Parts (Optional)")
      .setDesc("Total number of parts in the series")
      .addText(text => text
        .setPlaceholder("e.g., 10")
        .setValue(this.contentTotalParts?.toString() || "")
        .onChange(value => {
          const num = parseInt(value);
          this.contentTotalParts = isNaN(num) ? undefined : num;
        }));

    // Preview Link in Author File
    const previewContainer = contentEl.createDiv("content-preview");
    const idPreview = previewContainer.createDiv();
    idPreview.innerHTML = "<strong>Generated ID:</strong> <span class='preview-id'></span>";
    
    const linkPreview = previewContainer.createDiv();
    linkPreview.innerHTML = "<strong>Link in Author File:</strong> <span class='preview-link'></span>";
    
    // Initialize dropdowns
    this.updateSubjectDropdown(); // This will cascade
    
    // Add buttons
    const buttonContainer = contentEl.createDiv("modal-button-container");
    
    // Link button
    const linkButton = new ButtonComponent(buttonContainer)
      .setButtonText("Link Content")
      .setCta()
      .onClick(async () => {
        await this.linkContent(linkButton);
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
        .content-preview {
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
    this.selectedSubjectId = ""; 
    
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (!domain || !domain.subjects || domain.subjects.length === 0) {
         container.createEl("p", { text: "No subjects available in this domain." });
         this.updateTopicDropdown(); // Clear cascade
         return;
    }
    
    const subjectsWithAuthors = domain.subjects.filter(s => s.topics && s.topics.some(t => t.series && t.series.some(ser => ser.authors && ser.authors.length > 0)));
    
    if (subjectsWithAuthors.length === 0) {
      container.createEl("p", { text: "No subjects with authors available in this domain." });
      this.updateTopicDropdown(); 
      return;
    }
    
    new Setting(container)
      .setName("Subject")
      .setDesc("Select the subject")
      .addDropdown((dropdown: DropdownComponent) => {
        subjectsWithAuthors.forEach(subject => {
          dropdown.addOption(subject.id, subject.name);
        });
        this.selectedSubjectId = subjectsWithAuthors[0].id; // Default to first
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
    this.selectedTopicId = ""; 
    
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
    
    const topicsWithAuthors = subject.topics.filter(t => t.series && t.series.some(ser => ser.authors && ser.authors.length > 0));
    
    if (topicsWithAuthors.length === 0) {
      container.createEl("p", { text: "No topics with authors available in this subject." });
      this.updateSeriesDropdown(); 
      return;
    }
    
    new Setting(container)
      .setName("Topic")
      .setDesc("Select the topic")
      .addDropdown((dropdown: DropdownComponent) => {
        topicsWithAuthors.forEach(topic => {
          dropdown.addOption(topic.id, topic.name);
        });
        this.selectedTopicId = topicsWithAuthors[0].id; // Default to first
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
    this.selectedSeriesId = ""; 
    
    if (!this.selectedDomainId || !this.selectedSubjectId || !this.selectedTopicId) return;

    // Find selected domain, subject, topic from cached list
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (!domain) return;
    
    const subject = domain.subjects.find(s => s.id === this.selectedSubjectId);
    if (!subject) return;
    
    const topic = subject.topics.find(t => t.id === this.selectedTopicId);
    if (!topic || !topic.series || topic.series.length === 0) {
      container.createEl("p", { text: "No series available in this topic." });
      this.updateAuthorDropdown();
      return;
    }

    const seriesWithAuthors = topic.series.filter(ser => ser.authors && ser.authors.length > 0);
    
    if (seriesWithAuthors.length === 0) {
      container.createEl("p", { text: "No series with authors available in this topic." });
      this.updateAuthorDropdown();
      return;
    }
    
    new Setting(container)
      .setName("Series")
      .setDesc("Select the series")
      .addDropdown((dropdown: DropdownComponent) => {
        seriesWithAuthors.forEach(series => {
          dropdown.addOption(series.id, series.name);
        });
        this.selectedSeriesId = seriesWithAuthors[0].id; // Default to first
        dropdown.setValue(this.selectedSeriesId);
        
        dropdown.onChange(value => {
          this.selectedSeriesId = value;
          this.updateAuthorDropdown(); // Update cascade
        });
      });
    
    this.updateAuthorDropdown(); // Populate author dropdown based on default/selected series
  }
  
  private updateAuthorDropdown() {
    const container = this.contentEl.querySelector('.author-dropdown-container') as HTMLElement;
    if (!container) return;
    container.empty();
    this.selectedAuthorId = ""; 
    
    if (!this.selectedDomainId || !this.selectedSubjectId || !this.selectedTopicId || !this.selectedSeriesId) return;

    // Find selected domain, subject, topic, series from cached list
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    if (!domain) return;
    const subject = domain.subjects.find(s => s.id === this.selectedSubjectId);
    if (!subject) return;
    const topic = subject.topics.find(t => t.id === this.selectedTopicId);
    if (!topic) return;
    const series = topic.series.find(ser => ser.id === this.selectedSeriesId);
    
    if (!series || !series.authors || series.authors.length === 0) {
      container.createEl("p", { text: "No authors available in this series." });
      this.updatePreview(); // Update preview even if no authors
      return;
    }
    
    new Setting(container)
      .setName("Author")
      .setDesc("Select the author who created this content")
      .addDropdown((dropdown: DropdownComponent) => {
        series.authors.forEach(author => {
          dropdown.addOption(author.id, author.name);
        });
        this.selectedAuthorId = series.authors[0].id; // Default to first
        dropdown.setValue(this.selectedAuthorId);
        
        dropdown.onChange(value => {
          this.selectedAuthorId = value;
          this.updatePreview(); // Update preview when author changes
        });
      });
    
    this.updatePreview(); // Update preview based on default/selected author
  }
  
  private updatePreview() {
    const idElement = this.contentEl.querySelector('.preview-id');
    const linkElement = this.contentEl.querySelector('.preview-link');
    
    if (!idElement || !linkElement) return;
    
    // Generate ID based on current input
    const id = this.contentTitle ? this.plugin.services.pathManager["generateId"](this.contentTitle) : "content-id-will-appear-here";
    
    // Generate link preview
    let linkPreviewText = "link-will-appear-here";
    if (this.contentFilePath) {
      // Remove .md extension for the link target
      const displayPath = this.contentFilePath.replace(/\.md$/, '');
      // Use contentTitle as the display text if available, otherwise use filename derived from path
      const linkText = this.contentTitle || displayPath.split('/').pop();
      linkPreviewText = `[[${displayPath}|${linkText}]]`;
    }
    
    idElement.textContent = id;
    linkElement.textContent = linkPreviewText;
  }
  
  private generateId(name: string): string {
     if (!name) return '';
    // Use PathManager's generateId for consistency if possible, or replicate logic
    return this.plugin.services.pathManager["generateId"](name); // Access private method for consistency
  }
  
  private async linkContent(button: ButtonComponent) {
    if (!this.selectedDomainId || !this.selectedSubjectId || !this.selectedTopicId || !this.selectedSeriesId || !this.selectedAuthorId) {
      new Notice("Please select a parent author");
      return;
    }
    
    const contentTitle = this.contentTitle.trim();
    if (!contentTitle) {
      new Notice("Please enter a content title");
      return;
    }
    
    if (!this.contentFilePath.trim()) {
      new Notice("Please select or enter the content file path");
      return;
    }
    
    // Validate that the file path actually exists in the vault
    const contentFile = this.app.vault.getAbstractFileByPath(this.contentFilePath);
    if (!(contentFile instanceof TFile)) {
        new Notice(`File not found in vault at path: ${this.contentFilePath}`);
        return;
    }

    // Check for potential duplicates - Find the selected author in the cache
    const domain = this.domains.find(d => d.id === this.selectedDomainId);
    const subject = domain?.subjects.find(s => s.id === this.selectedSubjectId);
    const topic = subject?.topics.find(t => t.id === this.selectedTopicId);
    const series = topic?.series.find(ser => ser.id === this.selectedSeriesId);
    const author = series?.authors.find(a => a.id === this.selectedAuthorId);
     if (author) {
         const potentialId = this.plugin.services.pathManager["generateId"](contentTitle);
         if (author.content.some(c => c.id === potentialId)) {
             new Notice(`Content with ID "${potentialId}" already exists for author "${author.name}". Please use a different title or link the existing content.`);
             return;
         }
     }


    if (this.isProcessing) {
      return;
    }
    
    try {
      this.isProcessing = true;
      button.setButtonText("Linking...").setDisabled(true);
      
      const contentMetadata: ContentMetadata = {
        title: contentTitle, // Use trimmed title
        subtitle: this.contentSubtitle,
        position: this.contentPosition,
        totalParts: this.contentTotalParts,
        videoUrl: this.contentVideoUrl,
        filePath: this.contentFilePath, // Pass the actual file path
        // These will be used to find the parent by ID
        domain: this.selectedDomainId, 
        subject: this.selectedSubjectId,
        topic: this.selectedTopicId,
        series: this.selectedSeriesId,
        author: this.selectedAuthorId 
      };
      
      // Link the content using PathManager
      const content = await this.plugin.services.pathManager.addContent(contentMetadata);
      
      new Notice(`Content "${content.title}" linked successfully`);
      this.close();
    } catch (error) {
      if (error instanceof Error) {
        new Notice(`Failed to link content: ${error.message}`);
      } else {
        new Notice("Failed to link content");
      }
    } finally {
      this.isProcessing = false;
      button.setButtonText("Link Content").setDisabled(false);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}