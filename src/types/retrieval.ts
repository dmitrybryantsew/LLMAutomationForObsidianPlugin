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

export interface RetrievalSettings {
  enabled: boolean;
  databasePath: string;
  sources: RetrievalSourceConfig[];
  evidenceTokenBudget: number;
  defaultResultLimit: number;
  autoIndexOnStartup: boolean;
  autoIndexOnModify: boolean;
  allowGeneralKnowledgeWhenUngrounded: boolean;
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
