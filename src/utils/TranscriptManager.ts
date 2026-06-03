import { App, TFile, Notice } from "obsidian";
import { FileManager } from "./FileManager";
import { ErrorHandler } from "./ErrorHandler";
import { sanitizeFilename } from "../utils/helpers";
import { TagManager } from "./TagManager"; // Import TagManager
import { sanitizeForMetadata } from "../utils/helpers";
import { SummaryType, SUMMARY_PROMPTS, getAvailableSummaryTypes } from '../utils/summaryPrompts';
import {chunkTranscriptBySentences, chunkTranscript} from "./helpers"
import { PathManager } from "./pathStructure/PathManager";
import { ContentMetadata } from "./pathStructure/types";
import { DatabaseManager } from "../database/DatabaseManager";
import { LLMClientService } from "./LLMClientService";
import { TextGenerationOptions, OpenRouterError } from "../types/openrouter";

type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama';

interface VideoData {
  title: string;
  channel: string;
  channel_id: string;
  description: string;
  duration: string;
  view_count: number;
  like_count: number;
  upload_date: string;
  thumbnail?: string;
  tags?: string[]; // May contain tags from the provider
}

interface LocalTranscriptInput {
  filePath: string; // Path to the local .txt transcript file
  title?: string; // Now optional, can be derived from filename
  authorOrCourse: string; // Now required
  transcriptLanguage: string;
  outputLanguage: string;
  targetFolder: string; // The base folder where the markdown file will be saved
  summaryModel: string; // New: LLM model for summary
  summaryPrompt: string; // New: Base prompt for summary
  tagPrompt: string; // New: Base prompt for tags
  summaryType: SummaryType; // New: Type of summary
  numberOfOutputTokens: number; // New: Max tokens for summary
  topic?: string; // New: Optional topic for tutorials
  provider?: TextProviderId; // Optional provider override
}

interface TranscriptMetadata {
  title: string;
  author: string;
  date_requested: string;
  language: string;
  output_language : string;
  duration: string;
  views: number;
  likes: number;
  video_url: string;
  
}

interface VideoSummaryOptions {
  videoUrl: string;
  summaryModel: string;
  summaryPrompt: string; // Base prompt from config
  tagPrompt: string; // Base tag prompt from config
  summaryType: SummaryType;
  summaryFolder: string;
  videoLanguage: string;
  outputLanguage : string; // Add this
  topic?: string;            // Optional topic for tutorials
  numberOfOutputTokens : number;
  overwriteExisting?: boolean; // Add this new property
  enableChunking?: boolean; // New: Enable chunking for long videos
  saveToDatabase?: boolean; // New: Save transcript to database instead of note file
  provider?: TextProviderId; // Optional provider override
}
  
  // You might also want a response type for the provider metadata
  interface ProviderMetadata {
    provider_name: string;
    provider_url: string;
    actual_model: string;
    request_time: string;
    completion_time: string;
    elapsed_time: string;
  }
  
  // And a combined response type (assuming API returns this structure)
  interface GenerationResponse {
    output: string; // The generated text (summary or tags)
    metadata: ProviderMetadata;
  }

class TranscriptManager {
    private app: App;
    private fileManager: FileManager;
    private tagManager: TagManager; // Store TagManager instance
    private pathManager: PathManager;
    private lastProcesedVideoData: VideoData | undefined;
    private databaseManager: DatabaseManager | null = null;
    private settings: any; // Store plugin settings
    private llmClientService: LLMClientService | null = null; // LLM Client Service
    private debugEnabled: boolean = false; // Debug mode flag

  constructor(app: App, fileManager: FileManager, tagManager: TagManager, pathManager: PathManager, databaseManager: DatabaseManager | null = null, settings: any = null, llmClientService: LLMClientService | null = null) {
    this.app = app;
    this.fileManager = fileManager;
    this.tagManager = tagManager; // Get TagManager from services
    this.pathManager = pathManager;
    this.databaseManager = databaseManager;
    this.settings = settings;
    this.llmClientService = llmClientService;
    this.debugEnabled = settings?.debugMode || false;
  }

