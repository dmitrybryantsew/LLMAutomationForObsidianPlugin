import { Notice, requestUrl } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../../main';
import { SpacedRepetitionDatabase } from './SpacedRepetitionDatabase';

export interface CardSyncResult {
  success: boolean;
  serverTime?: string;
  importedDecks: number;
  importedCards: number;
  importedReviews: number;
  error?: string;
}

export class CardSyncClient {
  constructor(
    private plugin: GptFreeTextGeneratorPlugin,
    private database: SpacedRepetitionDatabase
  ) {}

  async sync(options: { fullDownload?: boolean; silent?: boolean } = {}): Promise<CardSyncResult> {
    const endpoint = (this.plugin.settings.cardSyncEndpoint || '').trim().replace(/\/+$/, '');
    if (!endpoint) {
      if (!options.silent) {
        new Notice('Card sync endpoint is not configured in settings.');
      }
      return { success: false, importedDecks: 0, importedCards: 0, importedReviews: 0, error: 'Endpoint not configured' };
    }

    const apiKey = (this.plugin.settings.cardSyncApiKey || '').trim();
    const lastSync = options.fullDownload ? null : this.plugin.settings.cardSyncLastSyncAt;

    try {
      const decks = this.database.getAllStudySetsForSync();
      const cards = this.database.getAllQuestionsForSync();
      const reviews = this.database.getReviewsSince(lastSync);

      const payload = {
        since: lastSync,
        decks,
        cards,
        reviews,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      if (!options.silent) {
        new Notice(options.fullDownload ? 'Downloading all flashcards from remote site...' : 'Syncing flashcards with remote site...');
      }

      const response = await requestUrl({
        url: `${endpoint}/api/cards/sync`,
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (response.status !== 200) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const body = response.json;
      const data = body?.data || {};

      const applyCounts = await this.database.applySyncResult({
        decks: data.decks || [],
        cards: data.cards || [],
        reviews: data.reviews || [],
      });

      if (!this.plugin.settings.spacedRepetition.enabled && (applyCounts.importedCards > 0 || applyCounts.importedDecks > 0)) {
        this.plugin.settings.spacedRepetition.enabled = true;
      }

      if (data.serverTime) {
        this.plugin.settings.cardSyncLastSyncAt = data.serverTime;
        await this.plugin.saveSettings();
      }

      if (!options.silent) {
        new Notice(
          `Sync complete: ${applyCounts.importedDecks} deck(s), ${applyCounts.importedCards} card(s), ${applyCounts.importedReviews} review(s) updated from site.`
        );
      }

      return {
        success: true,
        serverTime: data.serverTime,
        importedDecks: applyCounts.importedDecks,
        importedCards: applyCounts.importedCards,
        importedReviews: applyCounts.importedReviews,
      };
    } catch (err: any) {
      const msg = err?.message || 'Unknown sync error';
      if (options.silent) {
        console.warn('[CardSyncClient] Background sync skipped (server unreachable or error):', msg);
      } else {
        console.error('Failed to sync flashcards:', err);
        new Notice(`Card sync failed: ${msg}`);
      }
      return {
        success: false,
        importedDecks: 0,
        importedCards: 0,
        importedReviews: 0,
        error: msg,
      };
    }
  }
}
