export type StudySourceType = 'reference' | 'exercise-corpus' | 'summary' | 'plan' | 'docs' | 'canvas' | 'other';

export interface StudySourceGroup {
  id: string;
  name: string;
  path: string;
  type: StudySourceType;
  enabled: boolean;
  recursive: boolean;
  extensions: string[];
  maxFiles: number;
  maxEstimatedTokens: number;
  priority: number;
}

export interface StudySourceFile {
  groupId: string;
  groupName: string;
  type: StudySourceType;
  path: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  charCount: number;
  estimatedTokens: number;
  included: boolean;
  skippedReason?: string;
}

export interface StudySourceScanResult {
  scannedAt: string;
  groups: StudySourceGroup[];
  files: StudySourceFile[];
  totalFiles: number;
  includedFiles: number;
  totalEstimatedTokens: number;
  includedEstimatedTokens: number;
}

export interface StudySourceContextFile extends StudySourceFile {
  content: string;
}

export interface StudySourceContext {
  files: StudySourceContextFile[];
  estimatedTokens: number;
  skippedFiles: number;
}
