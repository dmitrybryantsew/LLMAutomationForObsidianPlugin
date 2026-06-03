// New file: utils/VideoQueueManager.ts
import { App, Notice } from "obsidian";
import { TranscriptManager } from "./TranscriptManager";
import { SummaryType, SUMMARY_PROMPTS} from '../utils/summaryPrompts';
import { Events } from "obsidian"; // Use Obsidian's Events
import type GptFreeTextGeneratorPlugin from '../main';
import { PathManager } from "./pathStructure/PathManager"; // Import PathManager
import { HierarchyManager } from "./HierarchyManager"; // Import HierarchyManager


export interface VideoProcessingOptions {
  summaryModel: string;
  summaryType: SummaryType;
  videoLanguage: string;
  outputLanguage: string;
  numberOfOutputTokens: number;
  topic?: string;
  skipExisting: boolean;
  provider?: 'openrouter' | 'chutes' | 'zai'; // New: Use multi-provider system
  enableChunking?: boolean; // New: Enable chunking for long videos
}

export interface QueuedVideo {
  url: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  title?: string;
  error?: string;
  filePath?: string;
}

export class VideoQueueManager extends Events { // Extend Obsidian's Events
  private app: App;
  private transcriptManager: TranscriptManager | undefined;
  private queue: QueuedVideo[] = [];
  private options: VideoProcessingOptions | null = null;
  private isProcessing: boolean = false;
  private currentIndex: number = -1;
  private plugin: GptFreeTextGeneratorPlugin;
  private hierarchyManager: HierarchyManager;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin, transcriptManager: TranscriptManager, hierarchyManager: HierarchyManager) {
    super();
    this.app = app;
    this.plugin = plugin;
    this.transcriptManager = transcriptManager;
    this.hierarchyManager = hierarchyManager;

  // Bind methods to this instance
  this.processNextVideo = this.processNextVideo.bind(this);
  }

  public addToQueue(urls: string[], options: VideoProcessingOptions) {
    const newVideos = urls.map(url => ({
      url,
      status: 'queued' as const
    }));
    
    this.queue.push(...newVideos);
    this.options = options;
    
    // Emit event for UI update
    this.trigger('queueUpdated', this.queue); // Use trigger instead of emit
    
    // Start processing if not already running
    if (!this.isProcessing) {
      this.processNextVideo();
    }
  }

  public async processNextVideo() {
    if (this.queue.length === 0 || this.currentIndex >= this.queue.length - 1) {
      this.isProcessing = false;
      this.trigger('processingComplete'); // Use trigger instead of emit
      return;
    }
  
    this.isProcessing = true;
    this.currentIndex++;
    const currentVideo = this.queue[this.currentIndex];
    
    // Update status
    currentVideo.status = 'processing';
    this.trigger('videoStatusChanged', currentVideo, this.currentIndex); // Use trigger instead of emit
    
    try {
      // Check if summary already exists
      if (this.options?.skipExisting) {
        const exists = await this.checkSummaryExists(currentVideo.url);
        if (exists.exists) {
          currentVideo.status = 'completed';
          currentVideo.title = exists.title || "Existing Summary";
          currentVideo.filePath = exists.filePath;
          this.trigger('videoStatusChanged', currentVideo, this.currentIndex); // Use trigger instead of emit
          this.trigger('logMessage', `Video ${this.currentIndex + 1}: Skipped - Summary already exists`); // Use trigger instead of emit
          
          // Process next video
          setTimeout(() => this.processNextVideo(), 100);
          return;
        }
      }
      
      // Process video
      if (!this.options) {
        throw new Error("Processing options not set");
      }
      // Get summary prompts based on summary type
      const summaryTypeConfig = SUMMARY_PROMPTS[this.options!.summaryType];


      // Ensure transcriptManager is initialized
      if (!this.transcriptManager) {
        throw new Error("TranscriptManager is not initialized");
      }

      const result = await this.transcriptManager.createLongVideoSummary({
        videoUrl: currentVideo.url,
        summaryModel: this.options!.summaryModel,
        summaryPrompt: summaryTypeConfig.summaryPrompt,
        tagPrompt: summaryTypeConfig.tagPrompt,
        summaryType: this.options!.summaryType,
        summaryFolder: this.plugin.settings.summaryFolder,
        videoLanguage: this.options!.videoLanguage,
        outputLanguage: this.options!.outputLanguage,
        numberOfOutputTokens: this.options!.numberOfOutputTokens,
        topic: this.options!.topic,
        overwriteExisting: true,
        enableChunking: this.options!.enableChunking, // Pass the chunking option
        provider: this.options!.provider // Pass the selected provider
      });

      // Check if summary creation returned a valid file path
      if (!result || typeof result !== 'string' || result.trim() === '') {
        throw new Error(`Summary creation failed or returned an invalid path for ${currentVideo.url}. Result: ${result}`);
      }
      
      // Update queue item
      currentVideo.filePath = result;
      // Extract title from filePath
      const pathParts = result.split('/');
      currentVideo.title = pathParts[pathParts.length - 1].replace('.md', '');
      
      this.trigger('videoStatusChanged', currentVideo, this.currentIndex); // Use trigger instead of emit

      // --- Start Hierarchy Determination ---
      try {
        await this.hierarchyManager.determineAndApplyHierarchy(currentVideo.filePath, currentVideo.url, this.options.summaryModel);
        currentVideo.status = 'completed';
        this.trigger('logMessage', `Video ${this.currentIndex + 1}: Hierarchy determined and file linked`, 'success');
      } catch (hierarchyError) {
        currentVideo.status = 'failed';
        currentVideo.error = hierarchyError instanceof Error ? hierarchyError.message : 'Unknown hierarchy determination error';
        this.trigger('logMessage', `Video ${this.currentIndex + 1}: Hierarchy determination failed - ${currentVideo.error}`, 'error');
      }
      // --- End Hierarchy Determination ---

      // The log message for completion/failure is now handled after hierarchy determination

      // Process next video
      setTimeout(() => this.processNextVideo(), 500);
      
    } catch (error) {
      // Handle error during transcript/summary generation
      currentVideo.status = 'failed';
      currentVideo.error = error instanceof Error ? error.message : 'Unknown error';
      this.trigger('videoStatusChanged', currentVideo, this.currentIndex); // Use trigger instead of emit
      this.trigger('logMessage', `Error: ${currentVideo.error}`, 'error'); // Use trigger instead of emit
      
      // Continue with next video despite error
      setTimeout(() => this.processNextVideo(), 500);
  }
  }





  private async checkSummaryExists(videoUrl: string): Promise<{exists: boolean, filePath?: string, title?: string}> {
    try {
      // Extract video ID from URL
      const videoId = this.extractVideoId(videoUrl);
      if (!videoId) {
        return { exists: false };
      }
      
      // Get all files in summary folder
      const summaryFolderPath = this.plugin.settings.summaryFolder;
      const files = await this.plugin.app.vault.adapter.list(summaryFolderPath);
      
      // Search recursively in the folder structure
      const existingFile = await this.findExistingVideoSummary(files.files, videoId);
      
      if (existingFile) {
        const title = existingFile.split('/').pop()?.replace('.md', '') || '';
        return { 
          exists: true, 
          filePath: existingFile,
          title: title
        };
      }
      
      return { exists: false };
    } catch (error) {
      console.error("Error checking for existing summary:", error);
      return { exists: false };
    }
  }

  private extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
  }
  
  private async findExistingVideoSummary(files: string[], videoId: string): Promise<string | null> {
    for (const filePath of files) {
      if (filePath.endsWith('.md')) {
        try {
          const content = await this.plugin.app.vault.adapter.read(filePath);
          
          // Check if content contains the video ID (usually in the URL)
          if (content.includes(videoId)) {
            return filePath;
          }
        } catch (error) {
          console.error(`Error reading file ${filePath}:`, error);
        }
      }
    }
    return null;
  }
  
  public getQueue(): QueuedVideo[] {
    return this.queue;
  }

  public clearQueue() {
    this.queue = [];
    this.currentIndex = -1;
    this.isProcessing = false;
    this.trigger('queueUpdated', this.queue); // Use trigger instead of emit
  }

  public pauseProcessing() {
    this.isProcessing = false;
    this.trigger('processingPaused'); // Use trigger instead of emit
  }

  public resumeProcessing() {
    if (!this.isProcessing) {
      this.isProcessing = true;
      this.processNextVideo();
      this.trigger('processingResumed'); // Use trigger instead of emit
    }
  }

  public removeVideo(index: number): void {
    if (index < 0 || index >= this.queue.length) {
      throw new Error("Invalid video index");
    }
    
    // If removing the currently processing video, set isProcessing to false
    if (index === this.currentIndex && this.queue[index].status === 'processing') {
      this.isProcessing = false;
    }
    
    // Remove the video from the queue
    this.queue.splice(index, 1);
    
    // Adjust currentIndex if necessary
    if (index <= this.currentIndex) {
      this.currentIndex--;
    }
    
    // Emit update event
    this.trigger('queueUpdated', this.queue); // Use trigger instead of emit
    
    // If we're not processing and there are still videos, start processing
    if (!this.isProcessing && this.queue.length > 0 && this.queue.some(v => v.status === 'queued')) {
      this.resumeProcessing();
    }
  } // End of removeVideo method

  public clearCompletedVideos(): void { // Add missing method declaration
    // Filter out completed videos
    const newQueue = this.queue.filter(video => video.status !== 'completed');

    // Check if we actually removed any videos
    if (newQueue.length === this.queue.length) {
      return; // No videos were removed
    }
    
    // Update the queue
    this.queue = newQueue;
    
    // Adjust currentIndex if necessary
    this.currentIndex = Math.min(this.currentIndex, this.queue.length - 1);
    
    // Emit update event
    this.trigger('queueUpdated', this.queue); // Use trigger instead of emit
  }
  public async saveUnprocessedToBacklog(): Promise<string> {
    // Filter unprocessed videos
    const unprocessedVideos = this.queue.filter(
      video => video.status === 'queued' || video.status === 'failed'
    );
    
    if (unprocessedVideos.length === 0) {
      throw new Error("No unprocessed videos to save");
    }
    
    // Format the data for storage
    const backlogData = {
      date: new Date().toISOString(),
      videos: unprocessedVideos.map(video => ({
        url: video.url,
        status: video.status,
        error: video.error
      }))
    };
    
    // Create the backlog directory if it doesn't exist
    const backlogDir = `${this.plugin.settings.summaryFolder}/backlog`;
    await this.plugin.app.vault.adapter.mkdir(backlogDir);
    
    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const filename = `backlog-${timestamp}.json`;
    const filePath = `${backlogDir}/${filename}`;
    
    // Save the data
    await this.plugin.app.vault.adapter.write(
      filePath,
      JSON.stringify(backlogData, null, 2)
    );
    
    // Emit event
    this.trigger('backlogSaved', filePath); // Use trigger instead of emit
    
    return filePath;
  }
  

  public async retryVideo(index: number): Promise<void> {
    // Check if the index is valid
    if (index < 0 || index >= this.queue.length) {
      throw new Error("Invalid video index");
    }
    
    const video = this.queue[index];
    
    // Check if the video is in a failed state
    if (video.status !== 'failed') {
      throw new Error(`Video is in ${video.status} state, not failed`);
    }
    
    // Create a temporary processing state
    const wasProcessing = this.isProcessing;
    
    // Pause current processing if any
    this.isProcessing = false;
    
    // Move the video to the end of the queue
    const videoToRetry = this.queue.splice(index, 1)[0];
    videoToRetry.status = 'queued';
    videoToRetry.error = undefined;
    this.queue.push(videoToRetry);
    
    // Adjust currentIndex if necessary
    if (index <= this.currentIndex) {
      this.currentIndex--;
    }
    
    // Update UI
    this.trigger('queueUpdated', this.queue); // Use trigger instead of emit
    this.trigger('logMessage', `Video moved to end of queue for retry`, 'info'); // Use trigger instead of emit
    
    // Process only this video
    const newIndex = this.queue.length - 1;
    
    // Process just this one video in isolation
    try {
      // Ensure transcriptManager is initialized
      if (!this.transcriptManager) {
        throw new Error("TranscriptManager is not initialized");
      }
      // Set this video as processing
      this.queue[newIndex].status = 'processing';
      this.trigger('videoStatusChanged', this.queue[newIndex], newIndex); // Use trigger instead of emit
      
      // Process this video
      if (!this.options) {
        throw new Error("Processing options not set");
      }
      
      // Get summary prompts based on summary type
      const summaryTypeConfig = SUMMARY_PROMPTS[this.options!.summaryType];
      
      const result = await this.transcriptManager.createLongVideoSummary({
        videoUrl: videoToRetry.url,
        summaryModel: this.options!.summaryModel,
        summaryPrompt: summaryTypeConfig.summaryPrompt,
        tagPrompt: summaryTypeConfig.tagPrompt,
        summaryType: this.options!.summaryType,
        summaryFolder: this.plugin.settings.summaryFolder,
        videoLanguage: this.options!.videoLanguage,
        outputLanguage: this.options!.outputLanguage,
        numberOfOutputTokens: this.options!.numberOfOutputTokens,
        topic: this.options!.topic,
        overwriteExisting: true,
        enableChunking: this.options!.enableChunking, // Pass the chunking option
        provider: this.options!.provider // Pass the selected provider
      });
      
      // Update status to completed
      this.queue[newIndex].status = 'completed';
      this.queue[newIndex].filePath = result;
      // Extract title from filePath
      const pathParts = result.split('/');
      this.queue[newIndex].title = pathParts[pathParts.length - 1].replace('.md', '');
      
      this.trigger('videoStatusChanged', this.queue[newIndex], newIndex); // Use trigger instead of emit
      this.trigger('logMessage', `Retry successful: ${videoToRetry.url}`, 'success'); // Use trigger instead of emit
      
    } catch (error) {
      // Update status to failed
      this.queue[newIndex].status = 'failed';
      this.queue[newIndex].error = error instanceof Error ? error.message : 'Unknown error';
      
      this.trigger('videoStatusChanged', this.queue[newIndex], newIndex); // Use trigger instead of emit
      this.trigger('logMessage', `Retry failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error'); // Use trigger instead of emit
    }
    
    // Resume the queue processing if it was running before
    if (wasProcessing) {
      this.isProcessing = true;
      this.processNextVideo();
    }
  }
}
