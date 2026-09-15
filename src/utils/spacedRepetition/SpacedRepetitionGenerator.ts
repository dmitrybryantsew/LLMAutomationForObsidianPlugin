import { TFile } from 'obsidian';
import { AnswerCheckMode, ExactAnswerField, QuestionType, SpacedRepetitionQuestionInput } from '../../types/spacedRepetition';
import { TextProviderId } from '../../types/providers';
import { LLMClientService } from '../LLMClientService';
import { normalizeExactAnswerField } from './ExactAnswerMatcher';
import { isThinkingModel, stripThinkingTags } from '../modelFilters';

export interface GenerateQuestionsForNoteOptions {
  file: TFile;
  noteContent: string;
  provider?: TextProviderId;
  model: string;
  questionCount: number;
  questionTypes: QuestionType[];
  additionalInstructions?: string;
  outputLanguage?: string;
  temperature?: number;
  maxTokens?: number;
  extraContext?: string; // Additional content from other notes (e.g. author's other works)
  /** Two-pass research pipeline: extract concepts first, then generate grounded questions. Default: true. */
  twoPass?: boolean;
  /** Strip reasoning/thinking noise before parsing. Default: true. */
  stripThinking?: boolean;
  /** Optional progress hook so UIs can log pipeline stages. */
  onProgress?: (stage: string) => void;
  /** Already-existing question texts for the same source — fed to the model to avoid duplicates. */
  existingQuestions?: string[];
  /** Pre-extracted concepts to reuse (skips pass 1 when provided and non-empty). */
  cachedConcepts?: ExtractedConcept[];
  /** Paragraph-level source chunks with stable indices, so the model can tag each question with its source paragraph. */
  paragraphs?: Array<{ index: number; page: number; text: string }>;
}

export interface GeneratedQuestionSource {
  sourceLabel?: string;
  sourceExcerpt?: string;
}

export interface GeneratedSpacedRepetitionQuestion extends SpacedRepetitionQuestionInput {
  source?: GeneratedQuestionSource;
  sourceParagraphIndex?: number | null;
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
  sourceParagraphIndex?: unknown;
}

export interface ExtractedConcept {
  name: string;
  summary: string;
  sourceQuote?: string;
}

const QUESTION_TYPES: QuestionType[] = ['self_check', 'typed_exact', 'typed_fields_exact', 'typed_llm_checked', 'multiple_choice'];

const MAX_OUTPUT_TOKENS_CAP = 32000;

export interface GenerateQuestionsResult {
  questions: GeneratedSpacedRepetitionQuestion[];
  concepts: ExtractedConcept[];
  conceptsFromCache: boolean;
}

export class SpacedRepetitionGenerator {
  private llmClientService: LLMClientService;

  constructor(llmClientService: LLMClientService) {
    this.llmClientService = llmClientService;
  }