  public async processLocalTranscript(options: LocalTranscriptInput): Promise<string> {
    try {
      const transcriptContent = await this.fileManager.readFile(options.filePath);
      const sanitizedAuthorOrCourse = sanitizeFilename(options.authorOrCourse);
      
      // Derive title from filename if not provided
      const derivedTitle = options.title || options.filePath.split('/').pop()?.replace(/\.txt$/, '') || 'Untitled Transcript';
      const sanitizedTitle = sanitizeFilename(derivedTitle);
      
      const timestamp = new Date().toISOString().slice(0, 10);

      // Folder structure: targetFolder/AuthorOrCourse/Title/transcript.md
      let folderPath = `${options.targetFolder}/${sanitizedAuthorOrCourse}/${sanitizedTitle}`;
      
      // Add language code to folder path if translating
      if (options.transcriptLanguage !== options.outputLanguage) {
        folderPath += `/${options.outputLanguage}`;
      }

      const metadata: TranscriptMetadata = {
        title: derivedTitle,
        author: options.authorOrCourse,
        date_requested: new Date().toISOString(),
        language: options.transcriptLanguage,
        output_language: options.outputLanguage,
        duration: "0", // Default for local files
        views: 0,    // Default for local files
        likes: 0,    // Default for local files
      video_url: `file://${options.filePath}` // Use file URI
      };

      // 1. Generate Tags based on the full transcript
      const tags = await this.generateTagsForLocalTranscript(transcriptContent, derivedTitle, options);

      // 2. Chunk the transcript for summary generation
      const chunks = chunkTranscriptBySentences(transcriptContent, 5500, 7000); // Adjust chunk size based on model context window

      let finalSummary = "";
      const chunkSummaries: string[] = [];

      if (chunks.length > 1) {
        // Handle multiple chunks - Generate summary for each chunk first
        new Notice(`Generating summary in ${chunks.length} parts...`);
        // Get LLM client once before the loop
        if (!this.llmClientService) {
          throw new Error("LLM Client Service not initialized");
        }
        
        const llmClient = options.provider
          ? this.llmClientService.getClientForProvider(options.provider)
          : this.llmClientService.getClient();
        if (!llmClient) {
          throw new Error("LLM client not initialized. Please check your settings and API keys.");
        }
        
        for (let i = 0; i < chunks.length; i++) {
          const chunkPrompt = `${options.summaryPrompt} (This is part ${i+1} of ${chunks.length}. Focus on summarizing this segment.)`;
          
          const chunkOptions: TextGenerationOptions = {
            message: chunkPrompt + "\n\n" + chunks[i],
            model: options.summaryModel,
            language: options.outputLanguage,
            files: [],
            temperature: 0.7,
            maxTokens: options.numberOfOutputTokens
          };
          
          const chunkResult = await llmClient.generateText(chunkOptions);
          const summary = chunkResult.output || `[Error summarizing chunk ${i+1}]`;
          chunkSummaries.push(summary);
          new Notice(`Summarized part ${i+1} of ${chunks.length}.`);
        }
        
        // 3. Create Meta-summary from chunk summaries
        new Notice("Combining part summaries...");
        const metaSummaryPrompt = `Create a cohesive overall summary integrating these summaries from different parts of the same video. Do not just concatenate; synthesize them into a single, well-structured summary covering the entire video.

        ${chunkSummaries.map((summary, i) => `## Part ${i+1}\n${summary}`).join('\n\n')}
        
        Synthesize these parts into ONE comprehensive summary in ${options.outputLanguage}.`;

        const metaOptions: TextGenerationOptions = {
          message: metaSummaryPrompt,
          model: options.summaryModel,
          language: options.outputLanguage,
          files: [],
          temperature: 0.7,
          maxTokens: options.numberOfOutputTokens
        };
        
        const metaResult = await llmClient.generateText(metaOptions);
        finalSummary = metaResult.output || "Failed to generate meta-summary.";
        
      } else {
        // Single chunk - Generate summary directly
        // Get LLM client for single chunk case
        if (!this.llmClientService) {
          throw new Error("LLM Client Service not initialized");
        }
        
        const llmClient = options.provider
          ? this.llmClientService.getClientForProvider(options.provider)
          : this.llmClientService.getClient();
        if (!llmClient) {
          throw new Error("LLM client not initialized. Please check your settings and API keys.");
        }
        
        new Notice("Generating summary...");
        const summaryPrompt = options.topic
          ? options.summaryPrompt.replace(/\{topic\}/g, options.topic)
          : options.summaryPrompt;

        const summaryOptions: TextGenerationOptions = {
          message: summaryPrompt + "\n\n" + transcriptContent,
          model: options.summaryModel,
          language: options.outputLanguage,
          files: [],
          temperature: 0.7,
          maxTokens: options.numberOfOutputTokens
        };

        const summaryResult = await llmClient.generateText(summaryOptions);
        finalSummary = summaryResult.output || "No summary output received.";
      }
      
      // Save the Summary Markdown file
      const fileName = `${sanitizedTitle}.md`;

      // Create metadata with generated tags
      const finalMetadata = {
        ...metadata, // Include existing metadata
        tags: this.tagManager.formatTags(tags), // Format tags for metadata
        summary_model: options.summaryModel, // Record model used for summary
        summary_type: options.summaryType, // Record summary type
        parts_summarized: chunks.length // Add number of parts
      };

      // Format content for the file
      const content = this.formatLocalTranscriptContent(
        derivedTitle,
        finalSummary,
        transcriptContent,
        tags,
        chunkSummaries
      );

      const filePath = await this.fileManager.saveFile({
        content,
        folder: folderPath,
        filename: fileName,
        metadata: finalMetadata,
        overwrite: true
      });

      new Notice(`Local transcript "${derivedTitle}" processed and summarized.`);
      return filePath;

    } catch (error: unknown) {
      ErrorHandler.handleError(error, "API_ERROR", {
        operation: "process-local-transcript-with-summary",
        filePath: options.filePath,
        title: options.title,
        summaryModel: options.summaryModel
      });
      throw error;
    }
  }

  async requestTranscript(
    videoUrl: string,
    transcriptLanguage: string ,
    outputLanguage: string , // Add new parameter for output language
    transcriptFolder: string,
    saveToDatabase: boolean = false // New parameter to skip file saving
  ): Promise<{ filePath: string | null; videoData: VideoData; transcript: string }> {
    try {
      // Note: Transcript fetching still uses Python server for now
      // This could be migrated to use YouTube API directly in the future
      const response = await fetch("http://127.0.0.1:8001/get-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: videoUrl,
          transcript_language: transcriptLanguage,
          output_language: outputLanguage // Pass output language to backend
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      const { video_data, transcript } = data;
      this.lastProcesedVideoData = video_data;
      
      let filePath: string | null = null;
      
      // Only save transcript to file if NOT saving to database
      if (!saveToDatabase) {
        const timestamp = new Date().toISOString().slice(0, 10);
        const sanitizedAuthor = sanitizeFilename(video_data.channel);
        const sanitizedTitle = sanitizeFilename(video_data.title);
        let folderPath = `${transcriptFolder}/${timestamp}/${sanitizedAuthor}/${sanitizedTitle}`;
        
        // Add language code to folder path if translating
        if (transcriptLanguage !== outputLanguage) {
          folderPath += `/${outputLanguage}`;
        }
    
        const metadata: TranscriptMetadata = {
          title: video_data.title,
          author: video_data.channel,
          date_requested: new Date().toISOString(),
          language: transcriptLanguage,
          output_language: outputLanguage, // Save the output language
          duration: video_data.duration,
          views: video_data.view_count,
          likes: video_data.like_count,
          video_url: videoUrl
        };
    
        const content = this.formatTranscriptContent(video_data, transcript, metadata);
    
        filePath = await this.fileManager.saveFile({
          content,
          folder: folderPath,
          filename: "transcript.md",
          metadata,
          overwrite: true // Overwrite if it exists (e.g., requesting again)
        });
      }
  
      return {
        filePath,
        videoData: video_data,
        transcript
      };
  
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "API_ERROR", {
        operation: "request-transcript",
        videoUrl,
        languages: `${transcriptLanguage}->${outputLanguage}`
      });
      throw error; // Re-throw to be handled by the caller (e.g., modal)
    }
  }
  //TODO probably bad practice
  public getLastVideoData(){
    return this.lastProcesedVideoData;
  }
  private async generateTags(transcript: string, videoData: VideoData, options: VideoSummaryOptions): Promise<string[]> {
    try {
       // Get existing tags formatted for the prompt
       const existingTagsPrompt = this.tagManager.formatTagsForPrompt(150); // Include up to 50 existing tags

      if (!this.llmClientService) {
        throw new Error("LLM Client Service not initialized");
      }
      
      const llmClient = options.provider
        ? this.llmClientService.getClientForProvider(options.provider)
        : this.llmClientService.getClient();
      if (!llmClient) {
        throw new Error("LLM client not initialized. Please check your settings and API keys.");
      }

      const tagsOptions: TextGenerationOptions = {
        message: `${options.tagPrompt}
        
        Title: ${videoData.title}
        
        Transcript (snippet):
        ${transcript.substring(0, 4000)}...

        ${existingTagsPrompt}`, // Add existing tags to the prompt
        model: options.summaryModel, // Use the specified summary model for tag generation too
        language: "english", // Generate tags in English for consistency
        files: [],
        temperature: 0.7,
        maxTokens: 200
      };

      const tagsResult = await llmClient.generateText(tagsOptions);
      const rawTagsOutput = tagsResult.output || "";

      // Parse the comma-separated list from the LLM output
      const tagsList = rawTagsOutput.split(',')
        .map((tag: string) => tag.trim().toLowerCase())
        .filter((tag: string) => tag.length > 0);
      
      // Normalize and add newly generated tags to the TagManager's custom list
      this.tagManager.addCustomTags(tagsList);

      return tagsList; // Return the normalized list
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "API_ERROR", {
        operation: "generate-tags",
        title: videoData.title
      });
      return []; // Return empty array on error
    }
  }

   /**
    * Creates a summary for potentially long videos by chunking the transcript.
    * Also generates and saves tags.
    */
  async createLongVideoSummary(options: VideoSummaryOptions): Promise<string> {
    const startTime = Date.now();
    
    if (this.debugEnabled) {
      console.log('[TranscriptManager] Starting video summary creation', {
        videoUrl: options.videoUrl,
        summaryModel: options.summaryModel,
        provider: options.provider || 'default',
        enableChunking: options.enableChunking,
        saveToDatabase: options.saveToDatabase
      });
    }
    
    try {
      // 1. Request Transcript (this also saves the transcript file)
      // The transcript language should be the language of the video itself for accurate transcription.
      // The output language determines the translation.
      const { videoData, transcript } = await this.requestTranscript(
        options.videoUrl,
        options.videoLanguage, // Use videoLanguage for transcript request
        options.outputLanguage, // Use outputLanguage for translation if requested
        options.summaryFolder, // Summaries are saved alongside transcripts/summaries
        options.saveToDatabase || false // Pass database storage option
      );
      
      // Check if transcript is empty or too short to summarize meaningfully
      if (!transcript || transcript.trim().split(/\s+/).length < 50) { // Minimum 50 words?
           new Notice("Transcript is too short or empty, skipping summary.");
           // Optionally, save a minimal summary file indicating this or just return the transcript path
           return videoData.title + ": Transcript too short for summary."; // Or throw? Let's return a message.
      }

      // 2. Generate Tags based on the full transcript and video data
      const tags = await this.generateTags(transcript, videoData, options);
      
      if (this.debugEnabled) {
        console.log('[TranscriptManager] Tags generated', {
          tagCount: tags.length,
          tags: tags.join(', ')
        });
      }
          
      // 3. Chunk the transcript for summary generation (if enabled)
      // Using chunkTranscriptBySentences is generally better for maintaining context
      const enableChunking = options.enableChunking !== false; // Default to true for backward compatibility
      const chunks = enableChunking ? chunkTranscriptBySentences(transcript, 5500, 7000) : [transcript]; // Adjust chunk size based on model context window
      
      if (this.debugEnabled) {
        console.log('[TranscriptManager] Transcript chunking', {
          enableChunking,
          chunkCount: chunks.length,
          totalLength: transcript.length
        });
      }

      let finalSummary = "";
      const chunkSummaries: string[] = [];

      if (chunks.length > 1) {
        // Handle multiple chunks - Generate summary for each chunk first
        new Notice(`Generating summary in ${chunks.length} parts...`);
        // Get LLM client once before the loop
        if (!this.llmClientService) {
          throw new Error("LLM Client Service not initialized");
        }
        
        const llmClient = options.provider
          ? this.llmClientService.getClientForProvider(options.provider)
          : this.llmClientService.getClient();
        if (!llmClient) {
          throw new Error("LLM client not initialized. Please check your settings and API keys.");
        }
        
        for (let i = 0; i < chunks.length; i++) {
          // Construct chunk-specific prompt if needed, or reuse the main one
           const chunkPrompt = `${options.summaryPrompt} (This is part ${i+1} of ${chunks.length}. Focus on summarizing this segment.)`;
          
          const chunkOptions: TextGenerationOptions = {
            message: chunkPrompt + "\n\n" + chunks[i], // Include transcript chunk in message
            model: options.summaryModel,
            language: options.outputLanguage, // Request summary in output language
            files: [],
            temperature: 0.7,
            maxTokens: options.numberOfOutputTokens
          };
          
          const chunkResult = await llmClient.generateText(chunkOptions);
          const summary = chunkResult.output || `[Error summarizing chunk ${i+1}]`;
          chunkSummaries.push(summary);
           new Notice(`Summarized part ${i+1} of ${chunks.length}.`); // Progress update
        }
        
        // 4. Create Meta-summary from chunk summaries
        new Notice("Combining part summaries...");
        const metaSummaryPrompt = `Create a cohesive overall summary integrating these summaries from different parts of the same video. Do not just concatenate; synthesize them into a single, well-structured summary covering the entire video.

        ${chunkSummaries.map((summary, i) => `## Part ${i+1}\n${summary}`).join('\n\n')}
        
        Synthesize these parts into ONE comprehensive summary in ${options.outputLanguage}.`;

        const metaOptions: TextGenerationOptions = {
          message: metaSummaryPrompt,
          model: options.summaryModel, // Use the same model or a more capable one if needed
          language: options.outputLanguage,
          files: [],
          temperature: 0.7,
          maxTokens: options.numberOfOutputTokens
        };
        
        const metaResult = await llmClient.generateText(metaOptions);
        finalSummary = metaResult.output || "Failed to generate meta-summary.";
        
      } else {
        // Single chunk - Generate summary directly
        // Get LLM client for single chunk case
        if (!this.llmClientService) {
          throw new Error("LLM Client Service not initialized");
        }
        
        const llmClient = options.provider
          ? this.llmClientService.getClientForProvider(options.provider)
          : this.llmClientService.getClient();
        if (!llmClient) {
          throw new Error("LLM client not initialized. Please check your settings and API keys.");
        }
        
        new Notice("Generating summary...");
         // Apply {topic} replacement if it's a tutorial type
        const summaryPrompt = options.topic
          ? options.summaryPrompt.replace(/\{topic\}/g, options.topic)
          : options.summaryPrompt;

        const summaryOptions: TextGenerationOptions = {
          message: summaryPrompt + "\n\n" + transcript, // Include full transcript
          model: options.summaryModel,
          language: options.outputLanguage, // Request summary in output language
          files: [],
          temperature: 0.7,
          maxTokens: options.numberOfOutputTokens
        };

        const summaryResult = await llmClient.generateText(summaryOptions);
        finalSummary = summaryResult.output || "No summary output received.";
      }
      
      // 5. Save the Summary Markdown file
      const sanitizedTitle = sanitizeFilename(videoData.title);
      const sanitizedFileTitle = sanitizeFilename(videoData.title); // Use for filename
      const sanitizedChannel = sanitizeFilename(videoData.channel);

      // Folder structure: SummaryFolder/Author Name/Summary Title.md
      const folderPath = `${options.summaryFolder}/${sanitizedChannel}`;
      const fileName = `${sanitizedFileTitle}.md`;

      // Create metadata with generated tags
      const metadata = {
        title: sanitizeForMetadata(videoData.title), // Sanitize title for metadata
        url: options.videoUrl,
        author: videoData.channel,
        channel_id: videoData.channel_id,
        date_accessed: new Date().toISOString(),
        duration: videoData.duration,
        views: videoData.view_count,
        likes: videoData.like_count,
        upload_date: videoData.upload_date,
        tags: this.tagManager.formatTags(tags), // Format tags for metadata
        summary_model: options.summaryModel, // Record model used for summary
        summary_type: options.summaryType, // Record summary type
        video_language: options.videoLanguage,
        output_language: options.outputLanguage,
        parts_summarized: chunks.length // Add number of parts
      };

      // Format content for the file
      const content = this.formatSummaryContent(
        videoData, // Pass original video data
        finalSummary,
        transcript,
        tags, // Pass the generated tags
        chunkSummaries, // Pass chunk summaries if available
        this.settings // Pass settings to determine storage location
      );

      const filePath = await this.fileManager.saveFile({
        content,
        folder: folderPath,
        filename: fileName,
        metadata,
        overwrite: true // Overwrite existing summary file
      });

      // Save transcript, description, and detailed summaries to database based on settings
      if (this.databaseManager) {
        try {
          const shouldSaveTranscript = this.settings?.transcriptStorageLocation === 'database';
          const shouldSaveDescription = this.settings?.descriptionStorageLocation === 'database';
          const shouldSaveDetailedSummaries = this.settings?.detailedSummariesStorageLocation === 'database';
          
          // Only save to database if at least one setting is 'database'
          if (shouldSaveTranscript || shouldSaveDescription || shouldSaveDetailedSummaries) {
            await this.databaseManager.saveTranscript({
              note_title: videoData.title,
              note_path: filePath,
              transcript_content: shouldSaveTranscript ? transcript : undefined,
              description: shouldSaveDescription ? videoData.description : undefined,
              detailed_summaries: (shouldSaveDetailedSummaries && chunkSummaries.length > 1) ? chunkSummaries : undefined,
              video_url: options.videoUrl,
              video_title: videoData.title,
              video_channel: videoData.channel
            });
          }
          
          const savedParts = [
            shouldSaveTranscript ? 'transcript' : null,
            shouldSaveDescription ? 'description' : null,
            shouldSaveDetailedSummaries ? 'detailed summaries' : null
          ].filter(Boolean).join(', ');
          
          if (savedParts) {
            new Notice(`Summary created for "${videoData.title}" with ${tags.length} tags. ${savedParts.charAt(0).toUpperCase() + savedParts.slice(1)} saved to database.`);
          } else {
            new Notice(`Summary created for "${videoData.title}" with ${tags.length} tags.`);
          }
        } catch (error) {
          console.error("Failed to save content to database:", error);
          new Notice(`Summary created but failed to save content to database.`);
        }
      } else {
        new Notice(`Summary created for "${videoData.title}" with ${tags.length} tags.`);
      }

      // 6. Integrate into Path Structure
      try {
        await this.integrateIntoPathStructure(filePath, videoData, tags, options.videoUrl);
      } catch (error) {
        console.warn("Failed to integrate into path structure:", error);
        // Don't fail the whole process
      }

      return filePath; // Return path to the saved summary file

    } catch (error: unknown) {
      ErrorHandler.handleError(error, "API_ERROR", {
        operation: "create-video-summary",
        videoUrl: options.videoUrl
      });
      throw error; // Re-throw to be handled by the queue manager or caller
    }
  }

  private formatTranscriptContent(
    videoData: VideoData,
    transcript: string,
    metadata: TranscriptMetadata
  ): string {
    // Sanitize metadata values for YAML frontmatter
    const sanitizedMetadata = Object.entries(metadata).reduce((acc, [key, value]) => {
        acc[key] = typeof value === 'string' ? sanitizeForMetadata(value) : value;
        return acc;
    }, {} as any);

    return `---
${Object.entries(sanitizedMetadata)
  .map(([key, value]) => `${key}: ${value}`)
  .join('\n')}
---

# ${videoData.title}

## Description
${videoData.description}

## Transcript
${transcript}`;
  }

  private formatSummaryContent(
    videoData: VideoData,
    summary: string,
    transcript: string,
    tags: string[],
    chunkSummaries?: string[], // Optional chunk summaries
    settings: any = null // Settings object to determine storage location
  ): string {
     // Sanitize metadata values for YAML frontmatter (assuming metadata includes necessary fields from createLongVideoSummary)
     // Note: metadata is passed as an object in saveFile options, formatSummaryContent receives raw videoData
     // We should probably pass the generated metadata object here instead of rebuilding
     // For consistency with previous code, let's just use videoData and the generated tags/summaries
     // The metadata block in saveFile handles sanitization.

    // Determine storage locations from settings
    const transcriptInDatabase = settings?.transcriptStorageLocation === 'database';
    const descriptionInDatabase = settings?.descriptionStorageLocation === 'database';
    const detailedSummariesInDatabase = settings?.detailedSummariesStorageLocation === 'database';

    let content = `# ${videoData.title}\n\n`;

    // Add tags section
    if (tags && tags.length > 0) {
        content += "## Tags\n";
        content += tags.map(tag => `#${tag}`).join(' ') + "\n\n";
    }

    // Add summary section
    content += "## Summary\n";
    content += summary + "\n\n";

    // Add detailed part summaries if available and NOT in database
    if (chunkSummaries && chunkSummaries.length > 1) {
        if (detailedSummariesInDatabase) {
            content += "## Detailed Summaries by Part\n";
            content += "*Detailed summaries are stored in database. Click 'View Detailed Summaries' button to view.*\n\n";
        } else {
            content += "## Detailed Summaries by Part\n";
            chunkSummaries.forEach((partSummary, index) => {
                content += `<details>\n<summary>Part ${index+1}</summary>\n\n`;
                content += partSummary + "\n";
                content += `</details>\n\n`;
            });
            content += "\n"; // Add extra newline after all details blocks
        }
    }

    // Add Description (in collapsible) - only if NOT in database
    if (videoData.description && videoData.description.trim()) {
      if (descriptionInDatabase) {
        content += "## Description\n";
        content += "*Description is stored in database. Click 'View Description' button to view.*\n\n";
      } else {
        content += "## Description\n";
        content += "<details>\n<summary>Click to expand</summary>\n\n";
        content += videoData.description + "\n";
        content += "</details>\n\n";
      }
    }

    // Add transcript to content if NOT in database
    if (transcriptInDatabase) {
      // Add note about transcript being in database
      content += "## Transcript\n";
      content += "*Transcript is stored in database. Click 'View Transcript' button to view.*\n\n";
    } else {
      // Add Full Transcript (in collapsible)
      content += "## Full Transcript\n";
      content += "<details>\n<summary>Click to expand</summary>\n\n";
      content += transcript + "\n";
      content += "</details>\n\n"; // Add extra newline after transcript details
    }

    return content;
  }

  private async generateTagsForLocalTranscript(transcript: string, title: string, options: LocalTranscriptInput): Promise<string[]> {
    try {
       const existingTagsPrompt = this.tagManager.formatTagsForPrompt(150);

      if (!this.llmClientService) {
        throw new Error("LLM Client Service not initialized");
      }
      
      const llmClient = options.provider
        ? this.llmClientService.getClientForProvider(options.provider)
        : this.llmClientService.getClient();
      if (!llmClient) {
        throw new Error("LLM client not initialized. Please check your settings and API keys.");
      }

      const tagsOptions: TextGenerationOptions = {
        message: `${options.tagPrompt}
        
        Title: ${title}
        
        Transcript (snippet):
        ${transcript.substring(0, 4000)}...

        ${existingTagsPrompt}`,
        model: options.summaryModel,
        language: "english", // Generate tags in English for consistency
        files: [],
        temperature: 0.7,
        maxTokens: 200
      };

      const tagsResult = await llmClient.generateText(tagsOptions);
      const rawTagsOutput = tagsResult.output || "";

      const tagsList = rawTagsOutput.split(',')
        .map((tag: string) => tag.trim().toLowerCase())
        .filter((tag: string) => tag.length > 0);
      
      this.tagManager.addCustomTags(tagsList);

      return tagsList;
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "API_ERROR", {
        operation: "generate-tags-for-local-transcript",
        title: title
      });
      return [];
    }
  }

  private formatLocalTranscriptContent(
    title: string,
    summary: string, // New: Summary content
    transcript: string,
    tags: string[], // New: Tags
    chunkSummaries?: string[] // New: Optional chunk summaries
  ): string {
    let content = `# ${title}\n\n`;

    // Add tags section
    if (tags && tags.length > 0) {
        content += "## Tags\n";
        content += tags.map(tag => `#${tag}`).join(' ') + "\n\n";
    }

    // Add summary section
    content += "## Summary\n";
    content += summary + "\n\n";

    // Add detailed part summaries if available
    if (chunkSummaries && chunkSummaries.length > 1) {
        content += "## Detailed Summaries by Part\n";
        chunkSummaries.forEach((partSummary, index) => {
            content += `<details>\n<summary>Part ${index+1}</summary>\n\n`;
            content += partSummary + "\n";
            content += `</details>\n\n`;
        });
        content += "\n";
    }

    // Add Full Transcript (in collapsible)
    content += "## Full Transcript\n";
    content += "<details>\n<summary>Click to expand</summary>\n\n";
    content += transcript + "\n";
    content += "</details>\n\n";

    return content;
  }

  async getTranscriptFile(filePath: string): Promise<TFile | null> {
    try {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        return file;
      }
      return null;
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "FILE_OPERATION", {
        operation: "get-transcript-file",
        path: filePath
      });
      return null;
    }
  }

  async openTranscript(filePath: string): Promise<void> {
    try {
      const file = await this.getTranscriptFile(filePath);
      if (file) {
        await this.app.workspace.getLeaf(false).openFile(file);
      } else {
        throw new Error("Transcript file not found");
      }
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "FILE_OPERATION", {
        operation: "open-transcript",
        path: filePath
      });
      throw error;
    }
  }

  private async integrateIntoPathStructure(filePath: string, videoData: VideoData, tags: string[], videoUrl: string): Promise<void> {
    try {
      // Create default domain "Videos" if not exists
      let domain = this.pathManager.findDomainByName("Videos");
      if (!domain) {
        domain = await this.pathManager.addDomain({ name: "Videos", description: "Video content summaries and transcripts" });
      }

      // Create subject "YouTube" if not exists
      const subjectId = this.pathManager.generateId("YouTube");
      let subject = this.pathManager.findSubjectById(domain, subjectId);
      if (!subject) {
        subject = await this.pathManager.addSubject({ domainId: domain.id, name: "YouTube", description: "YouTube video summaries" });
      }

      // Create topic "Summaries" if not exists
      const topicId = this.pathManager.generateId("Summaries");
      let topic = this.pathManager.findTopicById(subject, topicId);
      if (!topic) {
        topic = await this.pathManager.addTopic({ domainId: domain.id, subjectId: subject.id, name: "Summaries", description: "Video summaries" });
      }

      // Detect series
      const seriesInfo = this.pathManager.detectSeries(videoData.title);
      const seriesName = seriesInfo.series || "Standalone";
      const seriesId = this.pathManager.generateId(seriesName);
      let series = this.pathManager.findSeriesById(topic, seriesId);
      if (!series) {
        series = await this.pathManager.addSeries({
          domainId: domain.id,
          subjectId: subject.id,
          topicId: topic.id,
          name: seriesName,
          description: seriesInfo.series ? "Video series" : "Individual videos"
        });
      }

      // Create author based on channel
      const authorId = this.pathManager.generateId(videoData.channel);
      let author = this.pathManager.findAuthorById(series, authorId);
      if (!author) {
        author = await this.pathManager.addAuthor({
          domainId: domain.id,
          subjectId: subject.id,
          topicId: topic.id,
          seriesId: series.id,
          name: videoData.channel,
          description: `Content from ${videoData.channel}`
        });
      }

      // Add content
      const contentMetadata: ContentMetadata = {
        domain: domain.id,
        subject: subject.id,
        topic: topic.id,
        series: series.id,
        author: author.id,
        title: videoData.title,
        filePath: filePath,
        videoUrl: videoUrl,
        position: seriesInfo.position,
        totalParts: seriesInfo.totalParts
      };

      await this.pathManager.addContent(contentMetadata);
    } catch (error) {
      console.error("Error integrating into path structure:", error);
      throw error;
    }
  }
}

export {TranscriptManager}
