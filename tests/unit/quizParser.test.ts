import { describe, expect, it } from 'vitest';
import { parseQuizMarkdown } from '../../src/utils/quizParser';

describe('quizParser', () => {
  it('parses standard multiple-choice quiz with callout answers', () => {
    const markdown = `# Quiz: C# Async and Await (Medium)

1. What does the \`await\` keyword do when applied to an uncompleted Task?
   A) Blocks the current thread synchronously
   B) Yields control back to the caller and schedules continuation
   C) Aborts the task execution
   D) Creates a new background thread automatically

2. Which return type is recommended for an async method that yields no value?
   A) void
   B) Task
   C) ValueTask<void>
   D) Thread

> [!faq]- Answers
> 1. B - await yields control and resumes upon task completion.
> 2. B - Task is preferred over async void for exception handling.
`;

    const parsed = parseQuizMarkdown('Default Note', 'Quizzes/CSharp/AsyncQuiz.md', markdown);

    expect(parsed.title).toBe('Quiz: C# Async and Await (Medium)');
    expect(parsed.topic).toBe('C# Async and Await');
    expect(parsed.difficulty).toBe('Medium');
    expect(parsed.filePath).toBe('Quizzes/CSharp/AsyncQuiz.md');
    expect(parsed.questions).toHaveLength(2);

    const q1 = parsed.questions[0];
    expect(q1.number).toBe(1);
    expect(q1.questionText).toContain('What does the `await` keyword do');
    expect(q1.choices).toHaveLength(4);
    expect(q1.choices[0]).toEqual({ key: 'A', text: 'Blocks the current thread synchronously' });
    expect(q1.choices[1]).toEqual({ key: 'B', text: 'Yields control back to the caller and schedules continuation' });
    expect(q1.correctAnswerKey).toBe('B');
    expect(q1.explanation).toContain('await yields control');

    const q2 = parsed.questions[1];
    expect(q2.number).toBe(2);
    expect(q2.correctAnswerKey).toBe('B');
    expect(q2.explanation).toContain('Task is preferred over async void');
  });

  it('parses bullet choices and ## Answers section format', () => {
    const markdown = `# Quiz: LINQ Fundamentals (Easy)

### Question 1: Which method filters a sequence based on a predicate?
- A. Select
- B. Where
- C. GroupBy
- D. OrderBy

### Question 2: Is LINQ execution deferred by default for Where?
- A. Yes
- B. No

## Answers
1. B - Where filters elements matching the predicate.
2. A - Where uses deferred execution.
`;

    const parsed = parseQuizMarkdown('LINQ Note', 'Quizzes/LINQ/Basics.md', markdown);

    expect(parsed.topic).toBe('LINQ Fundamentals');
    expect(parsed.difficulty).toBe('Easy');
    expect(parsed.questions).toHaveLength(2);

    expect(parsed.questions[0].choices).toHaveLength(4);
    expect(parsed.questions[0].choices[1]).toEqual({ key: 'B', text: 'Where' });
    expect(parsed.questions[0].correctAnswerKey).toBe('B');

    expect(parsed.questions[1].choices).toHaveLength(2);
    expect(parsed.questions[1].correctAnswerKey).toBe('A');
  });

  it('handles self-check questions without multiple-choice options', () => {
    const markdown = `# Quiz: Garbage Collection (Hard)

1. Explain how the Gen 0, Gen 1, and Gen 2 generations work in the .NET GC.

> [!note]- Answers
> 1. A - Gen 0 holds short-lived objects, Gen 1 acts as a buffer, Gen 2 holds long-lived objects.
`;

    const parsed = parseQuizMarkdown('GC Note', 'Quizzes/GC.md', markdown);

    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].choices).toHaveLength(0);
    expect(parsed.questions[0].questionText).toContain('Explain how the Gen 0, Gen 1, and Gen 2');
    expect(parsed.questions[0].explanation).toContain('Gen 0 holds short-lived objects');
  });

  it('falls back to default title and topic when header is missing or custom', () => {
    const markdown = `
1. What is the base class for all classes in C#?
   A) System.Type
   B) System.Object

> [!faq]- Answers
> 1. B - Object is the ultimate base class.
`;

    const parsed = parseQuizMarkdown('Default Note Name', 'Quizzes/General.md', markdown);

    expect(parsed.title).toBe('Default Note Name');
    expect(parsed.topic).toBe('General');
    expect(parsed.difficulty).toBe('Medium');
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].correctAnswerKey).toBe('B');
  });
});
