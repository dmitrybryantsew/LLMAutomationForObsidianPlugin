import path from 'path';
import { describe, expect, it } from 'vitest';
import { SpacedRepetitionDatabase } from '../../src/utils/spacedRepetition/SpacedRepetitionDatabase';

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
});
