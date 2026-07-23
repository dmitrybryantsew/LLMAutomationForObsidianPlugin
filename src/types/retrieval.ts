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
