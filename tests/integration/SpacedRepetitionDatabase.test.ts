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
    await database.createQuestions([
      {
        noteId,
        questionText: 'What is the key idea?',
        questionType: 'self_check',
        answerText: 'The key idea.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-03T07:00:00.000Z',
      },
    ]);

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
    const [questionId] = await database.createQuestions([
      {
        studySetId,
        questionText: 'How do A and B relate?',
        questionType: 'self_check',
        answerText: 'They are connected.',
        answerCheckMode: 'self',
        nextRepeatAt: '2026-06-03T07:00:00.000Z',
      },
    ]);
    await database.recordQuestionSources(questionId, [
      { noteId: noteA, sourceLabel: 'A' },
      { noteId: noteB, sourceLabel: 'B' },
    ]);

    const studySets = database.getStudySets();
    const due = database.getDueQuestions(new Date('2026-06-03T08:00:00.000Z'));

    expect(studySets).toHaveLength(1);
    expect(studySets[0].sourceRule).toEqual({ type: 'manual', notePaths: ['Notes/A.md', 'Notes/B.md'] });
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
});
