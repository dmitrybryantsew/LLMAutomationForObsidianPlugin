import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateSha256, NoteSyncClient } from '../../src/utils/sync/NoteSyncClient';

describe('NoteSyncClient and hashing', () => {
  let mockPlugin: any;

  beforeEach(() => {
    mockPlugin = {
      settings: {
        noteSyncEndpoint: 'http://localhost:3000',
        noteSyncApiKey: 'secret-key',
        noteSyncDeviceRole: 'pc',
      },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('computes sha256 hex string deterministically', async () => {
    const text = 'Hello Obsidian Note Sync!';
    const hash1 = await calculateSha256(text);
    const hash2 = await calculateSha256(text);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails gracefully when endpoint is empty', async () => {
    mockPlugin.settings.noteSyncEndpoint = '';
    mockPlugin.settings.cardSyncEndpoint = '';
    const client = new NoteSyncClient(mockPlugin);

    await expect(client.getDelta([], 'pc')).rejects.toThrow('not configured');
  });
});
