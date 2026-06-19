import { PluginSettings } from '../types';
import { CodingExercise, ImportedStudyAssistantExercise } from '../types/codingExercise';
import { LLMClientService } from './LLMClientService';

export interface CodingExerciseRequest {
  topic: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  instructions?: string;
}

export class CodingExerciseGenerator {
  constructor(
    private settings: PluginSettings,
    private llmClientService: LLMClientService
  ) {}

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  async generate(request: CodingExerciseRequest): Promise<CodingExercise> {
    const client = this.llmClientService.getClientForProvider(this.settings.codingExerciseProvider);
    if (!client) {
      throw new Error('Exercise generation LLM client not initialized. Check coding exercise provider settings.');
    }

    const prompt = this.buildPrompt(request);
    const response = await client.generateText({
      model: this.getTextModel(),
      message: prompt,
      temperature: this.settings.codingExerciseTemperature,
      maxTokens: this.settings.codingExerciseMaxTokens,
      language: this.settings.defaultLanguage,
    });

    return this.parseExercise(response.output, request);
  }

  async convertImported(imported: ImportedStudyAssistantExercise): Promise<CodingExercise> {
    const client = this.llmClientService.getClientForProvider(this.settings.codingExerciseProvider);
    if (!client) {
      throw new Error('Exercise generation LLM client not initialized. Check coding exercise provider settings.');
    }

    const response = await client.generateText({
      model: this.getTextModel(),
      message: this.buildImportPrompt(imported),
      temperature: this.settings.codingExerciseTemperature,
      maxTokens: this.settings.codingExerciseMaxTokens,
      language: this.settings.defaultLanguage,
    });

    return this.parseExercise(response.output, {
      topic: `${imported.namespace}: ${imported.title}`,
      difficulty: this.mapDifficulty(imported.difficulty),
    });
  }

  private buildPrompt(request: CodingExerciseRequest): string {
    return [
      'Create one small C# learning exercise for LINQPad 9.',
      'Return strict JSON only. Do not wrap it in markdown fences.',
      'The learner will edit and run the starter code locally with LPRun using -lang=Program.',
      'The exercise must be solvable by comparing stdout with the desired output.',
      '',
      'JSON schema:',
      '{',
      '  "title": "short title",',
      '  "concept": "main concept",',
      '  "difficulty": "Easy|Medium|Hard",',
      '  "language": "csharp-linqpad",',
      '  "task": "clear task statement",',
      '  "desiredOutput": "exact stdout expected from a correct solution",',
      '  "starterCode": "complete LINQPad Program-mode C# code with TODO markers",',
      '  "visibleTests": ["manual checks or examples"],',
      '  "hiddenTests": ["extra checks the learner should consider"],',
      '  "hints": ["hint 1", "hint 2", "hint 3"]',
      '}',
      '',
      `Topic: ${request.topic}`,
      `Difficulty: ${request.difficulty}`,
      request.instructions ? `Additional instructions: ${request.instructions}` : '',
      '',
      'Important starterCode rules:',
      '- Include a Main method.',
      '- Write output with Console.WriteLine.',
      '- Avoid external packages and file/network access.',
      '- Keep the exercise focused and runnable in under one second.'
    ].filter(Boolean).join('\n');
  }

  private buildImportPrompt(imported: ImportedStudyAssistantExercise): string {
    return [
      'Convert this existing C# study exercise into one runnable LINQPad 9 exercise.',
      'Return strict JSON only. Do not wrap it in markdown fences.',
      'The learner will edit starterCode and run it locally with LPRun -lang=Program.',
      '',
      'The converted exercise must use deterministic verification:',
      '- starterCode must be complete C# Program-mode LINQPad code.',
      '- Include the learner method/class from the template with TODO markers.',
      '- Include a Main method that runs 2-4 deterministic checks against the learner code.',
      '- Main must print exact stable text only. Avoid timestamps, random values, network, file system, sleeps, races, and environment-specific data.',
      '- desiredOutput must exactly match stdout from a correct solution, including line order.',
      '- Use the reference solution only to understand correct behavior; do not paste the full solution into starterCode.',
      '',
      'JSON schema:',
      '{',
      '  "title": "short title",',
      '  "concept": "main concept",',
      '  "difficulty": "Easy|Medium|Hard",',
      '  "language": "csharp-linqpad",',
      '  "task": "clear task statement",',
      '  "desiredOutput": "exact stdout expected from a correct solution",',
      '  "starterCode": "complete LINQPad Program-mode C# code with TODO markers and a deterministic Main test harness",',
      '  "visibleTests": ["plain-language visible checks"],',
      '  "hiddenTests": ["extra edge cases to consider"],',
      '  "hints": ["hint 1", "hint 2", "hint 3"]',
      '}',
      '',
      `Source ID: ${imported.id}`,
      `Namespace: ${imported.namespace}`,
      `Difficulty: ${imported.difficulty}`,
      `Title: ${imported.title}`,
      '',
      'Description:',
      imported.description,
      '',
      imported.requirements.length ? 'Requirements:' : '',
      ...imported.requirements.map((item) => `- ${item}`),
      '',
      'Template:',
      '```csharp',
      imported.template,
      '```',
      '',
      imported.referenceSolution ? 'Reference solution:' : '',
      imported.referenceSolution ? '```csharp' : '',
      imported.referenceSolution,
      imported.referenceSolution ? '```' : '',
      '',
      imported.hints.length ? 'Existing hints:' : '',
      ...imported.hints.map((item) => `- ${item}`),
    ].filter((line) => line !== '').join('\n');
  }

  private parseExercise(output: string, request: CodingExerciseRequest): CodingExercise {
    const jsonText = this.extractJsonObject(output);
    const parsed = JSON.parse(jsonText) as Partial<CodingExercise>;

    return {
      title: this.requireString(parsed.title, 'title'),
      concept: this.requireString(parsed.concept, 'concept'),
      difficulty: parsed.difficulty === 'Easy' || parsed.difficulty === 'Medium' || parsed.difficulty === 'Hard'
        ? parsed.difficulty
        : request.difficulty,
      language: 'csharp-linqpad',
      task: this.requireString(parsed.task, 'task'),
      desiredOutput: this.requireString(parsed.desiredOutput, 'desiredOutput'),
      starterCode: this.requireString(parsed.starterCode, 'starterCode'),
      visibleTests: this.toStringArray(parsed.visibleTests),
      hiddenTests: this.toStringArray(parsed.hiddenTests),
      hints: this.toStringArray(parsed.hints),
    };
  }

  private extractJsonObject(output: string): string {
    const trimmed = output.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fencedMatch) {
      return fencedMatch[1].trim();
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return trimmed.slice(start, end + 1);
    }

    throw new Error('The model response did not contain a JSON exercise.');
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Generated exercise is missing ${field}.`);
    }
    return value.trim();
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : [];
  }

  private getTextModel(): string {
    return this.settings.codingExerciseModel || this.settings.defaultTextModel;
  }

  private mapDifficulty(difficulty: string): 'Easy' | 'Medium' | 'Hard' {
    if (difficulty.toLowerCase() === 'basic' || difficulty.toLowerCase() === 'simple') {
      return 'Easy';
    }
    if (difficulty.toLowerCase() === 'hard') {
      return 'Hard';
    }
    return 'Medium';
  }
}
