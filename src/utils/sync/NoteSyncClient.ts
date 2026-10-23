import { Notice, requestUrl } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../../main';

export interface LocalNoteManifestItem {
  path: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface RemoteManifestDelta {
  serverTime: string;
  deviceRole: 'pc' | 'mobile';
  toUpload: string[];
  toDownload: string[];
  toDelete: string[];
  conflicts: string[];
}

export interface NotePayload {
  path: string;
  content: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface RemoteNoteItem {
  path: string;
  content: string;
  hash: string;
  size: number;
  mtime: number;
  sourceRole: 'pc' | 'mobile';
  updatedAt: string;
}

export async function calculateSha256(content: string): Promise<string> {
  const normalized = (content || '').replace(/\r\n/g, '\n');
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export class NoteSyncClient {
  constructor(private plugin: GptFreeTextGeneratorPlugin) {}

  private getEndpoint(): string {
    return (this.plugin.settings.noteSyncEndpoint || this.plugin.settings.cardSyncEndpoint || '').trim().replace(/\/+$/, '');
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = (this.plugin.settings.noteSyncApiKey || this.plugin.settings.cardSyncApiKey || '').trim();
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  async getDelta(files: LocalNoteManifestItem[], deviceRole: 'pc' | 'mobile'): Promise<RemoteManifestDelta> {
    const endpoint = this.getEndpoint();
    if (!endpoint) {
      throw new Error('Note sync endpoint is not configured in settings.');
    }

    const response = await requestUrl({
      url: `${endpoint}/api/notes/manifest`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        deviceRole,
        files,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Server returned status ${response.status} when requesting manifest delta.`);
    }

    const data = response.json?.data || response.json;
    return {
      serverTime: data.serverTime || new Date().toISOString(),
      deviceRole: data.deviceRole || deviceRole,
      toUpload: Array.isArray(data.toUpload) ? data.toUpload : [],
      toDownload: Array.isArray(data.toDownload) ? data.toDownload : [],
      toDelete: Array.isArray(data.toDelete) ? data.toDelete : [],
      conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
    };
  }

  async pushNotes(notes: NotePayload[], deviceRole: 'pc' | 'mobile'): Promise<{ saved: number }> {
    const endpoint = this.getEndpoint();
    if (!endpoint) {
      throw new Error('Note sync endpoint is not configured in settings.');
    }

    if (notes.length === 0) {
      return { saved: 0 };
    }

    const response = await requestUrl({
      url: `${endpoint}/api/notes/push`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        deviceRole,
        notes,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Server returned status ${response.status} during notes push.`);
    }

    const data = response.json?.data || response.json;
    return { saved: Number(data.saved ?? notes.length) };
  }

  async pullNotes(paths: string[]): Promise<RemoteNoteItem[]> {
    const endpoint = this.getEndpoint();
    if (!endpoint) {
      throw new Error('Note sync endpoint is not configured in settings.');
    }

    if (paths.length === 0) {
      return [];
    }

    const response = await requestUrl({
      url: `${endpoint}/api/notes/pull`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ paths }),
    });

    if (response.status !== 200) {
      throw new Error(`Server returned status ${response.status} during notes pull.`);
    }

    const data = response.json?.data || response.json;
    return Array.isArray(data.notes) ? data.notes : [];
  }
}
