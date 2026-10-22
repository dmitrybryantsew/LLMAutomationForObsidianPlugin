import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSyncClient } from '../../src/utils/spacedRepetition/CardSyncClient';

describe('CardSyncClient', () => {
  let mockPlugin: any;
  let mockDatabase: any;

  beforeEach(() => {
    mockPlugin = {
      settings: {
        cardSyncEndpoint: 'http://localhost:3000',
        cardSyncApiKey: 'test-api-key',
        cardSyncLastSyncAt: null,
      },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };

    mockDatabase = {
      getAllStudySetsForSync: vi.fn().mockReturnValue([
        { id: 'set_1', name: 'Deck 1', updatedAt: '2026-10-20T12:00:00Z' },
      ]),
      getAllQuestionsForSync: vi.fn().mockReturnValue([
        { id: 'q_1', questionText: 'Q1', updatedAt: '2026-10-20T12:00:00Z' },
      ]),
      getReviewsSince: vi.fn().mockReturnValue([]),
      applySyncResult: vi.fn().mockResolvedValue({
        importedDecks: 1,
        importedCards: 2,
        importedReviews: 3,
      }),
    };
  });

  it('fails gracefully if endpoint is not configured', async () => {
    mockPlugin.settings.cardSyncEndpoint = '';
    const client = new CardSyncClient(mockPlugin, mockDatabase);
    const result = await client.sync();

    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('fails quietly with silent: true when endpoint is not configured', async () => {
    mockPlugin.settings.cardSyncEndpoint = '';
    const client = new CardSyncClient(mockPlugin, mockDatabase);
    const result = await client.sync({ silent: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });
});
