import { describe, expect, it, vi } from 'vitest';
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

  it('strips qwen3 thinking blocks before parsing', () => {
    const questions = generator.parseGeneratedQuestions(
      'Let me look at this excerpt carefully.\n\n\n\n{"questions":[{"questionText":"Q?","answerText":"A","questionType":"self_check"}]}',
    );

    expect(questions).toHaveLength(1);
    expect(questions[0].questionText).toBe('Q?');
  });

  it('repairs JSON truncated by a max_tokens cutoff', () => {
    const full = JSON.stringify({
      questions: [
        { questionText: 'Q1?', answerText: 'A1', questionType: 'self_check' },
        { questionText: 'Q2?', answerText: 'A2', questionType: 'self_check' },
        { questionText: 'Q3?', answerText: 'A3', questionType: 'self_check' },
        { questionText: 'Q4?', answerText: 'A4', questionType: 'self_check' },
        { questionText: 'Q5?', answerText: 'A5', questionType: 'self_check' },
      ],
    });
    // Simulate a stream cut mid-way through the last question's string.
    const truncated = full.slice(0, full.indexOf('"A5"') + 1);

    const questions = generator.parseGeneratedQuestions(truncated);

    expect(questions.length).toBeGreaterThanOrEqual(4);
    expect(questions.map((q) => q.questionText)).toContain('Q1?');
    expect(questions.map((q) => q.questionText)).toContain('Q4?');
  });

  it('dedupes near-identical question texts', () => {
    const questions = generator.parseGeneratedQuestions(JSON.stringify({
      questions: [
        { questionText: 'What is spaced repetition?', answerText: 'A scheduling method.', questionType: 'self_check' },
        { questionText: 'What is spaced repetition?', answerText: 'A scheduling method.', questionType: 'self_check' },
        { questionText: 'What is spaced repetition?', answerText: 'Different answer, same question.', questionType: 'self_check' },
        { questionText: 'What is active recall?', answerText: 'Testing yourself.', questionType: 'self_check' },
      ],
    }));

    expect(questions).toHaveLength(2);
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

describe('SpacedRepetitionGenerator research pipeline', () => {
  const fakeFile = { path: 'book.pdf', basename: 'book' } as any;

  function makeGenerator(output: string, outputs: string[] = []) {
    const generateText = vi.fn()
      .mockResolvedValueOnce({ output: outputs[0] ?? output })
      .mockResolvedValueOnce({ output: outputs[1] ?? output });
    const client = { generateText };
    const generator = new SpacedRepetitionGenerator({
      getClient: () => client,
      getClientForProvider: () => client,
    } as any);
    return { generator, generateText };
  }

  const options: any = {
    file: fakeFile,
    noteContent: 'Spaced repetition schedules reviews by memory strength.',
    provider: 'proxy',
    model: 'gpt-4o',
    questionCount: 2,
    questionTypes: ['self_check'],
  };

  it('runs two-pass pipeline: concepts first, then grounded questions', async () => {
    const conceptsJson = JSON.stringify({
      concepts: [{ name: 'Spaced repetition', summary: 'Scheduling reviews by memory strength.', sourceQuote: 'memory strength' }],
    });
    const questionsJson = JSON.stringify({
      questions: [
        { questionText: 'What schedules reviews?', answerText: 'Memory strength.', questionType: 'self_check' },
      ],
    });

    const { generator, generateText } = makeGenerator('', [conceptsJson, questionsJson]);
    const progress: string[] = [];
    const questions = (await generator.generateQuestionsForNote({
      ...options,
      twoPass: true,
      onProgress: (stage: string) => progress.push(stage),
    })).questions;

    expect(generateText).toHaveBeenCalledTimes(2);
    const secondCallPrompt = generateText.mock.calls[1][0].message;
    expect(secondCallPrompt).toContain('Key concepts identified');
    expect(secondCallPrompt).toContain('Spaced repetition');
    expect(questions).toHaveLength(1);
    expect(progress.some((line) => line.includes('Extracting key concepts'))).toBe(true);
  });

  it('falls back to single-pass when concept extraction fails', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce({ output: 'not json at all' })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          questions: [{ questionText: 'Q?', answerText: 'A', questionType: 'self_check' }],
        }),
      });
    const client = { generateText };
    const generator = new SpacedRepetitionGenerator({
      getClient: () => client,
      getClientForProvider: () => client,
    } as any);

    const questions = (await generator.generateQuestionsForNote({ ...options, twoPass: true })).questions;

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(questions).toHaveLength(1);
  });

  it('retries once with a stricter prompt when the question JSON is invalid', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce({ output: 'I refuse to answer in JSON because...' })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          questions: [{ questionText: 'Valid?', answerText: 'Yes', questionType: 'self_check' }],
        }),
      });
    const client = { generateText };
    const generator = new SpacedRepetitionGenerator({
      getClient: () => client,
      getClientForProvider: () => client,
    } as any);

    const questions = (await generator.generateQuestionsForNote({ ...options, twoPass: false })).questions;

    expect(generateText).toHaveBeenCalledTimes(2);
    const retryPrompt = generateText.mock.calls[1][0].message;
    expect(retryPrompt).toContain('Your previous answer was not valid JSON');
    expect(questions).toHaveLength(1);
  });

  it('gives thinking models a large concept-extraction budget', async () => {
    const conceptsJson = JSON.stringify({
      concepts: [{ name: 'C1', summary: 'S1' }],
    });
    const generateText = vi.fn()
      .mockResolvedValueOnce({ output: conceptsJson })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          questions: [{ questionText: 'Q?', answerText: 'A', questionType: 'self_check' }],
        }),
      });
    const client = { generateText };
    const generator = new SpacedRepetitionGenerator({
      getClient: () => client,
      getClientForProvider: () => client,
    } as any);

    await generator.generateQuestionsForNote({
      ...options,
      twoPass: true,
      model: 'chutes:moonshotai/Kimi-K2.6-TEE',
      questionCount: 8,
    });

    const conceptBudget = generateText.mock.calls[0][0].maxTokens;
    expect(conceptBudget).toBeGreaterThanOrEqual(5000);  });

  it('scales the token budget up for question count and thinking models', async () => {
    const generateText = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        questions: [{ questionText: 'Q?', answerText: 'A', questionType: 'self_check' }],
      }),
    });
    const client = { generateText };
    const generator = new SpacedRepetitionGenerator({
      getClient: () => client,
      getClientForProvider: () => client,
    } as any);

    // User setting of 30000 is capped to a 12000 floor; thinking models get a bonus above the floor.
    await generator.generateQuestionsForNote({
      ...options,
      twoPass: false,
      maxTokens: 30000,
      questionCount: 12,
      model: 'chutes:moonshotai/Kimi-K2.6-TEE',
    });
    const thinkingBudget = generateText.mock.calls[0][0].maxTokens;
    expect(thinkingBudget).toBe(12000);

    generateText.mockClear();
    await generator.generateQuestionsForNote({
      ...options,
      twoPass: false,
      maxTokens: 3000,
      questionCount: 12,
      model: 'chutes:moonshotai/Kimi-K2.6-TEE',
    });
    const smallFloorThinkingBudget = generateText.mock.calls[0][0].maxTokens;
    expect(smallFloorThinkingBudget).toBe(thinkingBudget);
  });

  it('captures sourceParagraphIndex from generated questions', () => {
    const gen = new SpacedRepetitionGenerator({} as any);
    const questions = gen.parseGeneratedQuestions(JSON.stringify({
      questions: [
        { questionText: 'Q1?', answerText: 'A1', questionType: 'self_check', sourceParagraphIndex: 2 },
        { questionText: 'Q2?', answerText: 'A2', questionType: 'self_check', sourceParagraphIndex: 0 },
        { questionText: 'Q3?', answerText: 'A3', questionType: 'self_check' },
      ],
    }));

    expect(questions).toHaveLength(3);
    expect(questions[0].sourceParagraphIndex).toBe(2);
    expect(questions[1].sourceParagraphIndex).toBe(0);
    expect(questions[2].sourceParagraphIndex).toBe(null);
  });

  it('includes existing questions in the prompt when provided', async () => {
    const questionsJson = JSON.stringify({
      questions: [{ questionText: 'New Q?', answerText: 'A', questionType: 'self_check' }],
    });
    const generateText = vi.fn().mockResolvedValue({ output: questionsJson });
    const client = { generateText };
    const generator = new SpacedRepetitionGenerator({
      getClient: () => client,
      getClientForProvider: () => client,
    } as any);

    await generator.generateQuestionsForNote({
      ...options,
      twoPass: false,
      existingQuestions: ['What is spaced repetition?', 'How does memory work?'],
    });

    const prompt = generateText.mock.calls[0][0].message;
    expect(prompt).toContain('Existing questions already created');
    expect(prompt).toContain('What is spaced repetition?');
    expect(prompt).toContain('How does memory work?');
  });

  it('includes paragraph context in the prompt when provided', async () => {
    const questionsJson = JSON.stringify({
      questions: [{ questionText: 'Q?', answerText: 'A', questionType: 'self_check', sourceParagraphIndex: 1 }],
    });
    const generateText = vi.fn().mockResolvedValue({ output: questionsJson });
    const client = { generateText };
    const generator = new SpacedRepetitionGenerator({
      getClient: () => client,
      getClientForProvider: () => client,
    } as any);

    const { questions } = await generator.generateQuestionsForNote({
      ...options,
      twoPass: false,
      paragraphs: [
        { index: 0, page: 10, text: 'First paragraph about variables.' },
        { index: 1, page: 10, text: 'Second paragraph about types.' },
      ],
    });

    const prompt = generateText.mock.calls[0][0].message;
    expect(prompt).toContain('sourceParagraphIndex');
    expect(prompt).toContain('[0] (p.10)');
    expect(prompt).toContain('[1] (p.10)');
    expect(questions[0].sourceParagraphIndex).toBe(1);
  });

  it('reuses cached concepts instead of extracting', async () => {
    const questionsJson = JSON.stringify({
      questions: [{ questionText: 'Q?', answerText: 'A', questionType: 'self_check' }],
    });
    const generateText = vi.fn().mockResolvedValue({ output: questionsJson });
    const client = { generateText };
    const generator = new SpacedRepetitionGenerator({
      getClient: () => client,
      getClientForProvider: () => client,
    } as any);

    const cachedConcepts = [{ name: 'Cached', summary: 'Cached concept' }];
    const { concepts, conceptsFromCache } = await generator.generateQuestionsForNote({
      ...options,
      twoPass: true,
      cachedConcepts,
    });

    expect(conceptsFromCache).toBe(true);
    expect(concepts).toBe(cachedConcepts);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
