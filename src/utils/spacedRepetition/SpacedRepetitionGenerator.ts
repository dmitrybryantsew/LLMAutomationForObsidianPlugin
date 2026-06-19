import { TFile } from 'obsidian';
import { AnswerCheckMode, ExactAnswerField, QuestionType, SpacedRepetitionQuestionInput } from '../../types/spacedRepetition';
import { LLMClientService } from '../LLMClientService';
import { normalizeExactAnswerField } from './ExactAnswerMatcher';

export interface GenerateQuestionsForNoteOptions {
  file: TFile;
  noteContent: string;
  provider?: 'openrouter' | 'chutes' | 'zai' | 'ollama' | 'proxy';
  model: string;
  questionCount: number;
  questionTypes: QuestionType[];
  additionalInstructions?: string;
  outputLanguage?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GeneratedQuestionSource {
  sourceLabel?: string;
  sourceExcerpt?: string;
}

export interface GeneratedSpacedRepetitionQuestion extends SpacedRepetitionQuestionInput {
  source?: GeneratedQuestionSource;
}

interface RawGeneratedQuestion {
  questionName?: unknown;
  questionText?: unknown;
  questionType?: unknown;
  answerText?: unknown;
  choices?: unknown;
  answerCheckMode?: unknown;
  tags?: unknown;
  metadata?: unknown;
  fields?: unknown;
  exactFields?: unknown;
  sourceQuote?: unknown;
  sourceExcerpt?: unknown;
}

const QUESTION_TYPES: QuestionType[] = ['self_check', 'typed_exact', 'typed_fields_exact', 'typed_llm_checked', 'multiple_choice'];

export class SpacedRepetitionGenerator {
  private llmClientService: LLMClientService;

  constructor(llmClientService: LLMClientService) {
    this.llmClientService = llmClientService;
  }

  async generateQuestionsForNote(options: GenerateQuestionsForNoteOptions): Promise<GeneratedSpacedRepetitionQuestion[]> {
    const client = options.provider
      ? this.llmClientService.getClientForProvider(options.provider)
      : this.llmClientService.getClientForProvider('ollama') ?? this.llmClientService.getClient();
    if (!client) {
      throw new Error('LLM client is not initialized');
    }

    const prompt = this.buildNotePrompt(options);
    const response = await client.generateText({
      message: prompt,
      model: options.model,
      language: options.outputLanguage ?? 'english',
      files: [],
      temperature: options.temperature ?? 0.2,
      maxTokens: options.maxTokens ?? 3000,
    });

    return this.parseGeneratedQuestions(response.output);
  }

  parseGeneratedQuestions(rawText: string): GeneratedSpacedRepetitionQuestion[] {
    const parsed = this.parseJsonObject(rawText);
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    return this.validateGeneratedQuestions(questions);
  }

  validateGeneratedQuestions(rawQuestions: unknown[]): GeneratedSpacedRepetitionQuestion[] {
    const valid: GeneratedSpacedRepetitionQuestion[] = [];

    for (const raw of rawQuestions) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }

      const question = raw as RawGeneratedQuestion;
      const questionText = this.cleanString(question.questionText);
      let answerText = this.cleanString(question.answerText);
      if (!questionText) {
        continue;
      }

      const questionType = this.normalizeQuestionType(question.questionType);
      const answerCheckMode = this.normalizeAnswerCheckMode(question.answerCheckMode, questionType);
      const choices = this.normalizeChoices(question.choices);
      if (questionType === 'multiple_choice' && choices.length !== 4) {
        continue;
      }

      const metadata = this.normalizeMetadata(question.metadata);
      const exactFields = this.normalizeExactFields(question.fields)
        || this.normalizeExactFields(question.exactFields)
        || this.normalizeExactFields(metadata.exactFields);
      if (questionType === 'typed_fields_exact') {
        if (!exactFields?.length) {
          continue;
        }
        metadata.exactFields = exactFields;
        answerText = exactFields.map((field) => `${field.label}: ${field.answer}`).join('\n');
      }

      if (!answerText) {
        continue;
      }

      const tags = this.normalizeStringArray(question.tags);
      if (tags.length) {
        metadata.tags = tags;
      }

      const sourceExcerpt = this.cleanString(question.sourceExcerpt) || this.cleanString(question.sourceQuote);
      if (sourceExcerpt) {
        metadata.sourceExcerpt = sourceExcerpt;
      }

