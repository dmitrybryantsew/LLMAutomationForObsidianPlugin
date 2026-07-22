// New file: views/VideoProcessingView.ts
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { QueuedVideo } from "../utils/VideoQueueManager";
import { TFile } from "obsidian";

export const VIEW_TYPE_VIDEO_PROCESSING = "gpt4free-video-processing";

export class VideoProcessingView extends ItemView {
  private plugin: GptFreeTextGeneratorPlugin;
  private queueContainer: HTMLElement | null = null;
  private logContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: GptFreeTextGeneratorPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_VIDEO_PROCESSING;
  }

  getDisplayText(): string {
    return "Video Processing Queue";
  }

  private eventRefs: Array<{ name: string; callback: (...args: any[]) => void }> = [];

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    
    // Create main layout
    const layoutContainer = container.createDiv({
      cls: "video-processing-layout",
    });
    
    // Create header with controls
    const headerEl = layoutContainer.createDiv({ cls: "video-processing-header" });
    headerEl.createEl("h2", { text: "Video Processing Queue" });
    
    const controlsEl = headerEl.createDiv({ cls: "processing-controls" });
    
    // Pause/Resume button
    const pauseResumeBtn = controlsEl.createEl("button", { 
      cls: "processing-control-btn",
      text: "Pause"
    });
    pauseResumeBtn.addEventListener("click", () => this.togglePauseResume(pauseResumeBtn));
    
    // Clear Queue button
    const clearBtn = controlsEl.createEl("button", { 
      cls: "processing-control-btn processing-clear-btn",
      text: "Clear Queue"
    });
    clearBtn.addEventListener("click", () => this.clearQueue());
    
    // Create tabs for Queue and Logs
    const tabsEl = layoutContainer.createDiv({ cls: "processing-tabs" });
    
    const queueTabBtn = tabsEl.createEl("button", {
      cls: "processing-tab-btn processing-tab-active",
      text: "Queue"
    });
    
    const logsTabBtn = tabsEl.createEl("button", {
      cls: "processing-tab-btn",
      text: "Logs"
    });
    
    // Create content containers
    const contentEl = layoutContainer.createDiv({ cls: "processing-content" });
    
    // Queue container
    this.queueContainer = contentEl.createDiv({ cls: "queue-container" });
    
    // Log container (initially hidden)
    this.logContainer = contentEl.createDiv({ cls: "log-container" });
    this.logContainer.style.display = "none";
    
    // Add event listeners for tabs
    queueTabBtn.addEventListener("click", () => {
      queueTabBtn.classList.add("processing-tab-active");
      logsTabBtn.classList.remove("processing-tab-active");
      if (this.queueContainer) this.queueContainer.style.display = "block";
      if (this.logContainer) this.logContainer.style.display = "none";
    });
    
    logsTabBtn.addEventListener("click", () => {
      logsTabBtn.classList.add("processing-tab-active");
      queueTabBtn.classList.remove("processing-tab-active");
      if (this.queueContainer) this.queueContainer.style.display = "none";
      if (this.logContainer) this.logContainer.style.display = "block";
    });
    
    // Setup event listeners for queue updates (with cleanup tracking)
    const queueUpdatedCb = (queue: unknown) => {
      this.updateQueueDisplay(queue as QueuedVideo[]); 
    };
    this.plugin.videoQueueManager.on('queueUpdated', queueUpdatedCb);
    this.eventRefs.push({ name: 'queueUpdated', callback: queueUpdatedCb });
    
    const videoStatusChangedCb = (video: unknown, index: unknown) => {
      const typedVideo = video as QueuedVideo;
      const typedIndex = index as number;
      this.updateVideoStatus(typedVideo, typedIndex);
      this.addLogEntry(`Video ${typedIndex + 1}: ${typedVideo.status} - ${typedVideo.url}`);
      if (typedVideo.error) {
        this.addLogEntry(`Error: ${typedVideo.error}`, 'error');
      }
    };
    this.plugin.videoQueueManager.on('videoStatusChanged', videoStatusChangedCb);
    this.eventRefs.push({ name: 'videoStatusChanged', callback: videoStatusChangedCb });
    
    const processingCompleteCb = () => {
      this.addLogEntry('All videos processed', 'success');
      new Notice("Video processing complete!");
    };
    this.plugin.videoQueueManager.on('processingComplete', processingCompleteCb);
    this.eventRefs.push({ name: 'processingComplete', callback: processingCompleteCb });
    
    // Initial queue display
    this.updateQueueDisplay(this.plugin.videoQueueManager.getQueue());
    
    // Add some CSS
    this.addStyles();
  }

  private updateQueueDisplay(queue: QueuedVideo[]): void {
    if (!this.queueContainer) return;
    
    this.queueContainer.empty();
    
    if (queue.length === 0) {
      this.queueContainer.createEl("p", { 
        text: "No videos in queue. Add videos using the Playlist Summary modal.",
        cls: "empty-queue-message"
      });
      return;
    }
    
    // Add action buttons at the top
    const queueActions = this.queueContainer.createEl("div", { cls: "queue-actions" });
    
    // Clear Completed button
    const clearCompletedBtn = queueActions.createEl("button", {
      text: "Clear Completed",
      cls: "queue-action-btn"
    });
    clearCompletedBtn.addEventListener("click", () => this.clearCompletedVideos());
    
    // Save Unprocessed button
    const saveUnprocessedBtn = queueActions.createEl("button", {
      text: "Save Unprocessed to Backlog",
      cls: "queue-action-btn"
    });
    saveUnprocessedBtn.addEventListener("click", () => this.saveUnprocessedToBacklog());
    
    // Create queue list
    const queueList = this.queueContainer.createEl("div", { cls: "queue-list" });
    
    queue.forEach((video, index) => {
      const videoItem = queueList.createDiv({ 
        cls: `queue-item queue-status-${video.status}`,
        attr: { 'data-index': index.toString() }
      });
      
      // Status icon
      const statusIcon = videoItem.createSpan({ cls: "queue-item-status" });
      switch (video.status) {
        case 'queued': 
          statusIcon.textContent = "⌛"; 
          break;
        case 'processing': 
          statusIcon.textContent = "⚙️"; 
          break;
        case 'completed': 
          statusIcon.textContent = "✅"; 
          break;
        case 'failed': 
          statusIcon.textContent = "❌"; 
          break;
      }
      
      // Title/URL
      const titleEl = videoItem.createDiv({ cls: "queue-item-title" });
      titleEl.textContent = video.title || this.getVideoIdFromUrl(video.url);
      
      // URL as subtitle with copy button
      const urlContainer = videoItem.createDiv({ cls: "queue-item-url-container" });
      
      const urlEl = urlContainer.createEl("span", { 
        text: video.url,
        cls: "queue-item-url"
      });
      
      const copyBtn = urlContainer.createEl("button", {
        text: "📋",
        cls: "url-copy-btn",
        attr: {
          title: "Copy URL to clipboard"
        }
      });
      copyBtn.addEventListener("click", () => this.copyToClipboard(video.url));
      
      // Add actions for all videos
      const actionsEl = videoItem.createDiv({ cls: "queue-item-actions" });
      
      // Delete button for all videos
      const deleteBtn = actionsEl.createEl("button", {
        text: "Delete",
        cls: "queue-item-action queue-item-delete"
      });
      deleteBtn.addEventListener("click", () => this.deleteVideo(index));
      
      // Add open button for completed videos
      if (video.status === 'completed' && video.filePath) {
        const openBtn = actionsEl.createEl("button", {
          text: "Open",
          cls: "queue-item-action"
        });
        openBtn.addEventListener("click", () => this.openVideoSummary(video.filePath!));
      }
      
      // Add retry button for failed videos
      if (video.status === 'failed') {
        const retryBtn = actionsEl.createEl("button", {
          text: "Retry",
          cls: "queue-item-action"
        });
        retryBtn.addEventListener("click", () => this.retryVideo(index));
        
        if (video.error) {
          const errorEl = videoItem.createDiv({ 
            text: video.error,
            cls: "queue-item-error"
          });
        }
      }
    });
  }
  
  // Add these methods to the class
  
  private copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text)
      .then(() => {
        new Notice("URL copied to clipboard");
        this.addLogEntry("URL copied to clipboard", "info");
      })
      .catch(err => {
        console.error("Could not copy text: ", err);
        new Notice("Failed to copy URL");
      });
  }
  
  private deleteVideo(index: number): void {
    try {
      // Get confirmation from user
      if (!confirm("Are you sure you want to remove this video from the queue?")) {
        return;
      }
      
      // Call the VideoQueueManager to remove the video
      this.plugin.videoQueueManager.removeVideo(index);
      this.addLogEntry(`Video ${index + 1} removed from queue`, "info");
    } catch (error) {
      console.error("Error deleting video:", error);
      new Notice("Failed to delete video");
    }
  }
  
  private clearCompletedVideos(): void {
    try {
      const completedCount = this.plugin.videoQueueManager.getQueue().filter(v => v.status === 'completed').length;
      
      if (completedCount === 0) {
        new Notice("No completed videos to clear");
        return;
      }
      
      // Get confirmation from user
      if (!confirm(`Are you sure you want to clear ${completedCount} completed videos from the queue?`)) {
        return;
      }
      
      // Call the VideoQueueManager to clear completed videos
      this.plugin.videoQueueManager.clearCompletedVideos();
      this.addLogEntry(`Cleared ${completedCount} completed videos from queue`, "info");
    } catch (error) {
      console.error("Error clearing completed videos:", error);
      new Notice("Failed to clear completed videos");
    }
  }
  
  private async saveUnprocessedToBacklog(): Promise<void> {
    try {
      const unprocessedVideos = this.plugin.videoQueueManager.getQueue()
        .filter(v => v.status === 'queued' || v.status === 'failed');
        
      if (unprocessedVideos.length === 0) {
        new Notice("No unprocessed videos to save");
        return;
      }
      
      const backlogFile = await this.plugin.videoQueueManager.saveUnprocessedToBacklog();
      this.addLogEntry(`Saved ${unprocessedVideos.length} unprocessed videos to backlog: ${backlogFile}`, "success");
      new Notice(`Saved ${unprocessedVideos.length} videos to backlog`);
    } catch (error) {
      console.error("Error saving backlog:", error);
      new Notice("Failed to save videos to backlog");
    }
  }
  

  private updateVideoStatus(video: QueuedVideo, index: number): void {
    if (!this.queueContainer) return;
    
    const videoItem = this.queueContainer.querySelector(`[data-index="${index}"]`);
    if (!videoItem) {
      // If item doesn't exist, refresh the whole queue display
      this.updateQueueDisplay(this.plugin.videoQueueManager.getQueue());
      return;
    }
    
    // Update class
    videoItem.className = `queue-item queue-status-${video.status}`;
    
    // Update status icon
    const statusIcon = videoItem.querySelector(".queue-item-status");
    if (statusIcon) {
      switch (video.status) {
        case 'queued': 
          statusIcon.textContent = "⌛"; 
          break;
        case 'processing': 
          statusIcon.textContent = "⚙️"; 
          break;
        case 'completed': 
          statusIcon.textContent = "✅"; 
          break;
        case 'failed': 
          statusIcon.textContent = "❌"; 
          break;
      }
    }
    
    // Update title if available
    if (video.title) {
      const titleEl = videoItem.querySelector(".queue-item-title");
      if (titleEl) {
        titleEl.textContent = video.title;
      }
    }
    
    // Add actions for completed videos
    if (video.status === 'completed' && video.filePath) {
      let actionsEl = videoItem.querySelector(".queue-item-actions");
      if (!actionsEl) {
        actionsEl = videoItem.createDiv({ cls: "queue-item-actions" });
      } else {
        actionsEl.empty();
      }
      
      const openBtn = actionsEl.createEl("button", {
        text: "Open",
        cls: "queue-item-action"
      });
      openBtn.addEventListener("click", () => this.openVideoSummary(video.filePath!));
    }
    
    // Add retry button for failed videos
    if (video.status === 'failed') {
      let actionsEl = videoItem.querySelector(".queue-item-actions");
      if (!actionsEl) {
        actionsEl = videoItem.createDiv({ cls: "queue-item-actions" });
      } else {
        actionsEl.empty();
      }
      
      const retryBtn = actionsEl.createEl("button", {
        text: "Retry",
        cls: "queue-item-action"
      });
      retryBtn.addEventListener("click", () => this.retryVideo(index));
      
      if (video.error) {
        let errorEl = videoItem.querySelector(".queue-item-error");
        if (!errorEl) {
          errorEl = videoItem.createDiv({ 
            text: video.error,
            cls: "queue-item-error"
          });
        } else {
          errorEl.textContent = video.error;
        }
      }
    }
  }

  private addLogEntry(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    if (!this.logContainer) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = this.logContainer.createDiv({ 
      cls: `log-entry log-${type}`,
      attr: { 
        // This makes it focusable and better for selection
        tabindex: "0"
      }
    });
    
    logEntry.createSpan({ 
      text: `[${timestamp}] `,
      cls: "log-timestamp"
    });
    
    logEntry.createSpan({ 
      text: message,
      cls: "log-message" 
    });
    
    // Auto-scroll to bottom
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
  }

  private togglePauseResume(button: HTMLButtonElement): void {
    const isCurrentlyPaused = button.textContent === "Resume";
    
    if (isCurrentlyPaused) {
      this.plugin.videoQueueManager.resumeProcessing();
      button.textContent = "Pause";
      this.addLogEntry("Processing resumed", 'info');
    } else {
      this.plugin.videoQueueManager.pauseProcessing();
      button.textContent = "Resume";
      this.addLogEntry("Processing paused", 'info');
    }
  }

  private clearQueue(): void {
    this.plugin.videoQueueManager.clearQueue();
    this.addLogEntry("Queue cleared", 'info');
    new Notice("Video queue cleared");
  }

  private openVideoSummary(filePath: string): void {
    try {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        this.app.workspace.getLeaf(false).openFile(file);
      } else {
        new Notice(`File not found: ${filePath}`);
      }
    } catch (error) {
      console.error("Error opening file:", error);
      new Notice("Failed to open summary file");
    }
  }

  private retryVideo(index: number): void {
    try {
      // Get the queue from the VideoQueueManager
      const queue = this.plugin.videoQueueManager.getQueue();
      
      // Check if the index is valid
      if (index < 0 || index >= queue.length) {
        new Notice("Invalid video index");
        return;
      }
      
      const video = queue[index];
      
      // Check if the video is failed
      if (video.status !== 'failed') {
        new Notice(`Video is in ${video.status} state, not failed`);
        return;
      }
      
      // Request VideoQueueManager to retry this specific video
      this.plugin.videoQueueManager.retryVideo(index).then(() => {
        new Notice(`Retrying video...`);
      }).catch(error => {
        new Notice(`Failed to retry: ${error.message}`);
      });
    } catch (error) {
      console.error("Error retrying video:", error);
      new Notice("Failed to retry video");
    }
  }

  private getVideoIdFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const videoId = urlObj.searchParams.get('v');
      return videoId || "Unknown Video";
    } catch (error) {
      return "Unknown Video";
    }
  }

  private addStyles(): void {
    // Add CSS for the processing view
    const styleEl = document.createElement("style");
    styleEl.id = "video-processing-styles";
    styleEl.textContent = `
          .video-processing-layout {
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          
          .video-processing-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--background-modifier-border);
            padding-bottom: 10px;
            margin-bottom: 15px;
          }
          
          .processing-controls {
            display: flex;
            gap: 10px;
          }
          
          .processing-control-btn {
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            border: 1px solid var(--background-modifier-border);
            background: var(--interactive-normal);
            color: var(--text-normal);
          }
          
          .processing-clear-btn {
            background: var(--background-modifier-error);
            color: white;
          }
          
          .processing-tabs {
            display: flex;
            gap: 5px;
            margin-bottom: 15px;
          }
          
          .processing-tab-btn {
            padding: 7px 15px;
            border-radius: 4px 4px 0 0;
            cursor: pointer;
            border: 1px solid var(--background-modifier-border);
            border-bottom: none;
            background: var(--background-secondary);
            color: var(--text-muted);
          }
          
          .processing-tab-active {
            background: var(--background-primary);
            color: var(--text-normal);
            border-bottom: 2px solid var(--interactive-accent);
          }
          
          .processing-content {
            flex: 1;
            overflow: hidden;
            position: relative;
          }
          
          .queue-container, .log-container {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            overflow-y: auto;
            padding: 10px;
          }
          .log-container {
            font-family: monospace;
            white-space: pre-wrap;
            user-select: text;
            cursor: text;
            padding: 10px;
            background: var(--code-background);
            border-radius: 4px;
            }

            .log-entry {
            padding: 5px 0;
            border-bottom: 1px solid var(--background-modifier-border);
            font-family: monospace;
            user-select: text;
            cursor: text;
            }

            .log-message {
            user-select: text;
            }

            .log-timestamp {
            color: var(--text-muted);
            user-select: text;
            }
          .queue-actions {
          display: flex;
          gap: 10px;
          margin-bottom: 15px;
        }
          .queue-action-btn {
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          border: 1px solid var(--background-modifier-border);
          background: var(--interactive-normal);
          color: var(--text-normal);
        }
        
        .queue-item-url-container {
          display: flex;
          align-items: center;
          font-size: 0.8em;
          color: var(--text-muted);
          word-break: break-all;
          margin-bottom: 10px;
        }
        
        .queue-item-url {
          flex: 1;
        }
        
        .url-copy-btn {
          font-size: 1em;
          background: none;
          border: none;
          cursor: pointer;
          padding: 3px 6px;
          border-radius: 4px;
          margin-left: 5px;
          color: var(--text-muted);
        }
        
        .url-copy-btn:hover {
          background: var(--background-modifier-hover);
          color: var(--text-normal);
        }
        
        .queue-item-delete {
          background: var(--background-modifier-error);
          color: white;
        }
          .empty-queue-message {
            padding: 20px;
            text-align: center;
            color: var(--text-muted);
          }
          
          .queue-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          
          .queue-item {
            padding: 15px;
            border-radius: 5px;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-secondary);
          }
          
          .queue-status-queued {
            border-left: 5px solid var(--text-muted);
          }
          
          .queue-status-processing {
            border-left: 5px solid var(--interactive-accent);
            background: var(--background-secondary-alt);
          }
          
          .queue-status-completed {
            border-left: 5px solid var(--text-success);
          }
          
          .queue-status-failed {
            border-left: 5px solid var(--text-error);
          }
          
          .queue-item-title {
            font-weight: bold;
            margin-bottom: 5px;
          }
          
          .queue-item-url {
            font-size: 0.8em;
            color: var(--text-muted);
            word-break: break-all;
            margin-bottom: 10px;
          }
          
          .queue-item-status {
            float: right;
            font-size: 1.2em;
          }
          
          .queue-item-actions {
            display: flex;
            gap: 5px;
            margin-top: 10px;
          }
          
          .queue-item-action {
            padding: 3px 10px;
            border-radius: 4px;
            cursor: pointer;
            border: 1px solid var(--background-modifier-border);
            background: var(--interactive-normal);
            color: var(--text-normal);
            font-size: 0.8em;
          }
          
          .queue-item-error {
            margin-top: 10px;
            padding: 8px;
            background: var(--background-modifier-error-rgb);
            border-radius: 4px;
            color: var(--text-error);
            font-size: 0.9em;
          }
          
          .log-entry {
            padding: 5px 0;
            border-bottom: 1px solid var(--background-modifier-border);
            font-family: monospace;
          }
          
          .log-timestamp {
            color: var(--text-muted);
          }
          
          .log-info .log-message {
            color: var(--text-normal);
          }
          
          .log-error .log-message {
            color: var(--text-error);
          }
          
          .log-success .log-message {
            color: var(--text-success);
          }
        `;
    document.head.appendChild(styleEl);
  }

  async onClose(): Promise<void> {
    // Remove event listeners from videoQueueManager to prevent duplicates on re-open
    for (const ref of this.eventRefs) {
      this.plugin.videoQueueManager.off(ref.name, ref.callback);
    }
    this.eventRefs = [];

    // Remove injected style element
    const styleEl = document.getElementById("video-processing-styles");
    if (styleEl) {
      styleEl.remove();
    }
  }
}
