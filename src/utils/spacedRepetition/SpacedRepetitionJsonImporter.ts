import { App, TFile, normalizePath } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../../main';
import {
  AnswerCheckMode,
  ExactAnswerField,
  QuestionType,
  SpacedRepetitionQuestionInput,
} from '../../types/spacedRepetition';
import { normalizeExactAnswerField } from './ExactAnswerMatcher';
import {
  FlashcardLike,
  getFlashcardDuplicateKey,
} from './FlashcardDedupe';
import { stripThinkingTags } from '../modelFilters';

export interface ParsedJsonCard {
  questionName?: string | null;
  questionText: string;
  questionType: QuestionType;
  answerText?: string | null;
  choices?: string[] | null;
  answerCheckMode: AnswerCheckMode;
  metadata: Record<string, unknown>;
  initialSchedule?: {
    intervalDays?: number;
    ease?: number;
    repetitionCount?: number;
    lapseCount?: number;
  };
  tags?: string[];
  notePath?: string | null;
  deckName?: string | null;
  isDuplicate?: boolean;
}

export interface JsonImportParseResult {
  success: boolean;
  deckName?: string;
  cards: ParsedJsonCard[];
  totalParsed: number;
  cardTypeCounts: Record<string, number>;
  duplicateCount: number;
  errors: string[];
}

export interface JsonImportOptions {
  customStudySetName?: string;
  skipDuplicates?: boolean;
  activeNotePath?: string | null;
}

export interface JsonImportResult {
  importedCount: number;
  skippedCount: number;
  studySetId: string;
  studySetName: string;
  cardTypeCounts: Record<string, number>;
}

const VALID_QUESTION_TYPES: QuestionType[] = [
  'self_check',
  'typed_exact',
  'typed_fields_exact',
  'typed_llm_checked',
  'multiple_choice',
];

export class SpacedRepetitionJsonImporter {
  private app: App;
  private plugin: GptFreeTextGeneratorPlugin;

  constructor(app: App, plugin: GptFreeTextGeneratorPlugin) {
    this.app = app;
    this.plugin = plugin;
  }

  /**
   * Parses JSON string into normalized ParsedJsonCard objects.
   * Handles markdown code fences, top-level envelope objects ({cards:[]}, {questions:[]}),
   * bare arrays, and performs deduplication against provided existing cards.
   */
  parseJsonContent(rawInput: string, existingCards: FlashcardLike[] = []): JsonImportParseResult {
    const errors: string[] = [];
    if (!rawInput || !rawInput.trim()) {
      return {
        success: false,
        cards: [],
        totalParsed: 0,
        cardTypeCounts: {},
        duplicateCount: 0,
        errors: ['Input is empty'],
      };
    }

    const cleaned = this.extractJsonText(rawInput);
    let parsedData: unknown;

    try {
      parsedData = JSON.parse(cleaned);
    } catch (err) {
      // Try best-effort repair of common issues (e.g. truncated JSON or trailing commas)
      try {
        const repaired = this.repairJson(cleaned);
        parsedData = JSON.parse(repaired);
      } catch (secondErr) {
        return {
          success: false,
          cards: [],
          totalParsed: 0,
          cardTypeCounts: {},
          duplicateCount: 0,
          errors: [`Invalid JSON: ${err instanceof Error ? err.message : 'Parse error'}`],
        };
      }
    }

    let rawCards: unknown[] = [];
    let detectedDeckName = '';

    if (Array.isArray(parsedData)) {
      rawCards = parsedData;
    } else if (parsedData && typeof parsedData === 'object') {
      const obj = parsedData as Record<string, unknown>;
      detectedDeckName = this.cleanString(obj.deckName ?? obj.deck ?? obj.studySetName ?? obj.studySet);

      if (Array.isArray(obj.cards)) {
        rawCards = obj.cards;
      } else if (Array.isArray(obj.questions)) {
        rawCards = obj.questions;
      } else if (Array.isArray(obj.items)) {
        rawCards = obj.items;
      } else {
        return {
          success: false,
          cards: [],
          totalParsed: 0,
          cardTypeCounts: {},
          duplicateCount: 0,
          errors: ['JSON object must contain a "cards" or "questions" array, or be an array of questions'],
        };
      }
    } else {
      return {
        success: false,
        cards: [],
        totalParsed: 0,
        cardTypeCounts: {},
        duplicateCount: 0,
        errors: ['Input is not a valid JSON array or object'],
      };
    }

    const existingKeys = new Set(existingCards.map((c) => getFlashcardDuplicateKey(c)));
    const seenBatchKeys = new Set<string>();

    const cards: ParsedJsonCard[] = [];
    const cardTypeCounts: Record<string, number> = {};
    let duplicateCount = 0;

    for (let i = 0; i < rawCards.length; i++) {
      const item = rawCards[i];
      if (!item || typeof item !== 'object') {
        continue;
      }

      const parsedCard = this.normalizeCard(item as Record<string, unknown>, detectedDeckName, i);
      if (!parsedCard) {
        continue;
      }

      const dupKey = getFlashcardDuplicateKey(parsedCard);
      const isDuplicate = existingKeys.has(dupKey) || seenBatchKeys.has(dupKey);
      if (isDuplicate) {
        parsedCard.isDuplicate = true;
        duplicateCount++;
      } else {
        seenBatchKeys.add(dupKey);
      }

      cards.push(parsedCard);
      cardTypeCounts[parsedCard.questionType] = (cardTypeCounts[parsedCard.questionType] ?? 0) + 1;
    }

    return {
      success: cards.length > 0,
      deckName: detectedDeckName || undefined,
      cards,
      totalParsed: cards.length,
      cardTypeCounts,
      duplicateCount,
      errors,
    };
  }