      valid.push({
        questionName: this.cleanString(question.questionName) || null,
        questionText,
        questionType,
        answerText,
        choices: questionType === 'multiple_choice' ? choices : null,
        answerCheckMode,
        metadata,
        source: sourceExcerpt ? { sourceExcerpt } : undefined,
      });
    }

    if (valid.length === 0) {
      throw new Error('Ollama did not return any valid review questions');
    }

    return valid;
  }

  private buildNotePrompt(options: GenerateQuestionsForNoteOptions): string {
    const typeList = options.questionTypes.join(', ');
    const noteContent = options.noteContent.trim().slice(0, 30000);
    const additionalInstructions = options.additionalInstructions?.trim()
      ? `\nAdditional user instructions:\n${options.additionalInstructions.trim()}\n`
      : '';

    return `Generate spaced repetition review questions from this Obsidian note.

Return ONLY valid JSON. Do not wrap it in markdown. Do not include commentary.

JSON shape:
{
  "questions": [
    {
      "questionName": "Short label",
      "questionText": "Question text",
      "questionType": "self_check",
      "answerText": "Expected answer",
      "choices": null,
      "answerCheckMode": "self",
      "tags": ["optional_tag"],
      "metadata": {
        "difficulty": "medium"
      },
      "sourceQuote": "Short supporting quote from the note"
    }
  ]
}

Rules:
- Create ${options.questionCount} useful questions.
- Allowed questionType values: ${typeList}.
- For self_check, answerCheckMode must be "self".
- For typed_exact, answerCheckMode must be "exact" and answerText should be concise.
- For typed_fields_exact, answerCheckMode must be "exact"; include metadata.exactFields as an array of {"id","label","answer","placeholder"}.
- typed_fields_exact fields may also include: aliases string array, regex string, caseSensitive boolean, normalizeWhitespace boolean, normalization "text" or "csharp".
- Use normalization "csharp" for C# syntax cards where insignificant spacing should not matter.
- Use typed_fields_exact when the learner must remember exact syntax pieces, method names, parameter order, flags, or function-call arguments.
- For typed_llm_checked, answerCheckMode must be "llm" and metadata should include a short rubric.
- For multiple_choice, choices must be exactly four strings and answerText must be the correct choice text.
- Prefer questions that test durable understanding, definitions, distinctions, steps, and edge cases.
- sourceQuote must be short and copied from the note when possible.
${additionalInstructions}
Source note path: ${options.file.path}
Source note title: ${options.file.basename}

Note content:
${noteContent}`;
  }

  private parseJsonObject(rawText: string): any {
    const withoutFences = rawText
      .replace(/```json/gi, '```')
      .replace(/```/g, '')
      .trim();

    try {
      return JSON.parse(withoutFences);
    } catch {
      const objectText = this.extractFirstJsonObject(withoutFences);
      if (!objectText) {
        throw new Error('Ollama response did not contain a JSON object');
      }
      return JSON.parse(objectText);
    }
  }

  private extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf('{');
    if (start < 0) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        depth += 1;
      }

      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, index + 1);
        }
      }
    }

    return null;
  }

  private normalizeQuestionType(value: unknown): QuestionType {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return QUESTION_TYPES.includes(normalized as QuestionType) ? normalized as QuestionType : 'self_check';
  }

  private normalizeAnswerCheckMode(value: unknown, questionType: QuestionType): AnswerCheckMode {
    if (questionType === 'typed_exact' || questionType === 'typed_fields_exact') {
      return 'exact';
    }

    if (questionType === 'typed_llm_checked') {
      return 'llm';
    }

    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized === 'exact' || normalized === 'llm' || normalized === 'self' ? normalized : 'self';
  }

  private normalizeChoices(value: unknown): string[] {
    return this.normalizeStringArray(value).slice(0, 4);
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.cleanString(item))
      .filter((item): item is string => Boolean(item));
  }

  private normalizeMetadata(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return { ...(value as Record<string, unknown>) };
  }

  private normalizeExactFields(value: unknown): ExactAnswerField[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const fields: ExactAnswerField[] = [];
    for (const item of value) {
      const field = normalizeExactAnswerField(item, fields.length);
      if (field) {
        fields.push(field);
      }
    }

    return fields.length ? fields : null;
  }

  private cleanString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
