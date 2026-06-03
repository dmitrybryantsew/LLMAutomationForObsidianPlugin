// utils/pathStructure/PathHelper.ts

import { App, Notice } from "obsidian";
import { PathManager } from "./PathManager";
import { ContentMetadata } from "./types";

export class PathHelper {
  private app: App;
  private pathManager: PathManager;
  
  constructor(app: App) {
    this.app = app;
    this.pathManager = new PathManager(app);
  }
  
  async initialize(): Promise<boolean> {
    return await this.pathManager.initialize();
  }
  
  async addVideoContent(videoMetadata: any): Promise<string | null> {
    try {
      // Extract basic metadata
      const { videoUrl, title, channelName } = videoMetadata;
      
      // Detect series info
      const seriesInfo = this.pathManager.detectSeries(title);
      let actualFilepath = ""; //TODO determine later if we create note from video susscesfully
      // Prepare content metadata
      const contentMetadata: ContentMetadata = {
        title,
        videoUrl,
        position: seriesInfo.position,
        totalParts: seriesInfo.totalParts,
        domain: "Video Tutorials", // Default domain
        subject: "Unknown Subject", // To be determined by LLM later
        topic: "Unknown Topic",     // To be determined by LLM later
        series: seriesInfo.series,
        author: channelName,
        filePath: actualFilepath
      };
      
      // Add content to structure
      const content = await this.pathManager.addContent(contentMetadata);
      
      return content.filePath;
    } catch (error) {
      console.error("Failed to add video content:", error);
      new Notice(`Failed to add video: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }
  
  async createPathStructure(domain: string, subject: string, topic: string, series: string, author: string): Promise<boolean> {
    try {
      // Add entities to structure, creating as needed
      // ...
      return true;
    } catch (error) {
      console.error("Failed to create path structure:", error);
      new Notice(`Failed to create path structure: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }
}