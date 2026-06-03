import { describe, expect, it } from 'vitest';
import { AnswerChecker } from '../../src/utils/spacedRepetition/AnswerChecker';

describe('AnswerChecker', () => {
  const checker = new AnswerChecker({} as any);

  it('parses valid checker JSON', () => {
    const result = checker.parseCheckerResult(JSON.stringify({
      isAcceptable: true,
      confidence: 0.82,
      feedback: 'The answer covers the important point.',
      correctedAnswer: null,
    }));

    expect(result.isAcceptable).toBe(true);
    expect(result.confidence).toBe(0.82);
    expect(result.feedback).toBe('The answer covers the important point.');
    expect(result.correctedAnswer).toBeNull();
  });

  it('extracts checker JSON from fenced Ollama output', () => {
    const result = checker.parseCheckerResult(`
Thinking...

\`\`\`json
{
  "isAcceptable": false,
  "confidence": 1.5,
  "feedback": "Missing the scheduling behavior.",
  "correctedAnswer": "Grade 0 repeats later in the same session."
}
\`\`\`
`);

    expect(result.isAcceptable).toBe(false);
    expect(result.confidence).toBe(1);
    expect(result.feedback).toContain('Missing');
    expect(result.correctedAnswer).toBe('Grade 0 repeats later in the same session.');
  });
});
