const VIEW_TYPE_GENERATE_TEXT = "gpt4free-text-panel";
const VIEW_TYPE_GENERATE_IMAGE = "gpt4free-image-panel";
const HIERARCHY_PLUGIN_ID = "obsidian-gpt4free-hierarchy-plugin";
const DEFAULT_SETTINGS = {
  defaultTextModel: "gpt-4o",
  defaultImageModel: "flux",
  defaultLanguage: "english",
  defaultTranscriptLanguage: "en",
  defaultOutputLanguage: "en",
  defaultTextType: "transcript",
  articlesFolder: "Articles",
  historyFolder: "GeneratedText",
  imageFolder: "GeneratedImages",
  transcriptFolder: "Transcripts",
  summaryFolder: "VideoSummaries",
  quizFolder: "Quizzes", // Folder for storing generated quizzes
  flashcardFolder: "Flashcards", // Folder for storing generated flashcards
  // Legacy summaryModel for backward compatibility (deprecated - use provider-specific models)
  summaryModel: "openrouter/deepseek/deepseek-r1:free",
  summaryPrompt: "Please analyze this video transcript and provide a comprehensive summary. Format your response with tags first, like this: 'tags: tag1, tag2, tag3;' if tag contained few words in it use _ (word_wordn) followed by the actual summary. Consider the main topics, key points, and important takeaways.",
  openRouterApiKey: "",
  openRouterModels: [],
  lastUpdated: "",
  filterFreeModelsOnly: false,
  minContextLength: 0,
  defaultBackend: 'openrouter', // Default to OpenRouter
  // Content storage location settings (default: database)
  transcriptStorageLocation: 'database', // 'database' or 'note'
  descriptionStorageLocation: 'database', // 'database' or 'note'
  detailedSummariesStorageLocation: 'database', // 'database' or 'note'
  // Multi-provider settings
  defaultLLMProvider: 'openrouter', // 'openrouter', 'chutes', or 'zai'
  chutesApiKey: "",
  zaiApiKey: "",
  providerTimeout: 60000, // 60 seconds default timeout
  providerRetryCount: 3, // Number of retries for failed requests
  // Provider-specific summary models (NEW)
  openrouterSummaryModel: "openrouter/deepseek/deepseek-r1:free",
  chutesSummaryModel: "deepseek-ai/DeepSeek-V3.2-Speciale-TEE",
  zaiSummaryModel: "glm-4.6",
  // Provider-specific text models (NEW)
  openrouterTextModel: "openrouter/deepseek/deepseek-r1:free",
  chutesTextModel: "deepseek-ai/DeepSeek-V3.2-Speciale-TEE",
  zaiTextModel: "glm-4.6",
  // Debug settings
  debugMode: false, // Debug mode for detailed logging
  // Spaced repetition settings
  spacedRepetition: {
    enabled: false,
    databasePath: ".obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite",
    maxReviewCardsPerSession: 50,
    newCardsPerDay: 20,
    gradeZeroReaskDelay: 3,
    includeLinkedNotesByDefault: true,
  },
};

export { VIEW_TYPE_GENERATE_TEXT };
export { DEFAULT_SETTINGS };
export { VIEW_TYPE_GENERATE_IMAGE };
export {HIERARCHY_PLUGIN_ID};