  /**
   * Imports a parsed batch of cards into the SpacedRepetitionDatabase.
   */
  async importParsedBatch(
    cards: ParsedJsonCard[],
    options?: JsonImportOptions
  ): Promise<JsonImportResult> {
    if (cards.length === 0) {
      return {
        importedCount: 0,
        skippedCount: 0,
        studySetId: '',
        studySetName: '',
        cardTypeCounts: {},
      };
    }

    const database = await this.plugin.services.ensureSpacedRepetitionDatabase();
    const fallbackDeckName = cards[0].deckName || 'Imported JSON Cards';
    const studySetName = (options?.customStudySetName || fallbackDeckName).trim() || 'Imported JSON Cards';

    // 1. Find or create Study Set
    const existingSets = database.getStudySets();
    let studySet = existingSets.find((s) => s.name.toLowerCase() === studySetName.toLowerCase());
    let studySetId = studySet?.id ?? '';

    if (!studySetId) {
      studySetId = await database.createStudySet({
        name: studySetName,
        description: `Imported from JSON on ${new Date().toLocaleDateString()}`,
        sourceType: 'manual',
        sourceRule: {
          type: 'json-import',
          importedAt: new Date().toISOString(),
        },
        tags: ['imported-json'],
      });
    }

    // 2. Filter duplicates if requested (default: true)
    const skipDuplicates = options?.skipDuplicates !== false;
    const cardsToImport = skipDuplicates ? cards.filter((c) => !c.isDuplicate) : cards;
    const skippedCount = cards.length - cardsToImport.length;

    // 3. Resolve note links
    const noteIdCache = new Map<string, string>();
    const resolveNoteId = async (notePath?: string | null): Promise<string | null> => {
      const path = notePath || options?.activeNotePath;
      if (!path) return null;
      if (noteIdCache.has(path)) return noteIdCache.get(path)!;

      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (file instanceof TFile) {
        const id = await database.upsertNoteFromFile(file, `json_import_${Date.now()}`);
        noteIdCache.set(path, id);
        return id;
      }
      return null;
    };

    const questionInputs: SpacedRepetitionQuestionInput[] = [];
    const cardTypeCounts: Record<string, number> = {};

    for (const card of cardsToImport) {
      const noteId = await resolveNoteId(card.notePath);

      questionInputs.push({
        studySetId,
        noteId,
        questionName: card.questionName || null,
        questionText: card.questionText,
        questionType: card.questionType,
        answerText: card.answerText ?? null,
        choices: card.choices ?? null,
        answerCheckMode: card.answerCheckMode,
        initialSchedule: card.initialSchedule,
        metadata: card.metadata,
      });

      cardTypeCounts[card.questionType] = (cardTypeCounts[card.questionType] ?? 0) + 1;
    }

    if (questionInputs.length > 0) {
      await database.createQuestions(questionInputs);
    }

    return {
      importedCount: questionInputs.length,
      skippedCount,
      studySetId,
      studySetName,
      cardTypeCounts,
    };
  }

