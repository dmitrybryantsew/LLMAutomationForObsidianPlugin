const VIEW_TYPE_GENERATE_TEXT = "gpt4free-text-panel";
const VIEW_TYPE_GENERATE_IMAGE = "gpt4free-image-panel";
const VIEW_TYPE_SPACED_REPETITION_REVIEW = "llm-automation-spaced-repetition-review";
const VIEW_TYPE_SPACED_REPETITION_DECK_BROWSER = "llm-automation-spaced-repetition-deck-browser";
const VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT = "llm-automation-spaced-repetition-card-management";
const VIEW_TYPE_SPACED_REPETITION_NOTE_CHAT = "llm-automation-spaced-repetition-note-chat";
const VIEW_TYPE_FLASHCARD_GENERATION = "llm-automation-flashcard-generation";
const VIEW_TYPE_CODING_EXERCISES = "llm-automation-coding-exercises";
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
  flashcardGenerationProvider: 'ollama',
  flashcardGenerationModel: 'gemma4:31b-cloud',
  flashcardGenerationTemperature: 0.2,
  flashcardGenerationMaxTokens: 3000,
  codingExercisesFolder: "Coding Exercises",
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
  defaultLLMProvider: 'openrouter', // 'openrouter', 'chutes', 'zai', 'ollama', or 'proxy'
  chutesApiKey: "",
  zaiApiKey: "",
  proxyApiKey: "",
  providerTimeout: 1200000, // 20 minutes default timeout for long summary requests
  providerRetryCount: 3, // Number of retries for failed requests
  defaultTemperature: 0.7,
  defaultMaxTokens: 2000,
  defaultTopP: 1,
  defaultPresencePenalty: 0,
  defaultFrequencyPenalty: 0,
  ollamaBaseUrl: "http://localhost:11434",
  proxyBaseUrl: "http://localhost:3000/v1",
  helperServerUrl: "http://127.0.0.1:8001",
  ollamaTimeout: 120000,
  ollamaModels: [],
  proxyModels: [],
  // Provider-specific summary models (NEW)
  openrouterSummaryModel: "openrouter/deepseek/deepseek-r1:free",
  openrouterTagModel: "google/gemma-4-31b-it",
  chutesSummaryModel: "deepseek-ai/DeepSeek-V3.2-Speciale-TEE",
  zaiSummaryModel: "glm-4.6",
  ollamaSummaryModel: "gemma4:31b-cloud",
  proxySummaryModel: "nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  // Provider-specific text models (NEW)
  openrouterTextModel: "openrouter/deepseek/deepseek-r1:free",
  chutesTextModel: "deepseek-ai/DeepSeek-V3.2-Speciale-TEE",
  zaiTextModel: "glm-4.6",
  ollamaTextModel: "gemma4:31b-cloud",
  proxyTextModel: "nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  // Debug settings
  debugMode: false, // Debug mode for detailed logging
  // Spaced repetition settings
  spacedRepetition: {
    enabled: false,
    databasePath: ".obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite",
    maxReviewCardsPerSession: 50,
    newCardsPerDay: 20,
    gradeZeroReaskDelay: 3,
    sameDayReviewDelayMinutes: 180,
    includeLinkedNotesByDefault: true,
  },
  allowLocalCodeExecution: false,
  linqPadLprunPath: "E:\\Games\\LINQPad 9.5.10\\LPRun9-x64.exe",
  exerciseRunTimeoutMs: 10000,
  codingExerciseProvider: 'ollama',
  codingExerciseModel: 'gemma4:31b-cloud',
  codingExerciseTemperature: 0.4,
  codingExerciseMaxTokens: 2500,
  studyAssistantRootPath: "C:\\Users\\User\\Documents\\rustProjects\\StudyAssistant",
  studySourceInventoryNotePath: "WikiSynthesis/Study/Source Library/Study Source Inventory.md",
  studyPathProvider: 'ollama',
  studyPathModel: 'gemma4:31b-cloud',
  studyPathTemperature: 0.3,
  studyPathMaxTokens: 5000,
  studyPathContextMaxTokens: 120000,
  studyPathMarkdownPath: "WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.md",
  studyPathCanvasPath: "WikiSynthesis/Study/Plans/CSharp/Generated CSharp Study Path.canvas",
  spacedRepetitionGenerationProvider: 'openrouter',
  spacedRepetitionGenerationModel: '',
  noteChatProvider: 'openrouter',
  noteChatModel: '',
  retrieval: {
    enabled: false,
    databasePath: '.obsidian/plugins/gpt4free-text-generator-plugin/retrieval-index.sqlite',
    sources: [{
      id: 'vault',
      name: 'Vault',
      kind: 'vault',
      rootPath: '',
      enabled: true,
      trust: 'personal',
      includeGlobs: ['**/*.md'],
      excludeGlobs: ['.obsidian/**', 'Templates/**'],
      maxFileBytes: 1_500_000,
    }],
    evidenceTokenBudget: 12000,
    defaultResultLimit: 10,
    autoIndexOnStartup: false,
    autoIndexOnModify: true,
    allowGeneralKnowledgeWhenUngrounded: false,
    embedding: {
      provider: 'none',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'qwen3-embedding:0.6b',
      chutesApiKey: '',
      chutesBaseUrl: 'https://chutes-qwen-qwen3-embedding-8b-tee.chutes.ai',
      chutesModel: 'Qwen/Qwen3-Embedding-8B-TEE',
      semanticThreshold: 0.3,
      lexicalVeto: true,
    },
    companion: {
      enabled: false,
      endpoint: 'http://127.0.0.1:43110',
    },
  },
  studySourceGroups: [
    {
      id: "csharp-reference",
      name: "C# Reference Notes",
      path: "H:\\Common\\foam\\knowledgeBase\\WikiSynthesis\\Study\\Reference\\CSharp",
      type: "reference",
      enabled: true,
      recursive: true,
      extensions: ["md"],
      maxFiles: 80,
      maxEstimatedTokens: 120000,
      priority: 10,
    },
    {
      id: "csharp-study-plans",
      name: "C# Existing Study Plans",
      path: "H:\\Common\\foam\\knowledgeBase\\WikiSynthesis\\Study\\Plans\\CSharp",
      type: "plan",
      enabled: true,
      recursive: true,
      extensions: ["md", "canvas"],
      maxFiles: 40,
      maxEstimatedTokens: 60000,
      priority: 20,
    },
    {
      id: "studyassistant-bcl",
      name: "StudyAssistant BCL Exercises",
      path: "C:\\Users\\User\\Documents\\rustProjects\\StudyAssistant\\Study\\Topic\\BCL",
      type: "exercise-corpus",
      enabled: true,
      recursive: true,
      extensions: ["md", "cs"],
      maxFiles: 400,
      maxEstimatedTokens: 160000,
      priority: 30,
    },
  ],
};

export { VIEW_TYPE_GENERATE_TEXT };
export { DEFAULT_SETTINGS };
export { VIEW_TYPE_GENERATE_IMAGE };
export { VIEW_TYPE_SPACED_REPETITION_REVIEW };
export { VIEW_TYPE_SPACED_REPETITION_DECK_BROWSER };
export { VIEW_TYPE_SPACED_REPETITION_CARD_MANAGEMENT };
export { VIEW_TYPE_SPACED_REPETITION_NOTE_CHAT };
export { VIEW_TYPE_FLASHCARD_GENERATION };
export { VIEW_TYPE_CODING_EXERCISES };
export {HIERARCHY_PLUGIN_ID};
