import path from 'path';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { SpacedRepetitionDatabase } from '../../src/utils/spacedRepetition/SpacedRepetitionDatabase';
import { SpacedRepetitionScheduler } from '../../src/utils/spacedRepetition/SpacedRepetitionScheduler';

function createBinaryAdapterApp() {
  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>();

  return {
    files,
    app: {
      vault: {
        adapter: {
          exists: async (filePath: string) => files.has(filePath) || folders.has(filePath),
          mkdir: async (folderPath: string) => {
            folders.add(folderPath);
          },
          readBinary: async (filePath: string) => {
            const bytes = files.get(filePath);
            if (!bytes) {
              throw new Error(`Missing file: ${filePath}`);
            }
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          },
          writeBinary: async (filePath: string, data: ArrayBuffer) => {
            files.set(filePath, new Uint8Array(data));
          },
        },
      },
    },
  };
}

describe('SpacedRepetitionDatabase', () => {
  const wasmPath = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const adapterWasmPath = '.obsidian/plugins/gpt4free-text-generator-plugin/sql-wasm.wasm';

  function createAppWithAdapterWasm() {
    const setup = createBinaryAdapterApp();
    setup.files.set(adapterWasmPath, readFileSync(wasmPath));
    return setup;
  }

  it('creates the SQLite file and stores note questions', async () => {
    const { app, files } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/Test.md', basename: 'Test' } as any, 'hash-1');
    await database.createQuestions([{
      noteId,
      questionText: 'What is the key idea?',
      questionType: 'self_check',
      answerText: 'The key idea.',
      answerCheckMode: 'self',
      nextRepeatAt: '2026-06-03T07:00:00.000Z',
    }]);

    const due = database.getDueQuestions(new Date('2026-06-03T08:00:00.000Z'));

    expect(files.has('.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite')).toBe(true);
    expect(due).toHaveLength(1);
    expect(due[0].noteId).toBe(noteId);
    expect(due[0].questionText).toBe('What is the key idea?');

    await database.close();
  });

  it('allows repeated initialize calls before writes', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/Repeated.md', basename: 'Repeated' } as any, 'hash');

    expect(noteId).toContain('note_');

    await database.close();
  });

  it('loads sql.js wasm through the vault adapter', async () => {
    const { app } = createAppWithAdapterWasm();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath: adapterWasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/AdapterWasm.md', basename: 'AdapterWasm' } as any, 'hash');

    expect(noteId).toContain('note_');

    await database.close();
  });

  it('stores study sets and cross-note question sources', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteA = await database.upsertNoteFromFile({ path: 'Notes/A.md', basename: 'A' } as any, 'hash-a');
    const noteB = await database.upsertNoteFromFile({ path: 'Notes/B.md', basename: 'B' } as any, 'hash-b');
    const studySetId = await database.createStudySet({
      name: 'A and B',
      sourceType: 'manual',
      sourceRule: { type: 'manual', notePaths: ['Notes/A.md', 'Notes/B.md'] },
      tags: ['example'],
    });
    await database.setStudySetNotes(studySetId, [noteA, noteB]);
    const [questionId] = await database.createQuestions([{
      studySetId,
      questionText: 'How do A and B relate?',
      questionType: 'self_check',
      answerText: 'They are connected.',
      answerCheckMode: 'self',
      nextRepeatAt: '2026-06-03T07:00:00.000Z',
    }]);
    await database.recordQuestionSources(questionId, [
      { noteId: noteA, sourceLabel: 'A' },
      { noteId: noteB, sourceLabel: 'B' },
    ]);

    const studySets = database.getStudySets();
    const stats = database.getStudySetReviewStats(new Date('2026-06-03T08:00:00.000Z'));
    const due = database.getDueQuestions(new Date('2026-06-03T08:00:00.000Z'));

    expect(studySets).toHaveLength(1);
    expect(studySets[0].sourceRule).toEqual({ type: 'manual', notePaths: ['Notes/A.md', 'Notes/B.md'] });
    expect(stats[0].totalCount).toBe(1);
    expect(stats[0].dueCount).toBe(1);
    expect(due).toHaveLength(1);
    expect(due[0].studySetId).toBe(studySetId);
    expect(due[0].noteId).toBeNull();

    await database.close();
  });

  it('records reviews and delays grade 0 reask cards', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });
    const scheduler = new SpacedRepetitionScheduler({ gradeZeroReaskDelay: 1 });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/Test.md', basename: 'Test' } as any, 'hash-1');
    const [againId, otherId] = await database.createQuestions([
      {
        noteId,
        questionText: 'Again?',
        questionType: 'self_check',
        answerText: 'Again answer.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-03T07:00:00.000Z',
      },
      {
        noteId,
        questionText: 'Other?',
        questionType: 'self_check',
        answerText: 'Other answer.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-03T07:00:00.000Z',
      },
    ]);

    const againState = database.getQuestionReviewState(againId);
    await database.recordReview(
      { questionId: againId, grade: 0 },
      scheduler.scheduleReview(againState, 0, new Date('2026-06-03T08:00:00.000Z')),
      new Date('2026-06-03T08:00:00.000Z')
    );

    let due = database.getDueQuestions(new Date('2026-06-03T08:00:01.000Z'));
    expect(due.map((card) => card.id)).toEqual([otherId]);

    const otherState = database.getQuestionReviewState(otherId);
    await database.recordReview(
      { questionId: otherId, grade: 3 },
      scheduler.scheduleReview(otherState, 3, new Date('2026-06-03T08:01:00.000Z')),
      new Date('2026-06-03T08:01:00.000Z')
    );

    due = database.getDueQuestions(new Date('2026-06-03T08:01:01.000Z'));
    expect(due.map((card) => card.id)).toEqual([againId]);

    await database.close();
  });

  it('can query all cards for cram sessions regardless of due date', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/Cram.md', basename: 'Cram' } as any, 'hash-cram');
    await database.createQuestions([
      {
        noteId,
        questionText: 'Due now?',
        questionType: 'self_check',
        answerText: 'Yes.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-03T07:00:00.000Z',
      },
      {
        noteId,
        questionText: 'Due later?',
        questionType: 'self_check',
        answerText: 'Not yet.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-05T07:00:00.000Z',
      },
    ]);

    const dueOnly = database.getReviewQuestions({ now: new Date('2026-06-03T08:00:00.000Z'), noteId });
    const ungroupedOnly = database.getReviewQuestions({
      now: new Date('2026-06-03T08:00:00.000Z'),
      studySetId: null,
      includeNotDue: true,
    });
    const cram = database.getReviewQuestions({
      now: new Date('2026-06-03T08:00:00.000Z'),
      noteId,
      includeNotDue: true,
    });

    expect(dueOnly.map((card) => card.questionText)).toEqual(['Due now?']);
    expect(ungroupedOnly).toHaveLength(2);
    expect(cram.map((card) => card.questionText)).toEqual(['Due now?', 'Due later?']);

    await database.close();
  });

  it('can bury and suspend cards from review queues', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/Queue.md', basename: 'Queue' } as any, 'hash-queue');
    const [buryId, suspendId] = await database.createQuestions([
      {
        noteId,
        questionText: 'Bury me?',
        questionType: 'self_check',
        answerText: 'Tomorrow.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-03T07:00:00.000Z',
      },
      {
        noteId,
        questionText: 'Suspend me?',
        questionType: 'self_check',
        answerText: 'Disabled.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-03T07:00:00.000Z',
      },
    ]);

    await database.updateQuestionDueState({ questionId: buryId, nextRepeatAt: '2026-06-04T06:00:00.000Z' });
    await database.setQuestionEnabled(suspendId, false);

    const due = database.getReviewQuestions({ now: new Date('2026-06-03T08:00:00.000Z'), noteId });
    const cram = database.getReviewQuestions({
      now: new Date('2026-06-03T08:00:00.000Z'),
      noteId,
      includeNotDue: true,
    });

    expect(due).toHaveLength(0);
    expect(cram.map((card) => card.id)).toEqual([buryId]);

    await database.close();
  });

  it('archives cards out of review queues without deleting them', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/Archive.md', basename: 'Archive' } as any, 'hash-archive');
    const [cardId] = await database.createQuestions([{
      noteId,
      questionText: 'Archive me?',
      questionType: 'self_check',
      answerText: 'Keep for later.',
      answerCheckMode: 'self',
      nextRepeatAt: '2026-06-03T07:00:00.000Z',
    }]);

    await database.setQuestionArchived(cardId, true);

    const due = database.getReviewQuestions({
      now: new Date('2026-06-03T08:00:00.000Z'),
      noteId,
      includeNotDue: true,
    });
    const archived = database.getCardsForManagement({ archived: true, search: 'Archive me' });
    const available = database.getCardsForManagement({ archived: false, search: 'Archive me' });

    expect(due).toHaveLength(0);
    expect(archived).toHaveLength(1);
    expect(archived[0].archivedAt).not.toBeNull();
    expect(available).toHaveLength(0);

    await database.setQuestionArchived(cardId, false);
    const restored = database.getReviewQuestions({
      now: new Date('2026-06-03T08:00:00.000Z'),
      noteId,
      includeNotDue: true,
    });

    expect(restored.map((card) => card.id)).toEqual([cardId]);

    await database.close();
  });

  it('moves note cards between decks and keeps deck metadata in sync', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/DeckMove.md', basename: 'DeckMove' } as any, 'hash-move');
    const deckA = await database.createStudySet({ name: 'Deck A', sourceType: 'manual', sourceRule: { type: 'manual' } });
    const deckB = await database.createStudySet({ name: 'Deck B', sourceType: 'manual', sourceRule: { type: 'manual' } });
    const [cardId] = await database.createQuestions([{
      noteId,
      studySetId: deckA,
      questionText: 'Which deck should this be in?',
      questionType: 'self_check',
      answerText: 'Deck B.',
      answerCheckMode: 'self',
      metadata: { deckName: 'Deck A' },
      nextRepeatAt: '2026-06-03T07:00:00.000Z',
    }]);

    await database.setQuestionStudySet(cardId, deckB);
    let cards = database.getCardsForManagement({ studySetId: deckB, search: 'Which deck' });

    expect(cards).toHaveLength(1);
    expect(cards[0].studySetId).toBe(deckB);
    expect(cards[0].studySetName).toBe('Deck B');
    expect(cards[0].metadata.deckName).toBe('Deck B');

    await database.setQuestionStudySet(cardId, null);
    cards = database.getCardsForManagement({ studySetId: null, search: 'Which deck' });

    expect(cards).toHaveLength(1);
    expect(cards[0].studySetId).toBeNull();
    expect(cards[0].metadata.deckName).toBeUndefined();

    await database.close();
  });

  it('moves deck-only cards between decks but does not orphan them', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const deckA = await database.createStudySet({ name: 'Deck Only A', sourceType: 'manual', sourceRule: { type: 'manual' } });
    const deckB = await database.createStudySet({ name: 'Deck Only B', sourceType: 'manual', sourceRule: { type: 'manual' } });
    const [cardId] = await database.createQuestions([{
      studySetId: deckA,
      questionText: 'Deck-only card?',
      questionType: 'self_check',
      answerText: 'Still needs a deck.',
      answerCheckMode: 'self',
      metadata: { deckName: 'Deck Only A' },
      nextRepeatAt: '2026-06-03T07:00:00.000Z',
    }]);

    await database.setQuestionStudySet(cardId, deckB);
    const moved = database.getCardsForManagement({ studySetId: deckB, search: 'Deck-only' });

    expect(moved).toHaveLength(1);
    expect(moved[0].studySetName).toBe('Deck Only B');
    expect(moved[0].metadata.deckName).toBe('Deck Only B');
    await expect(database.setQuestionStudySet(cardId, null)).rejects.toThrow('Cannot move a deck-only card to No deck');

    await database.close();
  });

  it('renames, disables, enables, and deletes empty decks', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const deckId = await database.createStudySet({
      name: 'Old Deck',
      description: 'Old description',
      sourceType: 'manual',
      sourceRule: { type: 'manual' },
    });
    const emptyDeckId = await database.createStudySet({
      name: 'Empty Deck',
      sourceType: 'manual',
      sourceRule: { type: 'manual' },
    });
    const [cardId] = await database.createQuestions([{
      studySetId: deckId,
      questionText: 'Deck management?',
      questionType: 'self_check',
      answerText: 'Rename and disable.',
      answerCheckMode: 'self',
      metadata: { deckName: 'Old Deck' },
      nextRepeatAt: '2026-06-03T07:00:00.000Z',
    }]);

    await database.updateStudySet({ studySetId: deckId, name: 'Renamed Deck', description: 'Updated description' });
    let stats = database.getStudySetReviewStats(new Date('2026-06-03T08:00:00.000Z'));
    let renamed = stats.find((deck) => deck.studySetId === deckId);
    let [card] = database.getCardsForManagement({ studySetId: deckId, search: 'Deck management' });

    expect(renamed?.name).toBe('Renamed Deck');
    expect(renamed?.description).toBe('Updated description');
    expect(card.metadata.deckName).toBe('Renamed Deck');

    await database.setQuestionEnabled(cardId, false);
    stats = database.getStudySetReviewStats(new Date('2026-06-03T08:00:00.000Z'));
    renamed = stats.find((deck) => deck.studySetId === deckId);
    expect(renamed?.suspendedCount).toBe(1);
    expect(renamed?.archivedCount).toBe(0);

    await database.setQuestionArchived(cardId, true);
    stats = database.getStudySetReviewStats(new Date('2026-06-03T08:00:00.000Z'));
    renamed = stats.find((deck) => deck.studySetId === deckId);
    expect(renamed?.suspendedCount).toBe(0);
    expect(renamed?.archivedCount).toBe(1);

    await database.setQuestionArchived(cardId, false);
    await database.setQuestionEnabled(cardId, true);
    expect(database.getReviewQuestions({ now: new Date('2026-06-03T08:00:00.000Z'), studySetId: deckId })).toHaveLength(1);

    await database.setStudySetEnabled(deckId, false);
    expect(database.getReviewQuestions({
      now: new Date('2026-06-03T08:00:00.000Z'),
      studySetId: deckId,
      includeNotDue: true,
    })).toHaveLength(0);
    stats = database.getStudySetReviewStats(new Date('2026-06-03T08:00:00.000Z'));
    renamed = stats.find((deck) => deck.studySetId === deckId);
    expect(renamed?.enabled).toBe(false);

    await database.setStudySetEnabled(deckId, true);
    expect(database.getReviewQuestions({
      now: new Date('2026-06-03T08:00:00.000Z'),
      studySetId: deckId,
      includeNotDue: true,
    })).toHaveLength(1);

    await expect(database.deleteEmptyStudySet(deckId)).rejects.toThrow('Only empty decks can be deleted');
    await database.deleteEmptyStudySet(emptyDeckId);
    expect(database.getStudySets().some((deck) => deck.id === emptyDeckId)).toBe(false);

    await database.close();
  });

  it('reports review stats, due forecast, and hardest cards', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });
    const scheduler = new SpacedRepetitionScheduler({ gradeZeroReaskDelay: 1 });

    await database.initialize();
    const deckId = await database.createStudySet({
      name: 'Stats Deck',
      sourceType: 'manual',
      sourceRule: { type: 'manual' },
    });
    const [hardId, easyId, futureId] = await database.createQuestions([
      {
        studySetId: deckId,
        questionName: 'Hard card',
        questionText: 'Hard stats card?',
        questionType: 'self_check',
        answerText: 'Often missed.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-03T07:00:00.000Z',
      },
      {
        studySetId: deckId,
        questionName: 'Easy card',
        questionText: 'Easy stats card?',
        questionType: 'self_check',
        answerText: 'Usually known.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-03T07:00:00.000Z',
      },
      {
        studySetId: deckId,
        questionName: 'Future card',
        questionText: 'Future stats card?',
        questionType: 'self_check',
        answerText: 'Due tomorrow.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-04T07:00:00.000Z',
      },
    ]);

    const hardState = database.getQuestionReviewState(hardId);
    await database.recordReview(
      { questionId: hardId, grade: 0, elapsedMs: 1200 },
      scheduler.scheduleReview(hardState, 0, new Date('2026-06-03T08:00:00.000Z')),
      new Date('2026-06-03T08:00:00.000Z')
    );
    const easyState = database.getQuestionReviewState(easyId);
    await database.recordReview(
      { questionId: easyId, grade: 4, elapsedMs: 900 },
      scheduler.scheduleReview(easyState, 4, new Date('2026-06-03T09:00:00.000Z')),
      new Date('2026-06-03T09:00:00.000Z')
    );
    await database.recordReview(
      { questionId: easyId, grade: 3, elapsedMs: 1000 },
      scheduler.scheduleReview(database.getQuestionReviewState(easyId), 3, new Date('2026-05-30T09:00:00.000Z')),
      new Date('2026-05-30T09:00:00.000Z')
    );

    const stats = database.getReviewStats(new Date('2026-06-03T12:00:00.000Z'));

    expect(stats.reviewedToday).toBe(2);
    expect(stats.reviewedLast7Days).toBe(3);
    expect(stats.lapsesLast30Days).toBe(1);
    expect(stats.gradeDistributionLast30Days).toEqual([
      { grade: 0, count: 1 },
      { grade: 1, count: 0 },
      { grade: 2, count: 0 },
      { grade: 3, count: 1 },
      { grade: 4, count: 1 },
    ]);
    expect(stats.dueForecast[0]).toEqual({ date: '2026-06-03', dueCount: 0 });
    expect(stats.dueForecast[1]).toEqual({ date: '2026-06-04', dueCount: 1 });
    expect(stats.hardestCards[0].questionId).toBe(hardId);
    expect(stats.hardestCards[0].lapseCount).toBe(1);

    await database.close();
  });

  it('supports card management search, editing, and restore', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/Manage.md', basename: 'Manage' } as any, 'hash-manage');
    const [cardId] = await database.createQuestions([{
      noteId,
      questionName: 'Original name',
      questionText: 'What does SelectMany do?',
      questionType: 'typed_exact',
      answerText: 'It flattens projected sequences.',
      answerCheckMode: 'exact',
      nextRepeatAt: '2026-06-03T07:00:00.000Z',
    }]);

    await database.setQuestionEnabled(cardId, false);
    let cards = database.getCardsForManagement({ enabled: false, search: 'SelectMany' });
    expect(cards).toHaveLength(1);
    expect(cards[0].enabled).toBe(false);
    expect(cards[0].notePath).toBe('Notes/Manage.md');

    await database.updateQuestionContent({
      questionId: cardId,
      questionName: 'Updated name',
      questionText: 'What does Enumerable.SelectMany do?',
      answerText: 'It maps each source item to a sequence and flattens the results.',
    });
    await database.setQuestionEnabled(cardId, true);

    cards = database.getCardsForManagement({ enabled: true, questionType: 'typed_exact', search: 'Enumerable' });
    expect(cards).toHaveLength(1);
    expect(cards[0].questionName).toBe('Updated name');
    expect(cards[0].questionText).toBe('What does Enumerable.SelectMany do?');
    expect(cards[0].answerText).toBe('It maps each source item to a sequence and flattens the results.');

    await database.close();
  });

  it('updates typed exact field metadata from card management edits', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/ExactFields.md', basename: 'ExactFields' } as any, 'hash-fields');
    const [cardId] = await database.createQuestions([{
      noteId,
      questionText: 'Fill in the LINQ call parts.',
      questionType: 'typed_fields_exact',
      answerText: 'Method: Select',
      answerCheckMode: 'exact',
      metadata: {
        exactFields: [
          { id: 'method', label: 'Method', answer: 'Select', placeholder: 'Type method' },
        ],
      },
      nextRepeatAt: '2026-06-03T07:00:00.000Z',
    }]);

    await database.updateQuestionContent({
      questionId: cardId,
      questionText: 'Fill in the LINQ projection call parts.',
      answerText: 'Method: SelectMany\nParameter: collectionSelector',
      metadata: {
        exactFields: [
          { id: 'method', label: 'Method', answer: 'SelectMany', placeholder: 'Type Method' },
          { id: 'parameter', label: 'Parameter', answer: 'collectionSelector', placeholder: 'Type Parameter' },
        ],
      },
    });

    const [card] = database.getCardsForManagement({ questionType: 'typed_fields_exact', search: 'projection' });

    expect(card.questionText).toBe('Fill in the LINQ projection call parts.');
    expect(card.answerText).toBe('Method: SelectMany\nParameter: collectionSelector');
    expect(card.metadata.exactFields).toEqual([
      { id: 'method', label: 'Method', answer: 'SelectMany', placeholder: 'Type Method' },
      { id: 'parameter', label: 'Parameter', answer: 'collectionSelector', placeholder: 'Type Parameter' },
    ]);

    await database.close();
  });

  it('stores note chat messages linked to a note', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/Chat.md', basename: 'Chat' } as any, 'hash-chat');
    const chatId = await database.createNoteChat(noteId, 'Chat test');
    await database.addNoteChatMessage({ chatId, role: 'user', content: 'What matters here?' });
    await database.addNoteChatMessage({ chatId, role: 'assistant', content: 'The review loop matters.' });

    const latestChat = database.getLatestNoteChat(noteId);
    const messages = database.getNoteChatMessages(chatId);

    expect(latestChat?.id).toBe(chatId);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1].content).toBe('The review loop matters.');

    await database.close();
  });

  it('lists all note chats newest first', async () => {
    const { app } = createBinaryAdapterApp();
    const database = new SpacedRepetitionDatabase(app as any, {
      dbPath: '.obsidian/plugins/gpt4free-text-generator-plugin/spaced-repetition.sqlite',
      wasmPath,
    });

    await database.initialize();
    const noteId = await database.upsertNoteFromFile({ path: 'Notes/MultiChat.md', basename: 'MultiChat' } as any, 'hash-chat');
    const firstChatId = await database.createNoteChat(noteId, 'First chat');
    const secondChatId = await database.createNoteChat(noteId, 'Second chat');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await database.addNoteChatMessage({ chatId: firstChatId, role: 'user', content: 'Older but active again' });

    const chats = database.getNoteChats(noteId);

    expect(chats).toHaveLength(2);
    expect(chats.map((chat) => chat.id)).toEqual([firstChatId, secondChatId]);
    expect(chats.map((chat) => chat.title)).toEqual(['First chat', 'Second chat']);

    await database.close();
  });
});
