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

  it('produces identical hash for CRLF and LF content', async () => {
    const crlfText = 'Line 1\r\nLine 2\r\nLine 3';
    const lfText = 'Line 1\nLine 2\nLine 3';

    const hashCrlf = await calculateSha256(crlfText);
    const hashLf = await calculateSha256(lfText);

    expect(hashCrlf).toBe(hashLf);
  });

  it('fails gracefully when endpoint is empty', async () => {
    mockPlugin.settings.noteSyncEndpoint = '';
    mockPlugin.settings.cardSyncEndpoint = '';
    const client = new NoteSyncClient(mockPlugin);

    await expect(client.getDelta([], 'pc')).rejects.toThrow('not configured');
  });
});