  async generateQuestionsForNote(options: GenerateQuestionsForNoteOptions): Promise<GenerateQuestionsResult> {
    const client = options.provider
      ? this.llmClientService.getClientForProvider(options.provider)
      : this.llmClientService.getClient();
    if (!client) {
      throw new Error('LLM client is not initialized');
    }

    const model = options.model;
    const maxTokens = this.scaleMaxTokens(options);
    const label = `${options.provider ?? 'default'}/${model}`;

    // ------------------------------------------------------------------
    // Research pipeline, pass 1: extract key concepts from the source.
    // ------------------------------------------------------------------
    let concepts: ExtractedConcept[] = [];
    let conceptsFromCache = false;
    if (options.twoPass !== false) {
      if (options.cachedConcepts && options.cachedConcepts.length > 0) {
        concepts = options.cachedConcepts;
        conceptsFromCache = true;
        options.onProgress?.(`Reusing ${concepts.length} cached concepts (${label})...`);
      } else {
        options.onProgress?.(`Extracting key concepts (${label})...`);
        try {
          concepts = await this.extractConcepts(client, options, maxTokens);
        } catch (error) {
          // Concept extraction is a quality booster — fall back to single pass.
          console.warn('[SpacedRepetitionGenerator] Concept extraction failed, continuing single-pass:', error);
          options.onProgress?.('Concept extraction failed — continuing with direct generation');
          concepts = [];
        }
      }
    }

    // ------------------------------------------------------------------
    // Pass 2: generate questions grounded in the extracted concepts.
    // ------------------------------------------------------------------
    const prompt = this.buildNotePrompt(options, concepts, false);
    options.onProgress?.(concepts.length
      ? `Generating questions from ${concepts.length} concepts (${label})...`
      : `Generating questions (${label})...`);

    const response = await client.generateText({
      message: prompt,
      model,
      language: options.outputLanguage ?? 'english',
      files: [],
      temperature: options.temperature ?? 0.2,
      maxTokens,
    });

    try {
      const questions = this.parseGeneratedQuestions(response.output, options.stripThinking !== false);
      return { questions, concepts, conceptsFromCache };
    } catch (firstError) {
      console.error('[SpacedRepetitionGenerator] First parse attempt failed:', firstError);
      console.error('[SpacedRepetitionGenerator] Raw response (first 500 chars):', response.output.slice(0, 500));
      options.onProgress?.('Response was not valid JSON — retrying with stricter instructions');

      const retryResponse = await client.generateText({
        message: this.buildNotePrompt(options, concepts, true),
        model,
        language: options.outputLanguage ?? 'english',
        files: [],
        temperature: Math.max(0, (options.temperature ?? 0.2) - 0.1),
        maxTokens: Math.min(12000, maxTokens + 2000),
      });

      try {
        const questions = this.parseGeneratedQuestions(retryResponse.output, options.stripThinking !== false);
        return { questions, concepts, conceptsFromCache };
      } catch (secondError) {
        console.error('[SpacedRepetitionGenerator] Retry parse failed:', secondError);
        console.error('[SpacedRepetitionGenerator] Retry raw response (first 500 chars):', retryResponse.output.slice(0, 500));
        throw new Error(
          `${label} did not return valid JSON after retry: ${secondError instanceof Error ? secondError.message : 'unknown error'}`,
        );
      }
    }
  }

  parseGeneratedQuestions(rawText: string, stripThinking = true): GeneratedSpacedRepetitionQuestion[] {
    const cleaned = stripThinking ? stripThinkingTags(rawText) : rawText;
    const parsed = this.parseJsonObject(cleaned);
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    return this.dedupeQuestions(this.validateGeneratedQuestions(questions));
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

      const sourceParagraphIndex = typeof question.sourceParagraphIndex === 'number'
        ? Math.floor(question.sourceParagraphIndex)
        : null;

      valid.push({
        questionName: this.cleanString(question.questionName) || null,
        questionText,
        questionType,
        answerText,
        choices: questionType === 'multiple_choice' ? choices : null,
        answerCheckMode,
        metadata,
        source: sourceExcerpt ? { sourceExcerpt } : undefined,
        sourceParagraphIndex,
      });
    }

    if (valid.length === 0) {
      throw new Error('The selected provider did not return any valid review questions');
    }

