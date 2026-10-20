import { describe, expect, it, vi } from 'vitest';
import { SpacedRepetitionJsonImporter } from '../../src/utils/spacedRepetition/SpacedRepetitionJsonImporter';

describe('SpacedRepetitionJsonImporter', () => {
  const mockApp = {
    vault: {
      getAbstractFileByPath: vi.fn(),
    },
  } as any;

  const mockPlugin = {
    services: {
      ensureSpacedRepetitionDatabase: vi.fn(),
    },
  } as any;

  it('parses bare JSON array of questions', () => {
    const importer = new SpacedRepetitionJsonImporter(mockApp, mockPlugin);
    const input = JSON.stringify([
      {
        questionText: 'What is C# struct?',
        answerText: 'A value type',
        questionType: 'self_check',
      },
      {
        questionText: 'What keyword defines a constant?',
        answerText: 'const',
        questionType: 'typed_exact',
      },
    ]);

    const result = importer.parseJsonContent(input);
    expect(result.success).toBe(true);
    expect(result.totalParsed).toBe(2);
    expect(result.cards[0].questionType).toBe('self_check');
    expect(result.cards[0].answerCheckMode).toBe('self');
    expect(result.cards[1].questionType).toBe('typed_exact');
    expect(result.cards[1].answerCheckMode).toBe('exact');
  });

  it('parses LLM format with deckName and questions envelope', () => {
    const importer = new SpacedRepetitionJsonImporter(mockApp, mockPlugin);
    const input = `
    Here are the flashcards you requested:
    \`\`\`json
    {
      "deckName": "CSharp/Advanced",
      "questions": [
        {
          "questionText": "What does async/await do?",
          "choices": [
            "Yields control until awaited task completes",
            "Creates a new background thread",
            "Freezes the UI",
            "Executes synchronously"
          ],
          "answerText": "Yields control until awaited task completes",
          "difficulty": "medium"
        },
        {
          "questionText": "LINQ Select signature",
          "questionType": "typed_fields_exact",
          "fields": [
            { "label": "Return type", "answer": "IEnumerable<TResult>" },
            { "label": "Method", "answer": "Select", "aliases": ["Enumerable.Select"] }
          ]
        }
      ]
    }
    \`\`\`
    Hope this helps!
    `;

    const result = importer.parseJsonContent(input);
    expect(result.success).toBe(true);
    expect(result.deckName).toBe('CSharp/Advanced');
    expect(result.totalParsed).toBe(2);

    // Question 1 auto-promoted to multiple_choice
    expect(result.cards[0].questionType).toBe('multiple_choice');
    expect(result.cards[0].choices?.length).toBe(4);
    expect(result.cards[0].answerCheckMode).toBe('self');
    expect(result.cards[0].metadata.difficulty).toBe('medium');

    // Question 2 typed_fields_exact
    expect(result.cards[1].questionType).toBe('typed_fields_exact');
    expect(result.cards[1].answerCheckMode).toBe('exact');
    const fields = result.cards[1].metadata.exactFields as any[];
    expect(fields.length).toBe(2);
    expect(fields[0].label).toBe('Return type');
    expect(fields[1].aliases).toContain('Enumerable.Select');
  });

  it('parses FlashcardExport format with cards array', () => {
    const importer = new SpacedRepetitionJsonImporter(mockApp, mockPlugin);
    const input = JSON.stringify({
      exportedAt: '2026-10-19T20:00:00.000Z',
      cards: [
        {
          questionText: 'Explain GC Mark & Sweep',
          questionType: 'typed_llm_checked',
          answerText: 'Traverses roots to mark live objects, then sweeps unreachable memory',
          rubric: 'Must mention roots and live objects',
          schedule: {
            intervalDays: 14,
            ease: 2.6,
            repetitionCount: 3,
          },
        },
      ],
    });

    const result = importer.parseJsonContent(input);
    expect(result.success).toBe(true);
    expect(result.cards[0].questionType).toBe('typed_llm_checked');
    expect(result.cards[0].answerCheckMode).toBe('llm');
    expect(result.cards[0].initialSchedule?.intervalDays).toBe(14);
    expect(result.cards[0].initialSchedule?.ease).toBe(2.6);
    expect(result.cards[0].metadata.rubric).toBe('Must mention roots and live objects');
  });

  it('detects duplicates against existing cards', () => {
    const importer = new SpacedRepetitionJsonImporter(mockApp, mockPlugin);
    const existingCards = [
      {
        questionType: 'self_check',
        questionText: 'What is Unity?',
        answerText: 'A game engine',
      },
    ];

    const input = JSON.stringify([
      {
        questionText: 'What is Unity?',
        answerText: 'A game engine',
        questionType: 'self_check',
      },
      {
        questionText: 'What is Unreal?',
        answerText: 'Another game engine',
        questionType: 'self_check',
      },
    ]);

    const result = importer.parseJsonContent(input, existingCards);
    expect(result.totalParsed).toBe(2);
    expect(result.duplicateCount).toBe(1);
    expect(result.cards[0].isDuplicate).toBe(true);
    expect(result.cards[1].isDuplicate).toBeFalsy();
  });

  it('handles invalid or empty JSON gracefully', () => {
    const importer = new SpacedRepetitionJsonImporter(mockApp, mockPlugin);
    const emptyResult = importer.parseJsonContent('');
    expect(emptyResult.success).toBe(false);
    expect(emptyResult.errors.length).toBeGreaterThan(0);

    const corruptResult = importer.parseJsonContent('{ not valid json');
    expect(corruptResult.success).toBe(false);
    expect(corruptResult.errors[0]).toContain('Invalid JSON');
  });
});
