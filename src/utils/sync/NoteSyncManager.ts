import { Notice, TFile } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../../main';
import { calculateSha256, LocalNoteManifestItem, NotePayload, NoteSyncClient } from './NoteSyncClient';

export interface NoteSyncSummary {
  success: boolean;
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  error?: string;
}

export class NoteSyncManager {
  private client: NoteSyncClient;
  private isSyncing = false;
  private timerId: number | null = null;

  constructor(private plugin: GptFreeTextGeneratorPlugin) {
    this.client = new NoteSyncClient(plugin);
  }

  startPeriodicSync() {
    this.stopPeriodicSync();
    const endpoint = (this.plugin.settings.noteSyncEndpoint || this.plugin.settings.cardSyncEndpoint || '').trim();
    if (!endpoint) return;
    const intervalMinutes = Number(this.plugin.settings.noteSyncAutoSyncIntervalMinutes ?? 10);
    if (intervalMinutes > 0) {
      const ms = intervalMinutes * 60 * 1000;
      this.timerId = window.setInterval(() => {
        void this.sync({ silent: true });
      }, ms);
    }
  }

  stopPeriodicSync() {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  async sync(options: { silent?: boolean } = {}): Promise<NoteSyncSummary> {
    if (this.isSyncing) {
      if (!options.silent) {
        new Notice('Note sync is already in progress.');
      }
      return { success: false, uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, error: 'Already syncing' };
    }

    const endpoint = (this.plugin.settings.noteSyncEndpoint || this.plugin.settings.cardSyncEndpoint || '').trim();
    if (!endpoint) {
      if (!options.silent) {
        new Notice('Note sync endpoint is not configured in settings.');
      }
      return { success: false, uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, error: 'Endpoint not configured' };
    }

    this.isSyncing = true;
    if (!options.silent) {
      new Notice('Starting note synchronization...');
    }

    try {
      const deviceRole = (this.plugin.settings.noteSyncDeviceRole || 'pc') as 'pc' | 'mobile';

      // 1. Scan markdown files in vault
      const mdFiles = this.plugin.app.vault.getMarkdownFiles().filter(file => {
        // Skip hidden folders or templates if desired
        return !file.path.startsWith('.') && !file.path.startsWith('.trash/');
      });

      const manifestItems: LocalNoteManifestItem[] = [];
      const fileByPath = new Map<string, TFile>();

      for (const file of mdFiles) {
        fileByPath.set(file.path, file);
        const content = await this.plugin.app.vault.read(file);
        const hash = await calculateSha256(content);
        manifestItems.push({
          path: file.path,
          hash,
          mtime: file.stat.mtime,
          size: file.stat.size,
        });
      }

      // 2. Request manifest delta from server
      const delta = await this.client.getDelta(manifestItems, deviceRole);

      let uploadedCount = 0;
      let downloadedCount = 0;
      let deletedCount = 0;
      let conflictCount = 0;

      // 3. Push files that need uploading
      if (delta.toUpload.length > 0) {
        const batchSize = 25;
        for (let i = 0; i < delta.toUpload.length; i += batchSize) {
          const chunkPaths = delta.toUpload.slice(i, i + batchSize);
          const pushPayloads: NotePayload[] = [];

          for (const path of chunkPaths) {
            const file = fileByPath.get(path);
            if (file) {
              const content = await this.plugin.app.vault.read(file);
              const hash = await calculateSha256(content);
              pushPayloads.push({
                path: file.path,
                content,
                hash,
                mtime: file.stat.mtime,
                size: file.stat.size,
              });
            }
          }

          if (pushPayloads.length > 0) {
            const pushResult = await this.client.pushNotes(pushPayloads, deviceRole);
            uploadedCount += pushResult.saved;
          }
        }
      }

      // 4. Pull files that need downloading
      if (delta.toDownload.length > 0) {
        const batchSize = 25;
        const conflictSet = new Set(delta.conflicts);

        for (let i = 0; i < delta.toDownload.length; i += batchSize) {
          const chunkPaths = delta.toDownload.slice(i, i + batchSize);
          const remoteNotes = await this.client.pullNotes(chunkPaths);

          for (const remoteNote of remoteNotes) {
            const existingFile = this.plugin.app.vault.getAbstractFileByPath(remoteNote.path);

            if (existingFile instanceof TFile) {
              // Existing file
              if (conflictSet.has(remoteNote.path)) {
                // Mobile conflict: Save local version as a separate conflict backup
                const currentLocalContent = await this.plugin.app.vault.read(existingFile);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const dir = existingFile.parent ? existingFile.parent.path : '';
                const baseName = existingFile.basename;
                const ext = existingFile.extension || 'md';
                const conflictPath = dir ? `${dir}/${baseName} (Mobile Conflict ${timestamp}).${ext}` : `${baseName} (Mobile Conflict ${timestamp}).${ext}`;

                await this.plugin.app.vault.create(conflictPath, currentLocalContent);
                conflictCount++;
              }

              // Overwrite with server version
              await this.plugin.app.vault.modify(existingFile, remoteNote.content);
              downloadedCount++;
            } else if (!existingFile) {
              // Brand new file
              await this.ensureParentFolder(remoteNote.path);
              await this.plugin.app.vault.create(remoteNote.path, remoteNote.content);
              downloadedCount++;
            }
          }
        }
      }

      // 5. Process deletions (tombstones)
      if (delta.toDelete.length > 0) {
        for (const path of delta.toDelete) {
          const file = this.plugin.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            await this.plugin.app.vault.trash(file, true);
            deletedCount++;
          }
        }
      }

      // 6. Update last sync timestamp and persist
      this.plugin.settings.noteSyncLastSyncAt = delta.serverTime || new Date().toISOString();
      await this.plugin.saveSettings();

      const summary: NoteSyncSummary = {
        success: true,
        uploaded: uploadedCount,
        downloaded: downloadedCount,
        deleted: deletedCount,
        conflicts: conflictCount,
      };

      if (!options.silent) {
        const parts = [
          `Uploaded: ${uploadedCount}`,
          `Downloaded: ${downloadedCount}`,
        ];
        if (deletedCount > 0) parts.push(`Deleted: ${deletedCount}`);
        if (conflictCount > 0) parts.push(`Conflict backups: ${conflictCount}`);
        new Notice(`Note Sync complete! (${parts.join(', ')})`);
      }

      return summary;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (options.silent) {
        console.warn('[NoteSyncManager] Background sync skipped (server unreachable or error):', errMsg);
      } else {
        console.error('[NoteSyncManager] Sync failed:', err);
        new Notice(`Note Sync failed: ${errMsg}`);
      }
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        deleted: 0,
        conflicts: 0,
        error: errMsg,
      };
    } finally {
      this.isSyncing = false;
    }
  }

  private async ensureParentFolder(filePath: string) {
    const parts = filePath.split('/');
    if (parts.length <= 1) return;
    parts.pop();
    const folderPath = parts.join('/');
    const existing = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (!existing) {
      try {
        await this.plugin.app.vault.createFolder(folderPath);
      } catch {
        // Folder may have been created concurrently or already exists
      }
    }
  }
}