  // ------------------------------------------------------------------
  // Normalization & Helpers
  // ------------------------------------------------------------------

  private normalizeCard(
    raw: Record<string, unknown>,
    defaultDeckName: string,
    index: number
  ): ParsedJsonCard | null {
    const questionText = this.cleanString(raw.questionText ?? raw.question ?? raw.prompt);
    if (!questionText) {
      return null;
    }

    let questionType = this.normalizeQuestionType(raw.questionType ?? raw.type);
    let answerText = this.cleanString(raw.answerText ?? raw.answer ?? raw.response);
    const rawChoices = raw.choices ?? raw.options;
    let choices = this.normalizeChoices(rawChoices);

    // If choices exist but questionType was not set to multiple_choice, auto-promote
    if (choices && choices.length >= 2 && questionType === 'self_check') {
      questionType = 'multiple_choice';
    }

    // Multiple choice: if choice objects were provided (e.g. [{text: 'A', isCorrect: true}])
    if (Array.isArray(rawChoices) && rawChoices.length > 0 && typeof rawChoices[0] === 'object' && rawChoices[0] !== null) {
      const extractedChoices: string[] = [];
      let detectedAnswer = '';
      for (const c of rawChoices) {
        if (c && typeof c === 'object') {
          const cObj = c as Record<string, unknown>;
          const text = this.cleanString(cObj.text ?? cObj.choice ?? cObj.label ?? cObj.value);
          if (text) {
            extractedChoices.push(text);
            if (cObj.isCorrect === true || cObj.correct === true) {
              detectedAnswer = text;
            }
          }
        }
      }
      if (extractedChoices.length >= 2) {
        choices = extractedChoices;
        questionType = 'multiple_choice';
        if (detectedAnswer && !answerText) {
          answerText = detectedAnswer;
        }
      }
    }

    // Typed fields exact normalization
    const metadata = (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata))
      ? { ...(raw.metadata as Record<string, unknown>) }
      : {};

    const rawFields = raw.fields ?? raw.exactFields ?? metadata.exactFields;
    const exactFields = this.normalizeExactFields(rawFields);

    if (exactFields && exactFields.length > 0) {
      if (questionType === 'self_check') {
        questionType = 'typed_fields_exact';
      }
      metadata.exactFields = exactFields;
      if (!answerText) {
        answerText = exactFields.map((f) => `${f.label}: ${f.answer}`).join('\n');
      }
    }

    // Fallback answer text for self-check or typed
    if (!answerText && questionType !== 'typed_fields_exact') {
      answerText = '';
    }

    // Determine answerCheckMode
    let answerCheckMode: AnswerCheckMode = 'self';
    const rawCheckMode = this.cleanString(raw.answerCheckMode ?? raw.checkMode).toLowerCase();
    if (rawCheckMode === 'exact' || rawCheckMode === 'llm' || rawCheckMode === 'self') {
      answerCheckMode = rawCheckMode as AnswerCheckMode;
    } else {
      if (questionType === 'typed_exact' || questionType === 'typed_fields_exact') {
        answerCheckMode = 'exact';
      } else if (questionType === 'typed_llm_checked') {
        answerCheckMode = 'llm';
      } else {
        answerCheckMode = 'self';
      }
    }

    // Schedule extraction
    let initialSchedule: ParsedJsonCard['initialSchedule'];
    const rawSchedule = raw.initialSchedule ?? raw.schedule;
    if (rawSchedule && typeof rawSchedule === 'object' && !Array.isArray(rawSchedule)) {
      const s = rawSchedule as Record<string, unknown>;
      initialSchedule = {
        intervalDays: typeof s.intervalDays === 'number' ? s.intervalDays : (typeof s.interval === 'number' ? s.interval : 0),
        ease: typeof s.ease === 'number' ? s.ease : 2.5,
        repetitionCount: typeof s.repetitionCount === 'number' ? s.repetitionCount : (typeof s.reps === 'number' ? s.reps : 0),
        lapseCount: typeof s.lapseCount === 'number' ? s.lapseCount : 0,
      };
    } else if (typeof raw.intervalDays === 'number' || typeof raw.interval === 'number') {
      initialSchedule = {
        intervalDays: typeof raw.intervalDays === 'number' ? raw.intervalDays : Number(raw.interval) || 0,
        ease: typeof raw.ease === 'number' ? raw.ease : 2.5,
        repetitionCount: typeof raw.repetitionCount === 'number' ? raw.repetitionCount : (typeof raw.reps === 'number' ? Number(raw.reps) : 0),
        lapseCount: typeof raw.lapseCount === 'number' ? raw.lapseCount : 0,
      };
    }

