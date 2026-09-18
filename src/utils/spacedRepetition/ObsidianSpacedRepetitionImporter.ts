import { App, TFile, normalizePath } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../../main';
import {
  ParsedOsrCard,
  parseOsrFileContent,
  matchDeckTag,
  normalizeTag,
} from './ObsidianSpacedRepetitionParser';
import { SpacedRepetitionQuestionInput } from '../../types/spacedRepetition';

export interface OsrDeckSummary {
  deckTag: string; // e.g. 'German/ageeva/nouns'
  parentDeck: string; // e.g. 'German'
  totalCards: number;
  dueCards: number;
  newCards: number;
  files: string[];
}

export interface OsrScanResult {
  configuredTags: string[];
  decks: OsrDeckSummary[];
  totalCards: number;
  totalDue: number;
  totalNew: number;
}

export interface OsrImportResult {
  importedCount: number;
  studySetId: string;
  studySetName: string;
  deckTag: string;
}

const DEFAULT_OSR_TAGS = [
  '#flashcards',
  '#cppFlashcards',
  '#CSharpFlashcards',
  '#German',
  '#Mnemonics',
];

const OSR_DATA_JSON_PATH = '.obsidian/plugins/obsidian-spaced-repetition/data.json';

export class ObsidianSpacedRepetitionImporter {
  private app: App;
  private plugin: GptFreeTextGeneratorPlugin;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    this.app = app;
    this.plugin = plugin;
  }

  /**
   * Loads the configured deck tags from the obsidian-spaced-repetition plugin's data.json.
   * If not found, falls back to standard known tags.
   */
  async loadConfiguredTags(): Promise<string[]> {
    try {
      if (await this.app.vault.adapter.exists(OSR_DATA_JSON_PATH)) {
        const raw = await this.app.vault.adapter.read(OSR_DATA_JSON_PATH);
        const data = JSON.parse(raw);
        if (Array.isArray(data?.settings?.flashcardTags) && data.settings.flashcardTags.length > 0) {
          return data.settings.flashcardTags;
        }
      }
    } catch (err) {
      console.warn('Could not read obsidian-spaced-repetition data.json:', err);
    }
    return DEFAULT_OSR_TAGS;
  }

  /**
   * Scans the vault for markdown files containing any cards for the configured deck tags.
   * Summarizes card counts, due counts, and matching files per deck.
   */
  async scanVaultDecks(): Promise<OsrScanResult> {
    const configuredTags = await this.loadConfiguredTags();
    const markdownFiles = this.app.vault.getMarkdownFiles();

    const deckMap = new Map<string, {
      deckTag: string;
      parentDeck: string;
      totalCards: number;
      dueCards: number;
      newCards: number;
      files: Set<string>;
    }>();

    for (const file of markdownFiles) {
      // Fast path: skip files that are clearly not flashcard files
      if (file.path.startsWith('.trash/') || file.path.startsWith('.obsidian/')) {
        continue;
      }

      try {
        const content = await this.app.vault.read(file);

        // Check if content has at least one configured tag
        const lower = content.toLowerCase();
        const hasTag = configuredTags.some((tag) => lower.includes(normalizeTag(tag)));
        if (!hasTag) continue;

        const cards = parseOsrFileContent(content, file.path, configuredTags);
        if (cards.length === 0) continue;

        for (const card of cards) {
          const deckTag = card.deckTag;
          const parentDeck = deckTag.split('/')[0];

          let entry = deckMap.get(deckTag);
          if (!entry) {
            entry = {
              deckTag,
              parentDeck,
              totalCards: 0,
              dueCards: 0,
              newCards: 0,
              files: new Set(),
            };
            deckMap.set(deckTag, entry);
          }

          entry.totalCards++;
          entry.files.add(file.path);

          if (card.schedule && !card.schedule.isNew) {
            entry.dueCards++;
          } else {
            entry.newCards++;
          }
        }
      } catch (err) {
        console.warn(`Error scanning file ${file.path} for OSR cards:`, err);
      }
    }

    const decks: OsrDeckSummary[] = Array.from(deckMap.values())
      .map((d) => ({
        deckTag: d.deckTag,
        parentDeck: d.parentDeck,
        totalCards: d.totalCards,
        dueCards: d.dueCards,
        newCards: d.newCards,
        files: Array.from(d.files),
      }))
      .sort((a, b) => b.totalCards - a.totalCards);

    let totalCards = 0;
    let totalDue = 0;
    let totalNew = 0;
    for (const d of decks) {
      totalCards += d.totalCards;
      totalDue += d.dueCards;
      totalNew += d.newCards;
    }

    return {
      configuredTags,
      decks,
      totalCards,
      totalDue,
      totalNew,
    };
  }

  /**
   * Parses and returns cards for a specific deck tag (or all subdecks under parent deck).
   */
  async loadCardsForDeck(
    deckTag: string,
    options?: { exactTagOnly?: boolean; limit?: number; offset?: number }
  ): Promise<ParsedOsrCard[]> {
    const configuredTags = await this.loadConfiguredTags();
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const allCards: ParsedOsrCard[] = [];

    const targetLower = deckTag.toLowerCase();

    for (const file of markdownFiles) {
      if (file.path.startsWith('.trash/') || file.path.startsWith('.obsidian/')) {
        continue;
      }

      try {
        const content = await this.app.vault.read(file);
        const lower = content.toLowerCase();
        if (!lower.includes(normalizeTag(deckTag.split('/')[0]))) continue;

        const cards = parseOsrFileContent(content, file.path, configuredTags);
        for (const card of cards) {
          const cardLower = card.deckTag.toLowerCase();
          const matches = options?.exactTagOnly
            ? cardLower === targetLower
            : cardLower === targetLower || cardLower.startsWith(targetLower + '/');

          if (matches) {
            allCards.push(card);
          }
        }
      } catch (err) {
        console.warn(`Error reading file ${file.path}:`, err);
      }
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? allCards.length;
    return allCards.slice(offset, offset + limit);
  }

  /**
   * Imports a batch of parsed OSR cards into SpacedRepetitionDatabase.
   * Creates or reuses a Study Set, upserts note references, and preserves existing schedules.
   */
  async importBatch(
    cards: ParsedOsrCard[],
    options?: { customStudySetName?: string }
  ): Promise<OsrImportResult> {
    if (cards.length === 0) {
      return {
        importedCount: 0,
        studySetId: '',
        studySetName: '',
        deckTag: '',
      };
    }

    const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
    const primaryDeckTag = cards[0].deckTag;
    const studySetName = options?.customStudySetName || primaryDeckTag;

    // 1. Find or create Study Set
    const existingSets = database.getStudySets();
    let studySet = existingSets.find((s) => s.name === studySetName);
    let studySetId = studySet?.id ?? '';

    if (!studySetId) {
      studySetId = await database.createStudySet({
        name: studySetName,
        description: `Imported from Obsidian Spaced Repetition deck #${primaryDeckTag}`,
        sourceType: 'tag',
        sourceRule: {
          type: 'obsidian-spaced-repetition-import',
          deckTag: primaryDeckTag,
        },
        tags: ['imported-osr', primaryDeckTag.toLowerCase()],
      });
    }

    // 2. Prepare Question Inputs
    const questionInputs: SpacedRepetitionQuestionInput[] = [];
    const noteIdCache = new Map<string, string>();

    for (const card of cards) {
      let noteId: string | null = null;
      const file = this.app.vault.getAbstractFileByPath(card.sourceFilePath);

      if (file instanceof TFile) {
        if (noteIdCache.has(file.path)) {
          noteId = noteIdCache.get(file.path)!;
        } else {
          noteId = await database.upsertNoteFromFile(file, `osr_${card.deckTag.replace(/[^a-zA-Z0-9]/g, '_')}`);
          noteIdCache.set(file.path, noteId);
        }
      }

      // Schedule preservation
      const sched = card.schedule;
      const isExistingReview = sched && !sched.isNew && sched.intervalDays > 0;
      const nextRepeatAt = isExistingReview
        ? `${sched.dueDateStr}T00:00:00.000Z`
        : new Date().toISOString();

      questionInputs.push({
        studySetId,
        noteId,
        questionName: null,
        questionText: card.questionText,
        questionType: 'self_check',
        answerText: card.answerText,
        answerCheckMode: 'self',
        nextRepeatAt,
        initialSchedule: {
          intervalDays: sched?.intervalDays ?? 0,
          ease: sched?.ease ?? 2.5,
          repetitionCount: sched?.repetitionCount ?? 0,
          lapseCount: 0,
        },
        metadata: {
          importedFrom: 'obsidian-spaced-repetition',
          deckTag: card.deckTag,
          cardStyle: card.cardStyle,
          sourceFilePath: card.sourceFilePath,
          sourceLineNumber: card.sourceLineNumber,
          originalDueDate: sched?.dueDateStr ?? null,
          originalEase: sched?.ease ?? null,
          originalInterval: sched?.intervalDays ?? null,
        },
      });
    }

    await database.createQuestions(questionInputs);

    return {
      importedCount: questionInputs.length,
      studySetId,
      studySetName,
      deckTag: primaryDeckTag,
    };
  }
}
