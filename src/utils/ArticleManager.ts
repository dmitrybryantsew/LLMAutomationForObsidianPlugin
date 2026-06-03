import { App, TFile, Notice } from "obsidian";
import { FileManager } from "./FileManager"; // Import FileManager
import { ErrorHandler } from "./ErrorHandler";
import { sanitizeFilename, sanitizeForMetadata } from "../utils/helpers"; // Import helpers
import { TagManager } from "./TagManager"; // Import TagManager
import { LLMClientService } from "./LLMClientService";
import { TextGenerationOptions, OpenRouterError } from "../types/openrouter";

type TextProviderId = 'openrouter' | 'chutes' | 'zai' | 'ollama';

interface ArticleData {
  title: string;
  author?: string;
  date_published?: string;
  content: string;
  url: string;
  site_name?: string;
  image_url?: string;
}

interface ArticleMetadata {
  title: string;
  author?: string;
  date_published?: string;
  date_saved: string;
  url: string;
  site_name?: string;
  word_count: number;
  tags?: string[]; // Stored as array in metadata, formatted to string for file
}

interface ArticleSummaryOptions {
  articleUrl: string;
  summaryModel: string;
  outputLanguage: string;
  articlesFolder: string;
  provider?: TextProviderId; // Optional provider override
}

// Assuming backend returns similar structure for generate-text
interface GenerationResponse {
    output: string;
    metadata: { // Provider metadata
        provider_name: string;
        provider_url: string;
        actual_model: string;
        request_time: string;
        completion_time: string;
        elapsed_time: string;
    };
}


class ArticleManager {
  private app: App;
  private fileManager: FileManager; // Use injected FileManager
  private tagManager: TagManager; // Use injected TagManager
  private llmClientService: LLMClientService | null = null; // LLM Client Service

  constructor(app: App, fileManager: FileManager, tagManager: TagManager, llmClientService: LLMClientService | null = null) {
    this.app = app;
    this.fileManager = fileManager; // Store injected instance
    this.tagManager = tagManager; // Store injected instance
    this.llmClientService = llmClientService;
  }

