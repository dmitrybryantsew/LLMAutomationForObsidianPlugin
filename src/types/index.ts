export * from '../utils/TagManager';
export * from '../utils/FileManager';
export * from '../utils/ErrorHandler';
export * from '../utils/TranscriptManager';
import { SummaryType } from '../utils/summaryPrompts'; // Import SummaryType
import { SpacedRepetitionSettings } from './spacedRepetition';
import { StudySourceGroup } from './studySources';

/**
 * PluginSettings Interface
 *
 * This interface defines all settings stored in data.json (Obsidian's automatic settings file).
 *
 * IMPORTANT: data.json is NOT a manually managed file!
 * - It is automatically managed by Obsidian's Plugin API
 * - Located in: .obsidian/plugins/gpt4free-text-generator-plugin/data.json
 * - Contains ALL plugin settings and cached data
 * - Automatically loaded via plugin.loadData() and saved via plugin.saveData()
 *
 * The file structure includes:
 * 1. User Preferences: folders, models, API keys, language settings
 * 2. Cached OpenRouter Models: openRouterModels array (fetched from OpenRouter API)
 * 3. Metadata: lastUpdated timestamps, filter settings
 *
 * WARNING: This file is COMPLETELY OVERWRITTEN on every saveSettings() call.
 * Any changes to data.json outside the plugin will be lost when settings are saved.
 */
export interface PluginSettings {
    // Model and generation settings
    defaultTextModel: string;
    defaultImageModel: string;
    defaultLanguage: string;
    defaultTextType: string;
    
    // Folder paths for storing different types of content
    historyFolder: string;
    articlesFolder: string;
    imageFolder: string;
    transcriptFolder: string;
    summaryFolder: string;
    quizFolder: string; // Folder for storing generated quizzes
    flashcardFolder: string; // Folder for storing generated flashcards
    flashcardGenerationProvider: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
    flashcardGenerationModel: string;
    flashcardGenerationTemperature: number;
    flashcardGenerationMaxTokens: number;
    codingExercisesFolder: string; // Folder for storing generated coding exercises
    
    // Summary generation settings
    summaryModel: string;
    summaryPrompt: string;
    summaryType: SummaryType; // Added
    numberOfOutputTokens: number; // Added
    
    // Language settings
    defaultTranscriptLanguage: string;
    defaultOutputLanguage: string;
    
    // Model availability (legacy, may not be actively used)
    availableModels: Record<string, string>; // Added
    
    // OpenRouter API settings and cached models
    openRouterModels: OpenRouterModel[];  // Cached list of models from OpenRouter API
    lastUpdated: string;                   // Timestamp of last model fetch
    openRouterApiKey: string;              // API key for OpenRouter
    filterFreeModelsOnly: boolean;        // Whether to show only free models
    minContextLength: number;             // Minimum context length filter
    
    // Backend selection
    defaultBackend: 'g4f' | 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy'; // Added for backend selection
    
    // Content storage location settings
    transcriptStorageLocation: 'database' | 'note'; // Where to store transcripts
    descriptionStorageLocation: 'database' | 'note'; // Where to store descriptions
    detailedSummariesStorageLocation: 'database' | 'note'; // Where to store detailed summaries
    
    // Multi-provider settings
    defaultLLMProvider: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy'; // Default LLM provider
    chutesApiKey: string; // API key for Chutes provider
    zaiApiKey: string; // API key for ZAI provider
    proxyApiKey: string; // API key for OpenAI-compatible proxy
    providerTimeout: number; // Request timeout in milliseconds
    providerRetryCount: number; // Number of retry attempts for failed requests
    defaultTemperature: number; // Shared default text temperature
    defaultMaxTokens: number; // Shared default max output tokens
    defaultTopP: number; // Shared default nucleus sampling value
    defaultPresencePenalty: number; // Shared default presence penalty
    defaultFrequencyPenalty: number; // Shared default frequency penalty
    
    // Provider endpoint configuration
    openRouterBaseUrl?: string; // Custom OpenRouter endpoint
    chutesBaseUrl?: string; // Custom Chutes endpoint
    zaiBaseUrl?: string; // Custom ZAI endpoint
    ollamaBaseUrl: string; // Ollama local/server endpoint
    proxyBaseUrl: string; // OpenAI-compatible proxy endpoint
    /** Base URL of the optional local/remote helper server used for article scraping and YouTube transcript fetching (e.g. http://127.0.0.1:8001 or http://your-remote-machine:8001). */
    helperServerUrl: string;
    ollamaTimeout: number; // Ollama request timeout in milliseconds
    
    // Provider-specific model lists
    chutesModels?: string[]; // List of available Chutes models
    zaiModels?: string[]; // List of available ZAI models
    ollamaModels?: string[]; // List of available Ollama models
    proxyModels?: string[]; // List of available proxy models
    
    // Provider-specific summary models (NEW)
    openrouterSummaryModel: string; // Default summary model for OpenRouter
    openrouterTagModel: string; // Default tag model for OpenRouter video/local transcript tagging
    chutesSummaryModel: string; // Default summary model for Chutes
    zaiSummaryModel: string; // Default summary model for ZAI
    ollamaSummaryModel: string; // Default summary model for Ollama
    proxySummaryModel: string; // Default summary model for OpenAI-compatible proxy
    
    // Provider-specific text models (NEW)
    openrouterTextModel: string; // Default text model for OpenRouter
    chutesTextModel: string; // Default text model for Chutes
    zaiTextModel: string; // Default text model for ZAI
    ollamaTextModel: string; // Default text model for Ollama
    proxyTextModel: string; // Default text model for OpenAI-compatible proxy
    
    // Debug settings
    debugMode: boolean; // Enable debug logging for troubleshooting

    // Spaced repetition settings
    spacedRepetition: SpacedRepetitionSettings;

    // Local coding exercise runner settings
    allowLocalCodeExecution: boolean;
    linqPadLprunPath: string;
    exerciseRunTimeoutMs: number;
    codingExerciseProvider: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
    codingExerciseModel: string;
    codingExerciseTemperature: number;
    codingExerciseMaxTokens: number;
    studyAssistantRootPath: string;

    // Study path/canvas source library
    studySourceGroups: StudySourceGroup[];
    studySourceInventoryNotePath: string;
    studyPathProvider: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
    studyPathModel: string;
    studyPathTemperature: number;
    studyPathMaxTokens: number;
    studyPathContextMaxTokens: number;
    studyPathMarkdownPath: string;
    studyPathCanvasPath: string;

    // Spaced repetition question generation provider
    spacedRepetitionGenerationProvider: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
    spacedRepetitionGenerationModel: string;

    // Note chat provider
    noteChatProvider: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
    noteChatModel: string;
  }
  
  /**
   * OpenRouterModel Interface
   *
   * Represents a model available from the OpenRouter API.
   * These models are fetched and cached in data.json via the openRouterModels array.
   *
   * The cached models list is updated when user clicks "Refresh Models" in settings.
   * This is a convenience cache to avoid API calls on every settings page load.
   *
   * Note: Only essential fields are cached. Full model details are fetched from API when needed.
   */
  export interface OpenRouterModel {
    id: string;
    name: string;
    context_length: number;
    pricing: {
      prompt: string;
      completion: string;
    };
  }
  
  export interface SummaryRequest {
    video_url: string;
    model: string;
    prompt: string;
  }