    // Tags & source
    if (Array.isArray(raw.tags)) {
      metadata.tags = raw.tags.map((t) => String(t).trim()).filter(Boolean);
    }
    const sourceExcerpt = this.cleanString(raw.sourceExcerpt ?? raw.sourceQuote);
    if (sourceExcerpt) {
      metadata.sourceExcerpt = sourceExcerpt;
    }
    const difficulty = this.cleanString(raw.difficulty);
    if (difficulty) {
      metadata.difficulty = difficulty;
    }
    const rubric = this.cleanString(raw.rubric);
    if (rubric) {
      metadata.rubric = rubric;
    }

    const deckName = this.cleanString(raw.deckName ?? raw.deck ?? raw.studySetName ?? defaultDeckName);
    const notePath = this.cleanString(raw.notePath ?? raw.sourcePath ?? raw.filePath);
    const questionName = this.cleanString(raw.questionName ?? raw.name) || null;

    return {
      questionName,
      questionText,
      questionType,
      answerText,
      choices,
      answerCheckMode,
      metadata,
      initialSchedule,
      notePath: notePath || null,
      deckName: deckName || null,
    };
  }

  private normalizeQuestionType(value: unknown): QuestionType {
    const clean = this.cleanString(value).toLowerCase().replace(/[\s-]/g, '_');
    if (VALID_QUESTION_TYPES.includes(clean as QuestionType)) {
      return clean as QuestionType;
    }
    if (clean === 'mc' || clean === 'multiplechoice' || clean === 'choice') {
      return 'multiple_choice';
    }
    if (clean === 'exact' || clean === 'typed') {
      return 'typed_exact';
    }
    if (clean === 'fields' || clean === 'typed_fields') {
      return 'typed_fields_exact';
    }
    if (clean === 'llm' || clean === 'llm_checked' || clean === 'semantic') {
      return 'typed_llm_checked';
    }
    return 'self_check';
  }

  private normalizeChoices(rawChoices: unknown): string[] | null {
    if (!Array.isArray(rawChoices)) {
      return null;
    }
    const result = rawChoices
      .map((c) => (typeof c === 'string' ? c.trim() : typeof c === 'number' ? String(c) : ''))
      .filter(Boolean);
    return result.length > 0 ? result : null;
  }

  private normalizeExactFields(rawFields: unknown): ExactAnswerField[] | null {
    if (!Array.isArray(rawFields) || rawFields.length === 0) {
      return null;
    }

    const fields: ExactAnswerField[] = [];
    for (let i = 0; i < rawFields.length; i++) {
      const item = rawFields[i];
      const normalized = normalizeExactAnswerField(item, i);
      if (normalized) {
        fields.push(normalized);
      }
    }

    return fields.length > 0 ? fields : null;
  }

  private extractJsonText(input: string): string {
    let text = stripThinkingTags(input).trim();

    // Strip markdown code fences if present (```json ... ``` or ``` ...)
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    // If there is still leading/trailing conversational text, find outer [ ... ] or { ... }
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');

    if (firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace)) {
      const lastBracket = text.lastIndexOf(']');
      if (lastBracket > firstBracket) {
        text = text.substring(firstBracket, lastBracket + 1);
      }
    } else if (firstBrace >= 0) {
      const lastBrace = text.lastIndexOf('}');
      if (lastBrace > firstBrace) {
        text = text.substring(firstBrace, lastBrace + 1);
      }
    }

    return text.trim();
  }

  private repairJson(jsonStr: string): string {
    let repaired = jsonStr.trim();
    // Remove trailing commas before closing braces/brackets
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    return repaired;
  }

  private cleanString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
