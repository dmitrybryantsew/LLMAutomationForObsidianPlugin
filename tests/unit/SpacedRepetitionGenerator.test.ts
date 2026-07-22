import { describe, expect, it } from 'vitest';
import { SpacedRepetitionGenerator } from '../../src/utils/spacedRepetition/SpacedRepetitionGenerator';

describe('SpacedRepetitionGenerator', () => {
  const generator = new SpacedRepetitionGenerator({} as any);

  it('parses valid generated question JSON', () => {
    const questions = generator.parseGeneratedQuestions(JSON.stringify({
      questions: [
        {
          questionName: 'Definition',
          questionText: 'What is spaced repetition?',
          questionType: 'self_check',
          answerText: 'A review method that schedules items by memory strength.',
          answerCheckMode: 'self',
          tags: ['memory'],
          sourceQuote: 'schedules items by memory strength',
        },
      ],
    }));

    expect(questions).toHaveLength(1);
    expect(questions[0].questionType).toBe('self_check');
    expect(questions[0].answerCheckMode).toBe('self');
    expect(questions[0].metadata?.tags).toEqual(['memory']);
    expect(questions[0].source?.sourceExcerpt).toBe('schedules items by memory strength');
  });

  it('extracts JSON from markdown fenced output', () => {
    const questions = generator.parseGeneratedQuestions(`
Thinking about the note...

\`\`\`json
{
  "questions": [
    {
      "questionText": "Type the command.",
      "questionType": "typed_exact",
      "answerText": "npm run build",
      "answerCheckMode": "self"
    }
  ]
}
\`\`\`
`);

    expect(questions).toHaveLength(1);
    expect(questions[0].questionType).toBe('typed_exact');
    expect(questions[0].answerCheckMode).toBe('exact');
  });

  it('requires exactly four choices for multiple choice questions', () => {
    const questions = generator.validateGeneratedQuestions([
      {
        questionText: 'Which grade means easy?',
        questionType: 'multiple_choice',
        answerText: '4',
        choices: ['0', '1', '4'],
      },
      {
        questionText: 'Which grade means easy?',
        questionType: 'multiple_choice',
        answerText: '4',
        choices: ['0', '1', '2', '4'],
      },
    ]);

    expect(questions).toHaveLength(1);
    expect(questions[0].choices).toEqual(['0', '1', '2', '4']);
  });

  it('parses typed exact field questions', () => {
    const questions = generator.validateGeneratedQuestions([
      {
        questionText: 'Fill the exact pieces of the LINQ call that filters adults.',
        questionType: 'typed_fields_exact',
        answerCheckMode: 'exact',
        metadata: {
          exactFields: [
            { id: 'method', label: 'Method', answer: 'Where' },
            { id: 'predicate', label: 'Predicate', answer: 'x => x.Age >= 18', normalization: 'csharp', aliases: ['person => person.Age >= 18'] },
          ],
        },
      },
    ]);

    expect(questions).toHaveLength(1);
    expect(questions[0].questionType).toBe('typed_fields_exact');
    expect(questions[0].answerCheckMode).toBe('exact');
    expect(questions[0].answerText).toContain('Method: Where');
    expect(questions[0].metadata?.exactFields).toEqual([
      { id: 'method', label: 'Method', answer: 'Where', placeholder: null },
      {
        id: 'predicate',
        label: 'Predicate',
        answer: 'x => x.Age >= 18',
        placeholder: null,
        aliases: ['person => person.Age >= 18'],
        normalization: 'csharp',
      },
    ]);
  });

  it('throws when no valid questions are present', () => {
    expect(() => generator.validateGeneratedQuestions([
      { questionText: 'Missing answer' },
    ])).toThrow('The selected provider did not return any valid review questions');
  });
});
