import { App, EventRef, normalizePath } from 'obsidian';
import { IndexStatus, RetrievalSettings } from '../types/retrieval';
import { DebugLogger } from '../utils/DebugLogger';
import { RetrievalDatabase } from './RetrievalDatabase';
import { VaultSource } from './VaultSource';

export interface IndexAllOptions {
  rebuild?: boolean;
  signal?: AbortSignal;
  onProgress?: (status: IndexStatus) => void;
}

export class IndexCoordinator {
  private app: App;
  private database: RetrievalDatabase;
  private vaultSource: VaultSource;
  private getSettings: () => RetrievalSettings;
  private debugLogger: DebugLogger;
  private status: IndexStatus = {
    state: 'idle',
    chunkCount: 0,
    fileCount: 0,
    lastIndexedAt: null,
    lastError: null,
    indexedFiles: 0,
    unchangedFiles: 0,
    skippedFiles: 0,
    deletedFiles: 0,
    totalFiles: 0,
    processedFiles: 0,
  };
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private currentAbort: AbortController | null = null;
  private eventRefs: EventRef[] = [];
  private listenersRegistered = false;

  constructor(
    app: App,
    database: RetrievalDatabase,
    getSettings: () => RetrievalSettings,
    debugLogger: DebugLogger
  ) {
    this.app = app;
    this.database = database;
    this.getSettings = getSettings;
    this.debugLogger = debugLogger;
    this.vaultSource = new VaultSource(app);
  }

  async initialize(): Promise<void> {
    await this.database.initialize();
    this.refreshStatusFromDatabase();
  }

  registerVaultListeners(plugin: { registerEvent: (ref: EventRef) => void | EventRef }): void {
    if (this.listenersRegistered) {
      return;
    }

    this.eventRefs.push(
      plugin.registerEvent(
        this.app.vault.on('modify', (file) => this.handlePathChanged(file.path))
      ) as EventRef
    );
    this.eventRefs.push(
      plugin.registerEvent(
        this.app.vault.on('create', (file) => this.handlePathChanged(file.path))
      ) as EventRef
    );
    this.eventRefs.push(
      plugin.registerEvent(
        this.app.vault.on('delete', (file) => {
          void this.removePath(file.path);
        })
      ) as EventRef
    );
    this.eventRefs.push(
      plugin.registerEvent(
        this.app.vault.on('rename', (file, oldPath) => {
          void this.handleRename(oldPath, file.path);
        })
      ) as EventRef
    );

    this.listenersRegistered = true;
  }

  getStatus(): IndexStatus {
    return { ...this.status };
  }

  cancelCurrentIndex(): void {
    this.currentAbort?.abort();
  }

  async indexAll(options: IndexAllOptions = {}): Promise<IndexStatus> {
    if (this.status.state === 'indexing') {
      return this.getStatus();
    }

    this.currentAbort = new AbortController();
    const signal = options.signal ?? this.currentAbort.signal;
    this.status.state = 'indexing';
    this.status.lastError = null;
    this.status.indexedFiles = 0;
    this.status.unchangedFiles = 0;
    this.status.skippedFiles = 0;
    this.status.deletedFiles = 0;
    this.status.totalFiles = 0;
    this.status.processedFiles = 0;

    const onProgress = options.onProgress;
    const reportProgress = () => {
      onProgress?.(this.getStatus());
    };

    const startedAt = Date.now();
    try {
      if (options.rebuild) {
        await this.database.clearAll();
      }

      const settings = this.getSettings();
      const enabledSources = settings.sources.filter((entry) => entry.enabled);

      // Pre-count total candidates across all enabled sources.
      for (const source of enabledSources) {
        this.status.totalFiles += this.vaultSource.listCandidates(source).length;
      }
      reportProgress();

      for (const source of enabledSources) {
        if (signal.aborted) {
          break;
        }
        await this.indexSource(source, signal, reportProgress);
      }

      await this.database.flush();
      this.refreshStatusFromDatabase();
      this.status.state = 'idle';
      this.debugLogger.log(
        `Retrieval index completed in ${Date.now() - startedAt}ms: indexed=${this.status.indexedFiles}, unchanged=${this.status.unchangedFiles}, skipped=${this.status.skippedFiles}, deleted=${this.status.deletedFiles}`
      );
    } catch (error) {
      this.status.state = 'error';
      this.status.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.currentAbort = null;
    }

    return this.getStatus();
  }

  queuePath(path: string, delayMs = 750): void {
    const normalized = normalizePath(path);
    const existing = this.debounceTimers.get(normalized);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(normalized);
      void this.updatePath(normalized);
    }, delayMs);
    this.debounceTimers.set(normalized, timer);
  }

  async removePath(path: string): Promise<void> {
    const settings = this.getSettings();
    for (const source of settings.sources) {
      await this.database.removeFile(source.id, path);
    }
    await this.database.flush();
    this.refreshStatusFromDatabase();
  }

  async shutdown(): Promise<void> {
    this.cancelCurrentIndex();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.eventRefs = [];
    await this.database.close();
  }

  private async handleRename(oldPath: string, newPath: string): Promise<void> {
    await this.removePath(oldPath);
    this.queuePath(newPath);
  }

  private handlePathChanged(path: string): void {
    if (!this.getSettings().autoIndexOnModify) {
      return;
    }
    if (!path.endsWith('.md')) {
      return;
    }
    this.queuePath(path);
  }

  private async updatePath(path: string): Promise<void> {
    const settings = this.getSettings();
    for (const source of settings.sources.filter((entry) => entry.enabled)) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !('stat' in file)) {
        await this.database.removeFile(source.id, path);
        continue;
      }

      const candidate = {
        file: file as any,
        path: normalizePath(path),
        size: (file as any).stat.size,
        modifiedTime: (file as any).stat.mtime,
      };
      const result = await this.vaultSource.indexFile(this.database, source, candidate);
      if (result.status === 'indexed') {
        this.status.indexedFiles++;
      }
    }
    await this.database.flush();
    this.refreshStatusFromDatabase();
  }

  private async indexSource(
    source: ReturnType<typeof this.getSettings>['sources'][number],
    signal: AbortSignal,
    onProgress?: (status: IndexStatus) => void
  ): Promise<void> {
    const candidates = this.vaultSource.listCandidates(source);
    const observedPaths = new Set<string>();

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (signal.aborted) {
        return;
      }

      // Yield to the main thread every 50 files to prevent blocking the UI
      if (i > 0 && i % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        onProgress?.(this.getStatus());
      }

      observedPaths.add(candidate.path);
      const result = await this.vaultSource.indexFile(this.database, source, candidate);

      if (result.status === 'indexed') {
        this.status.indexedFiles++;
      } else if (result.status === 'unchanged') {
        this.status.unchangedFiles++;
      } else {
        this.status.skippedFiles++;
      }
      this.status.processedFiles++;
    }

    // Final progress report for this source
    onProgress?.(this.getStatus());

    this.status.deletedFiles += await this.database.removeMissingFiles(source.id, observedPaths);
  }

  private refreshStatusFromDatabase(): void {
    const stats = this.database.getStats();
    this.status.chunkCount = stats.chunkCount;
    this.status.fileCount = stats.fileCount;
    this.status.lastIndexedAt = stats.lastIndexedAt;
  }
}
