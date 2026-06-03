import { AnswerCheckerResult } from '../../types/spacedRepetition';
import { LLMClientService } from '../LLMClientService';

export interface AnswerCheckerInput {
  questionText: string;
  expectedAnswer: string;
  userAnswer: string;
  rubric?: string | null;
  noteContext?: string | null;
  model: string;
}

export class AnswerChecker {
  private llmClientService: LLMClientService;

  constructor(llmClientService: LLMClientService) {
    this.llmClientService = llmClientService;
  }

  async checkWithOllama(input: AnswerCheckerInput): Promise<AnswerCheckerResult> {
    const client = this.llmClientService.getClientForProvider('ollama') ?? this.llmClientService.getClient();
    if (!client) {
      throw new Error('Ollama client is not available');
    }

    const response = await client.generateText({
      model: input.model,
      message: this.buildPrompt(input),
      temperature: 0.1,
      maxTokens: 900,
    });

    return this.parseCheckerResult(response.output);
  }

  parseCheckerResult(rawText: string): AnswerCheckerResult {
    const jsonText = this.extractJsonObject(rawText);
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const confidence = Number(parsed.confidence);

    return {
      isAcceptable: Boolean(parsed.isAcceptable),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      feedback: typeof parsed.feedback === 'string' && parsed.feedback.trim()
        ? parsed.feedback.trim()
        : 'No feedback provided.',
      correctedAnswer: typeof parsed.correctedAnswer === 'string' && parsed.correctedAnswer.trim()
        ? parsed.correctedAnswer.trim()
        : null,
    };
  }

  private buildPrompt(input: AnswerCheckerInput): string {
    return [
      'You are checking a spaced repetition answer.',
      'Return ONLY valid JSON with this exact shape:',
      '{"isAcceptable":true,"confidence":0.0,"feedback":"short feedback","correctedAnswer":"optional corrected answer or null"}',
      '',
      'Rules:',
      '- Judge whether the user answer satisfies the expected answer, not whether it is word-for-word identical.',
      '- Be strict about missing key facts.',
      '- Keep feedback concise and useful for review.',
      '- confidence must be between 0 and 1.',
      '',
      input.rubric ? `Rubric:\n${input.rubric}` : 'Rubric: Use the expected answer as the rubric.',
      '',
      `Question:\n${input.questionText}`,
      '',
      `Expected answer:\n${input.expectedAnswer}`,
      '',
      `User answer:\n${input.userAnswer}`,
      '',
      input.noteContext ? `Source note context:\n${input.noteContext.slice(0, 8000)}` : '',
    ].filter(Boolean).join('\n');
  }

  private extractJsonObject(rawText: string): string {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    if (start < 0) {
      throw new Error('Ollama answer checker did not return JSON');
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < cleaned.length; index += 1) {
      const char = cleaned[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return cleaned.slice(start, index + 1);
        }
      }
    }

    throw new Error('Ollama answer checker returned incomplete JSON');
  }
}
