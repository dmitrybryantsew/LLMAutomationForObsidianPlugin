import { App, Notice } from "obsidian";
import type GptFreeTextGeneratorPlugin from '../main';
import { PathManager } from "./pathStructure/PathManager";
import { ContentMetadata } from "./pathStructure/types";
import { pathStructurePromptHelper } from "./summaryPrompts";
import { TranscriptManager } from "./TranscriptManager";
import { LLMClientService } from "./LLMClientService";
import { TextGenerationOptions } from "../types/openrouter";

interface HierarchyResponse {
  domain: string;
  subject: string;
  topic: string;
  series: string | null;
  author: string;
}

export class HierarchyManager {
  private plugin: GptFreeTextGeneratorPlugin;
  private pathManager: PathManager;
  private transcriptManager: TranscriptManager;
  private llmClientService: LLMClientService | null = null;

  constructor(plugin: GptFreeTextGeneratorPlugin, pathManager: PathManager, transcriptManager: TranscriptManager, llmClientService: LLMClientService | null = null) {
    this.plugin = plugin;
    this.pathManager = pathManager;
    this.transcriptManager = transcriptManager;
    this.llmClientService = llmClientService;
  }

  public async determineAndApplyHierarchy(filePath: string, videoUrl: string, model: string): Promise<void> {
    if (!filePath) {
      throw new Error("File path is missing for hierarchy determination.");
    }

    try {
      const fileContent = await this.plugin.app.vault.adapter.read(filePath);
      const extractedData = this.extractDataFromSummaryFile(fileContent);
      const llmPrompt = this.constructHierarchyPrompt(extractedData);
      const llmResponse = await this.callLlmForHierarchy(llmPrompt, model);
      const hierarchyNames = this.parseHierarchyResponse(llmResponse, videoUrl); // Pass videoUrl

      if (!this.pathManager) {
        throw new Error("PathManager is not initialized");
      }

      let domainId = this.pathManager.generateId(hierarchyNames.domain);
      let domain = this.pathManager.findDomainById(domainId);
      if (!domain) {
        domain = await this.pathManager.addDomain({ name: hierarchyNames.domain });
        domainId = domain.id;
        new Notice(`Created new domain: ${hierarchyNames.domain}`);
      }

      let subjectId = this.pathManager.generateId(hierarchyNames.subject);
      let subject = this.pathManager.findSubjectById(domain, subjectId);
      if (!subject) {
        subject = await this.pathManager.addSubject({ domainId: domainId, name: hierarchyNames.subject });
        subjectId = subject.id;
        new Notice(`Created new subject: ${hierarchyNames.subject} in domain ${domain.name}`);
      }

      let topicId = this.pathManager.generateId(hierarchyNames.topic);
      let topic = this.pathManager.findTopicById(subject, topicId);
      if (!topic) {
        topic = await this.pathManager.addTopic({ domainId: domainId, subjectId: subjectId, name: hierarchyNames.topic });
        topicId = topic.id;
        new Notice(`Created new topic: ${hierarchyNames.topic} in subject ${subject.name}`);
      }

      const seriesName = hierarchyNames.series || "Standalone";
      let seriesId = this.pathManager.generateId(seriesName);
      let series = this.pathManager.findSeriesById(topic, seriesId);
      if (!series) {
        series = await this.pathManager.addSeries({ domainId: domainId, subjectId: subjectId, topicId: topicId, name: seriesName });
        seriesId = series.id;
        if (seriesName !== "Standalone") {
          new Notice(`Created new series: ${seriesName} in topic ${topic.name}`);
        }
      }

      let authorId = this.pathManager.generateId(hierarchyNames.author);
      let author = this.pathManager.findAuthorById(series, authorId);
      if (!author) {
        author = await this.pathManager.addAuthor({ domainId: domainId, subjectId: subjectId, topicId: topicId, seriesId: seriesId, name: hierarchyNames.author });
        authorId = author.id;
        new Notice(`Created new author: ${hierarchyNames.author} in series ${series.name}`);
      }

      const contentMetadata: ContentMetadata = {
        filePath: filePath,
        title: extractedData.title || "Untitled Video",
        subtitle: extractedData.subtitle,
        position: extractedData.position,
        totalParts: extractedData.totalParts,
        videoUrl: videoUrl,
        domain: domainId,
        subject: subjectId,
        topic: topicId,
        series: seriesId,
        author: authorId
      };

      await this.pathManager.addContent(contentMetadata);
      console.log(`Successfully linked content ${filePath} to hierarchy.`);

    } catch (error) {
      console.error("Error determining hierarchy or linking content for video:", videoUrl, error);
      throw error;
    }
  }

