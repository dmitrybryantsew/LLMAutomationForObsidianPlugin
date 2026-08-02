import { App, TFile, normalizePath } from 'obsidian';
import { RetrievalSourceConfig } from '../types/retrieval';
import { fnv1aHash, normalizeRetrievalText } from './hashUtils';
import { IgnoreMatcher } from './IgnoreMatcher';
import { chunkMarkdown } from './MarkdownChunker';
import { RetrievalDatabase } from './RetrievalDatabase';

export interface VaultFileCandidate {
  file: TFile;
  path: string;
  size: number;
  modifiedTime: number;
}

export interface IndexFileResult {
  path: string;
  status: 'indexed' | 'unchanged' | 'skipped';
  reason?: string;
  chunkCount: number;
}

export class VaultSource {
  constructor(private app: App) {}

  listCandidates(source: RetrievalSourceConfig): VaultFileCandidate[] {
    const matcher = new IgnoreMatcher({
      rootPath: source.rootPath,
      includeGlobs: source.includeGlobs,
      excludeGlobs: source.excludeGlobs,
    });

    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => matcher.shouldIndex(file.path))
      .map((file) => ({
        file,
        path: normalizePath(file.path),
        size: file.stat.size,
        modifiedTime: file.stat.mtime,
      }));
    // Note: we intentionally do NOT filter by maxFileBytes here so that
    // IndexCoordinator can count oversized files as 'skipped' rather than
    // silently dropping them. VaultSource.indexFile enforces the limit.
  }

  async indexFile(
    database: RetrievalDatabase,
    source: RetrievalSourceConfig,
    candidate: VaultFileCandidate
  ): Promise<IndexFileResult> {
    if (candidate.size > source.maxFileBytes) {
      return {
        path: candidate.path,
        status: 'skipped',
        reason: 'maxFileBytes',
        chunkCount: 0,
      };
    }

    const existing = database.getFileRecord(source.id, candidate.path);

    // Fast path: if the file's modified time hasn't changed, we can skip reading/hashing
    if (existing && existing.modifiedTime === candidate.modifiedTime) {
      return {
        path: candidate.path,
        status: 'unchanged',
        chunkCount: 0,
      };
    }

    const content = await this.app.vault.read(candidate.file);
    const normalized = normalizeRetrievalText(content);
    const contentHash = fnv1aHash(normalized);

    // Secondary check: if for some reason the modification time changed but content didn't
    if (existing && existing.contentHash === contentHash) {
      // Just update the modified time in the DB to avoid re-reading next time
      await database.updateFileModifiedTime(source.id, candidate.path, candidate.modifiedTime);
      return {
        path: candidate.path,
        status: 'unchanged',
        chunkCount: 0,
      };
    }

    const chunks = chunkMarkdown({
      sourceId: source.id,
      path: candidate.path,
      content,
      modifiedTime: candidate.modifiedTime,
    });

    await database.replaceFileChunks({
      sourceId: source.id,
      path: candidate.path,
      contentHash,
      modifiedTime: candidate.modifiedTime,
      chunks,
    });

    return {
      path: candidate.path,
      status: 'indexed',
      chunkCount: chunks.length,
    };
  }
}