  async fetchAndSummarizeArticle(options: ArticleSummaryOptions): Promise<string> {
    try {
      // 1. Fetch the article content
      const articleData = await this.fetchArticle(options.articleUrl);
      
      // Check if content is empty or too short
      if (!articleData.content || articleData.content.trim().split(/\s+/).length < 100) { // Min 100 words?
          new Notice("Article content is too short or could not be fetched.");
          // Optionally save a stub file or throw
          throw new Error("Article content too short or missing.");
      }

      // 2. Generate tags
      const tags = await this.generateTags(articleData, options.provider);
      
      // 3. Generate a summary
      const summary = await this.generateSummary(
        articleData.content,
        options.summaryModel,
        options.outputLanguage,
        options.provider
      );
      
      // 4. Save the article and summary
      const filePath = await this.saveArticle(
        articleData,
        summary,
        tags,
        options.articlesFolder
      );
      
      return filePath; // Return path to the saved article file
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "ARTICLE_PROCESSING_ERROR", {
        operation: "fetch-and-summarize-article",
        url: options.articleUrl,
        details: error instanceof Error ? error.message : String(error)
      });
      throw error; // Re-throw to be handled by the modal or caller
    }
  }

  private async fetchArticle(url: string): Promise<ArticleData> {
    try {
      const response = await fetch("http://127.0.0.1:8001/fetch-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        // Attempt to parse error body if available
         const errorBody = await response.text().catch(() => "No error body available");
         console.error(`Fetch article failed: Status ${response.status}, Body: ${errorBody}`);
        throw new Error(`HTTP error fetching article! Status: ${response.status}. Body: ${errorBody}`);
      }

      const data: ArticleData = await response.json();
      if (!data || !data.content) {
          // Handle cases where the API succeeds but returns no content
          throw new Error("API returned successful status but no article content.");
      }
      return data;
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "API_FETCH_ERROR", {
        operation: "fetch-article",
        url,
        details: error instanceof Error ? error.message : String(error)
      });
      throw error; // Re-throw to be handled by calling method
    }
  }

  private async generateSummary(
    content: string,
    model: string,
    outputLanguage: string,
    provider?: TextProviderId
  ): Promise<string> {
    try {
        // Limit content sent to LLM to avoid token limits, especially for summaries
        const contentSnippet = content.substring(0, 8000); // Adjust based on model context window
  
      if (!this.llmClientService) {
        throw new Error("LLM Client Service not initialized");
      }
      
      const llmClient = provider
        ? this.llmClientService.getClientForProvider(provider)
        : this.llmClientService.getClient();
      if (!llmClient) {
        throw new Error("LLM client not initialized. Please check your settings and API keys.");
      }

      const summaryOptions: TextGenerationOptions = {
        message: `Summarize the following article content. Provide a comprehensive summary, covering all important points and key details.
        
        Content:
        ${contentSnippet}${content.length > 8000 ? '...' : ''}
        
        Provide the summary in ${outputLanguage}.`,
        model: model,
        language: outputLanguage,
        files: [],
        temperature: 0.7,
        maxTokens: 2000
      };

      const summaryResult = await llmClient.generateText(summaryOptions);
      return summaryResult.output || "No summary output received.";
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "API_GENERATE_ERROR", {
        operation: "generate-article-summary",
        model: model,
        details: error instanceof Error ? error.message : String(error)
      });
      throw error; // Re-throw
    }
  }

  private async generateTags(articleData: ArticleData, provider?: TextProviderId): Promise<string[]> {
    try {
       // Get existing tags formatted for the prompt
       const existingTagsPrompt = this.tagManager.formatTagsForPrompt(30); // Include a sample of existing tags
  
        // Limit content sent for tags, too
       const contentSnippet = articleData.content.substring(0, 2000);
  
      if (!this.llmClientService) {
        throw new Error("LLM Client Service not initialized");
      }
      
      const llmClient = provider
        ? this.llmClientService.getClientForProvider(provider)
        : this.llmClientService.getClient();
      if (!llmClient) {
        throw new Error("LLM client not initialized. Please check your settings and API keys.");
      }

      const tagsOptions: TextGenerationOptions = {
        message: `Based on this article content and title, generate relevant tags.
                 Consider main topics, technologies, concepts, and categories.
                 ${existingTagsPrompt}
                 Output ONLY a comma-separated list of tags, nothing else.
                 
                 Title: ${articleData.title}
                 
                 Content (snippet):
                 ${contentSnippet}${articleData.content.length > 2000 ? '...' : ''}`,
        model: "openrouter/deepseek/deepseek-chat:free", // Using a specific model for tags might be good
        language: "english", // Always generate tags in English for consistency
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
      ErrorHandler.handleError(error, "API_GENERATE_ERROR", {
        operation: "generate-article-tags",
        title: articleData.title,
        details: error instanceof Error ? error.message : String(error)
      });
      return []; // Return empty array on error
    }
  }

  private async saveArticle(
    articleData: ArticleData,
    summary: string,
    tags: string[], // Receive parsed tags
    folder: string
  ): Promise<string> {
    const date = new Date().toISOString().slice(0, 10);
    const sanitizedTitle = sanitizeFilename(articleData.title);
    // Use hostname for site name path component
    const siteName = articleData.site_name || (new URL(articleData.url)).hostname;
    const sanitizedSiteName = sanitizeFilename(siteName);
    
    const folderPath = `${folder}/${date}/${sanitizedSiteName}`;
    const fileName = `${sanitizedTitle}.md`;
    
    const wordCount = articleData.content.split(/\s+/).length;
    
    // Metadata for the file frontmatter
    const metadata: ArticleMetadata = {
      title: articleData.title, // Original title in metadata
      author: articleData.author,
      date_published: articleData.date_published,
      date_saved: new Date().toISOString(),
      url: articleData.url,
      site_name: siteName,
      word_count: wordCount,
      tags: tags // Store array in metadata object
    };
    
    // Content for the file body
    const content = this.formatArticleContent(articleData, summary, tags);
    
    const filePath = await this.fileManager.saveFile({
      content,
      folder: folderPath,
      filename: fileName,
      metadata, // Pass metadata object to FileManager
      overwrite: true // Overwrite if an article from the same URL/title/date is saved again
    });
    
    new Notice(`Article saved: ${articleData.title}`);
    return filePath;
  }

  private formatArticleContent(
    articleData: ArticleData,
    summary: string,
    tags: string[] // Receive parsed tags
  ): string {
    let content = `# ${articleData.title}\n\n`;
    
    // Add metadata section (formatted for display, not frontmatter)
    content += "## Metadata\n";
    if (articleData.author) content += `- Author: ${articleData.author}\n`;
    if (articleData.date_published) content += `- Published: ${articleData.date_published}\n`;
    content += `- Source: [${articleData.site_name || "Source"}](${articleData.url})\n\n`;
    
    // Add tags section
    if (tags && tags.length > 0) {
        content += "## Tags\n";
        // Format tags with '#' prefix for display in file
        content += tags.map(tag => `#${tag}`).join(' ') + "\n\n";
    }

    // Add summary section
    content += "## Summary\n";
    content += summary + "\n\n";
    
    // Add full content in collapsible section
    content += "## Full Article\n";
    content += "<details>\n<summary>Click to expand</summary>\n\n";
    content += articleData.content + "\n";
    content += "</details>\n\n"; // Add newline after details block
    
    return content;
  }

  async openArticle(filePath: string): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(file);
      } else {
        throw new Error("Article file not found");
      }
    } catch (error: unknown) {
      ErrorHandler.handleError(error, "FILE_OPERATION", {
        operation: "open-article",
        path: filePath
      });
      throw error;
    }
  }
}

export { ArticleManager };
