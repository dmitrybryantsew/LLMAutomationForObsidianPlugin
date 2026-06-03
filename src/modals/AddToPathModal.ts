// modals/AddToPathModal.ts

import { App, Modal, Setting, Notice, ButtonComponent } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { ContentMetadata } from "../utils/pathStructure/types";

export class AddToPathModal extends Modal {
  private plugin: GptFreeTextGeneratorPlugin;
  private videoUrl: string = "";
  private videoTitle: string = "";
  private domainName: string = "";
  private subjectName: string = "";
  private topicName: string = "";
  private seriesName: string = "";
  private authorName: string = "";
  private position: number | undefined;
  private totalParts: number | undefined;
  private actualFilepath: string = "";

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, videoUrl: string = "", videoTitle: string = "") {
    super(app);
    this.plugin = plugin;
    this.videoUrl = videoUrl;
    this.videoTitle = videoTitle;
    
    // Try to detect series info
    if (videoTitle) {
      const seriesInfo = this.plugin.services.pathManager.detectSeries(videoTitle);
      this.seriesName = seriesInfo.series;
      this.position = seriesInfo.position;
      this.totalParts = seriesInfo.totalParts;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Add Content to Path Structure" });

    // Video URL input
    new Setting(contentEl)
      .setName("Video URL")
      .setDesc("URL of the video to add")
      .addText(text => text
        .setValue(this.videoUrl)
        .onChange(value => {
          this.videoUrl = value;
        }));

    // Video Title input
    new Setting(contentEl)
      .setName("Video Title")
      .setDesc("Title of the video")
      .addText(text => text
        .setValue(this.videoTitle)
        .onChange(value => {
          this.videoTitle = value;
        }));

    // Domain input
    new Setting(contentEl)
      .setName("Domain")
      .setDesc("Knowledge domain (e.g., Programming, Psychology)")
      .addText(text => text
        .setValue(this.domainName)
        .onChange(value => {
          this.domainName = value;
        }));

    // Subject input
    new Setting(contentEl)
      .setName("Subject")
      .setDesc("Subject within the domain (e.g., UnrealEngine5, JavaScript)")
      .addText(text => text
        .setValue(this.subjectName)
        .onChange(value => {
          this.subjectName = value;
        }));

    // Topic input
    new Setting(contentEl)
      .setName("Topic")
      .setDesc("Topic within the subject (e.g., GameDevelopment, WebApps)")
      .addText(text => text
        .setValue(this.topicName)
        .onChange(value => {
          this.topicName = value;
        }));

    // Series input
    new Setting(contentEl)
      .setName("Series")
      .setDesc("Name of the video series")
      .addText(text => text
        .setValue(this.seriesName)
        .onChange(value => {
          this.seriesName = value;
        }));

    // Author input
    new Setting(contentEl)
      .setName("Author")
      .setDesc("Creator of the video")
      .addText(text => text
        .setValue(this.authorName)
        .onChange(value => {
          this.authorName = value;
        }));

    // Position input
    new Setting(contentEl)
      .setName("Position in Series")
      .setDesc("Number in the series (e.g., Part 1, Episode 2)")
      .addText(text => text
        .setValue(this.position?.toString() || "")
        .onChange(value => {
          const num = parseInt(value);
          this.position = isNaN(num) ? undefined : num;
        }));

    // Total Parts input
    new Setting(contentEl)
      .setName("Total Parts")
      .setDesc("Total number of parts in the series")
      .addText(text => text
        .setValue(this.totalParts?.toString() || "")
        .onChange(value => {
          const num = parseInt(value);
          this.totalParts = isNaN(num) ? undefined : num;
        }));

    // Buttons
    const buttonContainer = contentEl.createDiv();
    
    // Add button
    new ButtonComponent(buttonContainer)
      .setButtonText("Add to Structure")
      .setCta()
      .onClick(async () => {
        if (!this.validateInputs()) return;
        
        try {
          const metadata: ContentMetadata = {
            title: this.videoTitle,
            videoUrl: this.videoUrl,
            domain: this.domainName,
            subject: this.subjectName,
            topic: this.topicName,
            series: this.seriesName,
            author: this.authorName,
            position: this.position,
            totalParts: this.totalParts,
            filePath: this.actualFilepath //TODO fix we not looking for it or prompting user to add it
          };
          
          const content = await this.plugin.services.pathManager.addContent(metadata);
          new Notice(`Content added: ${content.filePath}`);
          this.close();
        } catch (error) {
          new Notice(`Failed to add content: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      });

    // Cancel button
    new ButtonComponent(buttonContainer)
      .setButtonText("Cancel")
      .onClick(() => {
        this.close();
      });
  }

  private validateInputs(): boolean {
    if (!this.videoUrl) {
      new Notice("Please enter a video URL");
      return false;
    }
    
    if (!this.videoTitle) {
      new Notice("Please enter a video title");
      return false;
    }
    
    if (!this.domainName) {
      new Notice("Please enter a domain name");
      return false;
    }
    
    if (!this.subjectName) {
      new Notice("Please enter a subject name");
      return false;
    }
    
    if (!this.topicName) {
      new Notice("Please enter a topic name");
      return false;
    }
    
    if (!this.seriesName) {
      new Notice("Please enter a series name");
      return false;
    }
    
    if (!this.authorName) {
      new Notice("Please enter an author name");
      return false;
    }
    
    return true;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}