    return valid;
  }

  // ------------------------------------------------------------------
  // Research pipeline internals
  // ------------------------------------------------------------------

  /**
   * Auto-scale the output token budget so the question JSON is not truncated
   * mid-stream. Reasoning models burn a large share of the budget on hidden
   * chain-of-thought, so they get a generous bonus. The user's setting acts as
   * a floor, but the ceiling stays modest: huge budgets make reasoning models
   * think longer and blow past upstream time limits (observed as 502s).
   */
  private scaleMaxTokens(options: GenerateQuestionsForNoteOptions): number {
    const count = Math.max(1, options.questionCount);
    let required = 700 * count + 1200;
    if (options.questionTypes.includes('typed_fields_exact') || options.questionTypes.includes('multiple_choice')) {
      required += 800;
    }
    if (isThinkingModel(options.model)) {
      required += 5000;
    }
    // Hard cap: live testing showed reasoning models with budgets above ~12k
    // think longer and blow past upstream time limits (502s from the proxy).
    const floor = Math.min(options.maxTokens ?? 8000, 12000);
    return Math.min(12000, Math.max(floor, required));
  }

  private async extractConcepts(
    client: { generateText: (options: any) => Promise<{ output: string }> },
    options: GenerateQuestionsForNoteOptions,
    maxTokens: number,
  ): Promise<ExtractedConcept[]> {
    const conceptCount = Math.max(8, Math.ceil(options.questionCount * 1.5));
    const noteContent = options.noteContent.trim().slice(0, 30000);
    const language = options.outputLanguage ?? 'english';

    const prompt = `Extract the key learnable concepts from this text. This is a research step: identify what is genuinely worth memorizing, not what is merely mentioned.

Return ONLY valid JSON. Do not wrap it in markdown. Do not include commentary.

JSON shape:
{
  "concepts": [
    {
      "name": "Short concept name",
      "summary": "One or two sentence explanation of the idea",
      "sourceQuote": "Short supporting quote from the text",
      "kind": "definition"
    }
  ]
}

Rules:
- Extract up to ${conceptCount} concepts.
- kind values: definition, mechanism, distinction, cause_effect, edge_case, fact, procedure.
- Prioritize durable knowledge: definitions, mechanisms, how things differ, why things happen, edge cases, procedures, and concrete facts.
- Skip trivia, page numbers, cross-references, and passing mentions.
- Ground every concept in this text only.
- Write names and summaries in ${language}.

Source text:
${noteContent}`;

    const response = await client.generateText({
      message: prompt,
      model: options.model,
      language,
      files: [],
      temperature: 0.1,
      // Thinking models burn thousands of tokens on hidden reasoning before
      // any JSON appears; a fixed 2000 budget produced empty output.
      maxTokens: isThinkingModel(options.model)
        ? Math.min(12000, 5000 + conceptCount * 250)
        : Math.max(2000, conceptCount * 120),
    });

    const cleaned = stripThinkingTags(response.output);
    const parsed = this.parseJsonObject(cleaned);
    const rawConcepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];

    const concepts: ExtractedConcept[] = [];
    for (const raw of rawConcepts) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const concept = raw as Record<string, unknown>;
      const name = this.cleanString(concept.name);
      const summary = this.cleanString(concept.summary);
      if (!name || !summary) {
        continue;
      }
      concepts.push({
        name,
        summary,
        sourceQuote: this.cleanString(concept.sourceQuote) || undefined,
      });
      if (concepts.length >= conceptCount) {
        break;
      }
    }
    return concepts;
  }

  private buildNotePrompt(
    options: GenerateQuestionsForNoteOptions,
    concepts: ExtractedConcept[] = [],
    isRetry: boolean = false,
  ): string {
    const typeList = options.questionTypes.join(', ');
    const noteContent = options.noteContent.trim().slice(0, 30000);
    const additionalInstructions = options.additionalInstructions?.trim()
      ? `\nAdditional user instructions:\n${options.additionalInstructions.trim()}\n`
      : '';
    const extraContextSection = options.extraContext?.trim()
      ? `\nAdditional context from related notes:\n${options.extraContext.trim()}\n`
      : '';
    const conceptSection = concepts.length
      ? `\nKey concepts identified in this excerpt — ground the questions in these:\n${concepts
        .map((concept) => `- ${concept.name}: ${concept.summary}${concept.sourceQuote ? ` ("${concept.sourceQuote}")` : ''}`)
        .join('\n')}\n`
      : '';

    const existingSection = options.existingQuestions && options.existingQuestions.length > 0
      ? `\nExisting questions already created for this source — do NOT repeat or rephrase these:\n${options.existingQuestions
        .slice(0, 80)
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n')}\n`
      : '';

    const paragraphSection = options.paragraphs && options.paragraphs.length > 0
      ? `\nThe source is divided into numbered paragraphs. Each question MUST include a "sourceParagraphIndex" field (integer) indicating which paragraph it comes from. Paragraph list:\n${options.paragraphs
        .map((p) => `[${p.index}] (p.${p.page}) ${p.text.slice(0, 200)}`)
        .join('\n')}\n`
      : '';

    const retryPreamble = isRetry
      ? 'IMPORTANT: Your previous answer was not valid JSON. Respond now with ONLY the JSON object. No thinking out loud, no explanations, no markdown fences.\n\n'
      : '';

    return `${retryPreamble}Generate spaced repetition review questions from this Obsidian note.

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
      "sourceQuote": "Short supporting quote from the note"${options.paragraphs?.length ? ',\n      "sourceParagraphIndex": 0' : ''}
    }
  ]
}

Rules:
- Create ${options.questionCount} useful questions.
- Allowed questionType values: ${typeList}.
- Cover different concepts — do not ask the same thing twice.
- Aim for a difficulty mix: mostly medium, a few easy and a few hard (set metadata.difficulty to easy/medium/hard).
- For self_check, answerCheckMode must be "self".
- For typed_exact, answerCheckMode must be "exact" and answerText should be concise.
- For typed_fields_exact, answerCheckMode must be "exact"; include metadata.exactFields as an array of {"id","label","answer","placeholder"}.
- typed_fields_exact fields may also include: aliases string array, regex string, caseSensitive boolean, normalizeWhitespace boolean, normalization "text" or "csharp".
- Use normalization "csharp" for C# syntax cards where insignificant space should not matter.
- Use typed_fields_exact when the learner must remember exact syntax pieces, method names, parameter order, flags, or function-call arguments.
- For typed_llm_checked, answerCheckMode must be "llm" and metadata should include a short rubric.
- For multiple_choice, choices must be exactly four strings and answerText must be the correct choice text.
- Prefer questions that test durable understanding, definitions, distinctions, steps, and edge cases.
- sourceQuote must be short and copied from the note when possible.
${options.paragraphs?.length ? '- Each question MUST include sourceParagraphIndex (the paragraph number it is based on).\n' : ''}${additionalInstructions}${extraContextSection}${conceptSection}${existingSection}${paragraphSection}
Source note path: ${options.file.path}
Source note title: ${options.file.basename}

Note content:
${noteContent}`;
  }

  private dedupeQuestions(questions: GeneratedSpacedRepetitionQuestion[]): GeneratedSpacedRepetitionQuestion[] {
    const seen = new Set<string>();
    const unique: GeneratedSpacedRepetitionQuestion[] = [];

    for (const question of questions) {
      const key = question.questionText
        .toLowerCase()
        .replace(/[^a-z0-9а-яё\u0400-\u04ff\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (key && seen.has(key)) {
        continue;
      }
      if (key) {
        seen.add(key);
      }
      unique.push(question);
    }

    return unique;
  }

  // ------------------------------------------------------------------
  // Parsing
  // ------------------------------------------------------------------

  private parseJsonObject(rawText: string): any {
    const withoutFences = rawText
      .replace(/```json/gi, '```')
      .replace(/```/g, '')
      .trim();

    try {
      return JSON.parse(withoutFences);
    } catch {
      const objectText = this.extractFirstJsonObject(withoutFences);
      if (objectText) {
        return JSON.parse(objectText);
      }

      // The stream was likely truncated (max_tokens cut the JSON mid-object).
      // Try to repair it by closing open strings/brackets/braces.
      const repaired = this.repairTruncatedJson(withoutFences);
      if (repaired) {
        return JSON.parse(repaired);
      }

      throw new Error('Response did not contain a JSON object');
    }
  }

  /**
   * Best-effort repair of a truncated JSON object: appends the missing
   * closing quote, brackets and braces based on scanner state. Trailing
   * half-written members may make the JSON invalid — in that case JSON.parse
   * will throw and the caller treats it as a parse failure.
   */
  private repairTruncatedJson(text: string): string | null {
    const start = text.indexOf('{');
    if (start < 0) {
      return null;
    }

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let lastSafeEnd = -1;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString) {
        if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}' || char === ']') {
        stack.pop();
        if (stack.length === 0) {
          // A complete object existed — extraction should have caught it.
          return null;
        }
        // Remember positions where an array/object element just closed cleanly.
        lastSafeEnd = index;
      }
    }

    if (stack.length === 0) {
      return null;
    }

    // Truncate back to the last cleanly-closed element if we are mid-element,
    // otherwise close from the very end.
    let body = lastSafeEnd >= 0 ? text.slice(start, lastSafeEnd + 1) : text.slice(start);
    if (inString && lastSafeEnd < 0) {
      body += '"';
    }

    // Trim dangling commas, incomplete "key": or "key": val fragments.
    body = body.replace(/,\s*$/, '');
    body = body.replace(/,?\s*"[^"]*"\s*:\s*(?:[^,\]}]*)?$/, '');

    // Recompute closers for the (possibly re-truncated) body.
    const closers: string[] = [];
    let stringState = false;
    let escapeState = false;
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index];
      if (escapeState) {
        escapeState = false;
        continue;
      }
      if (stringState) {
        if (char === '\\') {
          escapeState = true;
        } else if (char === '"') {
          stringState = false;
        }
        continue;
      }
      if (char === '"') {
        stringState = true;
      } else if (char === '{' || char === '[') {
        closers.push(char === '{' ? '}' : ']');
      } else if (char === '}' || char === ']') {
        closers.pop();
      }
    }

    return body + closers.reverse().join('');
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

  // ------------------------------------------------------------------
  // Normalization helpers
  // ------------------------------------------------------------------

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
