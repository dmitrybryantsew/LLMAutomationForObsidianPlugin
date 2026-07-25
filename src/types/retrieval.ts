export type RetrievalSourceKind = 'vault' | 'repository' | 'docset' | 'web-export';

export type RetrievalTrust = 'personal' | 'official' | 'code' | 'external';

export interface RetrievalSourceConfig {
  id: string;
  name: string;
  kind: RetrievalSourceKind;
  rootPath: string;
  enabled: boolean;
  trust: RetrievalTrust;
  includeGlobs: string[];
  excludeGlobs: string[];
  maxFileBytes: number;
  version?: string;
}

export type EmbeddingProviderType = 'none' | 'ollama' | 'chutes';

export interface CompanionConfig {
  enabled: boolean;
  endpoint: string;
}

export interface EmbeddingConfig {
  provider: EmbeddingProviderType;
  ollamaEndpoint: string;
  ollamaModel: string;
  chutesApiKey: string;
  chutesBaseUrl: string;
  chutesModel: string;
  semanticThreshold: number;
  lexicalVeto: boolean;
}

export interface RetrievalSettings {
  enabled: boolean;
  databasePath: string;
  sources: RetrievalSourceConfig[];
  evidenceTokenBudget: number;
  defaultResultLimit: number;
  autoIndexOnStartup: boolean;
  autoIndexOnModify: boolean;
  allowGeneralKnowledgeWhenUngrounded: boolean;
  embedding: EmbeddingConfig;
  companion: CompanionConfig;
}

export interface RetrievalChunkDraft {
  id: string;
  sourceId: string;
  path: string;
  basename: string;
  headingPath: string[];
  startLine: number;
  endLine: number;
  text: string;
  normalizedText: string;
  tags: string[];
  outboundLinks: string[];
  contentHash: string;
  modifiedTime: number;
}

export interface RetrievalChunk extends RetrievalChunkDraft {}

export interface SearchRequest {
  query: string;
  sourceIds?: string[];
  folderPrefix?: string;
  tags?: string[];
  limit?: number;
  lexicalCandidateLimit?: number;
  includeCurrentNotePath?: string;
}

export type RetrievalMode = 'strict-and' | 'relaxed-lexical' | 'semantic' | 'hybrid';

export interface RetrievalDiagnostics {
  retrievalMode: RetrievalMode;
  fallbackUsed: boolean;
  strictCandidateCount: number;
  meaningfulTerms: string[];
  matchedTerms: string[];
  matchedTermFraction: number;
}

export interface SearchHit extends RetrievalChunk {
  lexicalScore: number;
  finalScore: number;
  matchReasons: string[];
  retrievalMode: RetrievalMode;
  fallbackUsed: boolean;
  matchedTerms: string[];
  matchedTermFraction: number;
}

export interface EvidenceItem extends SearchHit {
  citationId: string;
  estimatedTokens: number;
  truncated?: boolean;
}

export interface EvidencePack {
  query: string;
  items: EvidenceItem[];
  totalEstimatedTokens: number;
  omittedHitCount: number;
}

export type IndexCoordinatorState = 'idle' | 'indexing' | 'error';

export interface IndexStatus {
  state: IndexCoordinatorState;
  chunkCount: number;
  fileCount: number;
  lastIndexedAt: number | null;
  lastError: string | null;
  indexedFiles: number;
  unchangedFiles: number;
  skippedFiles: number;
  deletedFiles: number;
  totalFiles: number;
  processedFiles: number;
}

// --- P3: Semantic retrieval interfaces ---

export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

export interface VectorUpsertRow {
  chunkId: string;
  chunkHash: string;
  modelId: string;
  preprocessingVersion: string;
  vector: Float32Array;
}

export interface VectorHit {
  chunkId: string;
  similarity: number;
  sourceId: string;
  path: string;
  basename: string;
  headingPath: string[];
  startLine: number;
  endLine: number;
  text: string;
  normalizedText: string;
  tags: string[];
  contentHash: string;
  modifiedTime: number;
}

export interface VectorStore {
  upsert(rows: VectorUpsertRow[]): Promise<void>;
  search(queryVector: Float32Array, filters: VectorSearchFilters, limit: number): Promise<VectorHit[]>;
  removeChunkIds(ids: string[]): Promise<void>;
  removeByModel(modelId: string): Promise<number>;
  getStatus(): Promise<VectorIndexStatus>;
}

export interface VectorSearchFilters {
  sourceIds?: string[];
  folderPrefix?: string;
  tags?: string[];
}

export type VectorIndexState = 'empty' | 'building' | 'ready' | 'stale' | 'error';

export interface VectorIndexStatus {
  state: VectorIndexState;
  modelId: string | null;
  dimensions: number;
  vectorCount: number;
  lastBuiltAt: number | null;
  lastError: string | null;
  buildProgress: number | null;
  buildTotal: number | null;
}

// --- P5: Knowledge agent tool loop ---

export interface BoundedSourceRead {
  sourceId: string;
  path: string;
  basename: string;
  headingPath: string[];
  startLine: number;
  endLine: number;
  text: string;
  truncated: boolean;
  estimatedTokens: number;
}

export interface KnowledgeAgentStep {
  type: 'search' | 'read' | 'answer';
  query?: string;
  readChunkId?: string;
  readPath?: string;
  searchResultCount?: number;
  searchResultPaths?: string[];
  searchResultSnippets?: string[];
  readSnippet?: string;
  answer?: string;
  citations?: string[];
  latencyMs: number;
}

export interface KnowledgeAgentResult {
  answer: string;
  citations: string[];
  evidencePack: EvidencePack;
  steps: KnowledgeAgentStep[];
  totalLatencyMs: number;
  searchCalls: number;
  readCalls: number;
  truncated: boolean;
}

export interface KnowledgeAgentOptions {
  maxSearchCalls: number;
  maxReadCalls: number;
  maxEvidenceTokens: number;
  maxAnswerTokens: number;
  temperature: number;
  timeoutMs: number;
  allowGeneralKnowledge: boolean;
}

export const DEFAULT_AGENT_OPTIONS: KnowledgeAgentOptions = {
  maxSearchCalls: 3,
  maxReadCalls: 5,
  maxEvidenceTokens: 12000,
  maxAnswerTokens: 2000,
  temperature: 0.3,
  timeoutMs: 60_000,
  allowGeneralKnowledge: false,
};

/** Live event emitted during agent execution for UI progress display. */
export interface KnowledgeAgentEvent {
  /** Current phase of the agent loop. */
  phase: 'extracting-terms' | 'searching' | 'selecting' | 'reading' | 'answering' | 'done' | 'error';
  /** Human-readable status message. */
  message: string;
  /** Step index (0-based) for correlating with the final steps array. */
  stepIndex?: number;
  /** Partial data — e.g. search hits during 'searching' phase. */
  data?: unknown;
}

/** Callback for receiving live progress events during agent execution. */
export type KnowledgeAgentEventCallback = (event: KnowledgeAgentEvent) => void;

/** Result of the evidence-gathering phase (before answer generation). */
export interface KnowledgeAgentEvidence {
  /** The selected hits the agent will use as evidence. */
  hits: SearchHit[];
  /** Evidence pack built from the hits. */
  evidencePack: EvidencePack;
  /** Steps recorded so far (search + read steps). */
  steps: KnowledgeAgentStep[];
  /** Number of search calls made. */
  searchCalls: number;
  /** Number of read calls made. */
  readCalls: number;
  /** Whether the evidence was truncated by limits. */
  truncated: boolean;
  /** The refined query used for the search. */
  refinedQuery: string;
}