  private extractDataFromSummaryFile(fileContent: string): any {
    console.log("Extracting data from summary file content...");
    const extracted: any = {
      title: undefined,
      description: undefined,
      transcript: undefined,
      summary: undefined,
      tags: [],
      subtitle: undefined,
      position: undefined,
      totalParts: undefined,
      videoUrl: undefined,
      author: undefined
    };

    const lines = fileContent.split('\n');
    let inFrontmatter = false;
    let frontmatterContent = '';
    let currentSection = "";
    let sectionContent = '';

    for (const line of lines) {
      if (line.trim() === '---') {
        if (inFrontmatter) {
          inFrontmatter = false;
          const fmLines = frontmatterContent.trim().split('\n');
          for (const fmLine of fmLines) {
            const parts = fmLine.split(': ');
            if (parts.length >= 2) {
              const key = parts[0].trim();
              const value = parts.slice(1).join(': ').trim();
              if (key === 'title') extracted.title = value;
              else if (key === 'url') extracted.videoUrl = value;
              else if (key === 'author') extracted.author = value;
              else if (key === 'tags') extracted.tags = value.replace(/[\[\]']/g, '').split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
            }
          }
        } else {
          inFrontmatter = true;
        }
        continue;
      }

      if (inFrontmatter) {
        frontmatterContent += line + '\n';
        continue;
      }

      const sectionMatch = line.match(/^##\s+(.+)/);
      if (sectionMatch) {
        if (currentSection && sectionContent) {
          if (currentSection === 'Summary') extracted.summary = sectionContent.trim();
          else if (currentSection === 'Description') extracted.description = sectionContent.trim();
          else if (currentSection === 'Full Transcript') extracted.transcript = sectionContent.trim();
        }
        currentSection = sectionMatch[1].trim();
        sectionContent = '';
        continue;
      }

      if (currentSection) {
        sectionContent += line + '\n';
      }
    }

    if (currentSection && sectionContent) {
      if (currentSection === 'Summary') extracted.summary = sectionContent.trim();
      else if (currentSection === 'Description') extracted.description = sectionContent.trim();
      else if (currentSection === 'Full Transcript') extracted.transcript = sectionContent.trim();
    }

    const cleanSectionContent = (content: string | undefined): string | undefined => {
        if (!content) return undefined;
        let cleaned = content.replace(/<details>\s*<summary>.*?<\/summary>\s*/gs, '');
        cleaned = cleaned.replace(/<\/details>/g, '');
        return cleaned.trim();
    };

    extracted.description = cleanSectionContent(extracted.description);
    extracted.transcript = cleanSectionContent(extracted.transcript);

    console.log("Extracted Data:", extracted);
    return extracted;
  }

  private constructHierarchyPrompt(data: any): string {
    console.log("Constructing LLM prompt for hierarchy...");
    
    const existingStructureSummary = this.pathManager?.generateStructureSummary() || "No existing hierarchy structure available.";
   
    let prompt = `Analyze the following video content and determine the best hierarchy path (domain, subject, topic, series) in JSON format.
    Provide the *names* of the hierarchy levels. (domain, subject, topic, series) must never be empty (\"\") or null 
    If there is no good candidates that fit  in existing hierarchy i strongly encourage to add your own. to be extra safe multiple words concatinated with underscore in snake_case.
    
    Existing Hierarchy Structure Summary:
    ${existingStructureSummary}
    ---\n\n
    `;
    prompt += pathStructurePromptHelper;

    prompt+=`\n\n---
    
    Video Title: ${data.title}
    Summary: ${data.summary}
    Tags: ${data.tags.join(', ')}
    Author: ${data.author || 'Unknown Author'}
    
    Output JSON like: {"domain": "Domain Name", "subject": "Subject Name", "topic": "Topic Name", "series": "Series Name or null", "author": "Author Name"}.`;

    if (data.transcript && data.transcript.length > 100) {
        prompt += `\n\nTranscript Snippet:\n${data.transcript.substring(0, 1000)}...`;
    }
    prompt += "\nVERY IMPORTANT: your responce MUST BE VALID JSON AND NOTHING ELSE no replys or comments to this prompt and no md block like ```json\n{your json}``` as it will break script too so it strictly: {your json}! and no other way ";
    prompt += "\nalso i repeat: (domain, subject, topic, series) must never be empty (\"\") or null ";
    return prompt;
  }

  private async callLlmForHierarchy(prompt: string, model: string): Promise<string> {
    console.log("Calling LLM for hierarchy with prompt:", prompt);
    try {
      if (!this.llmClientService) {
        throw new Error("LLM Client Service not initialized");
      }
      
      const llmClient = this.llmClientService.getClient();
      if (!llmClient) {
        throw new Error("LLM client not initialized. Please check your settings and API keys.");
      }

      const hierarchyOptions: TextGenerationOptions = {
        message: prompt,
        model: model,
        language: "en",
        files: [],
        temperature: 0.7,
        maxTokens: 500
      };

      const result = await llmClient.generateText(hierarchyOptions);
      if (typeof result.output !== 'string') {
          throw new Error("Invalid response format from LLM API: 'output' field missing or not a string.");
      }
      return result.output;
    } catch (error) {
        console.error("Error calling LLM for hierarchy:", error);
        throw error;
    }
  }

  private parseHierarchyResponse(response: string, videoUrl: string): HierarchyResponse { // Add videoUrl parameter
    console.log("Parsing LLM hierarchy response:", response);
    try {
      const parsed = JSON.parse(response);
      
      if (typeof parsed !== 'object' || parsed === null) {
          throw new Error("LLM response is not a valid JSON object.");
      }

      if (typeof parsed.domain !== 'string' || parsed.domain.length === 0) {
          throw new Error("LLM response missing or invalid 'domain' field (expected non-empty string).");
      }
      if (typeof parsed.subject !== 'string' || parsed.subject.length === 0) {
          throw new Error("LLM response missing or invalid 'subject' field (expected non-empty string).");
      }
      if (typeof parsed.topic !== 'string' || parsed.topic.length === 0) {
          throw new Error("LLM response missing or invalid 'topic' field (expected non-empty string).");
      }
      if (typeof parsed.series !== 'string' && parsed.series !== null) {
           throw new Error("LLM response has invalid 'series' field type (must be string or null).");
      }

      // Conditional author assignment based on videoUrl
      if (videoUrl.startsWith('file://')) {
          // For local files, trust the LLM's response for author (which was prompted with extractedData.author)
          if (typeof parsed.author !== 'string' || parsed.author.length === 0) {
              throw new Error("LLM response missing or invalid 'author' field for local file.");
          }
      } else {
          // For video URLs, use the channel from last processed video data
          if (!this.transcriptManager) {
              throw new Error("TranscriptManager is not initialized when parsing hierarchy response.");
          }
          const videoChannel = this.transcriptManager.getLastVideoData()?.channel;
          if (typeof videoChannel !== 'string' || videoChannel.length === 0) {
              throw new Error("Video channel data missing for hierarchy author.");
          }
          parsed["author"] = videoChannel; // Override with video channel
      }

      return parsed as HierarchyResponse;

    } catch (error) {
      console.error("Failed to parse LLM hierarchy response:", response, error);
      throw new Error(`Failed to parse LLM hierarchy response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
