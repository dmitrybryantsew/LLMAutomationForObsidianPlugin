import { App, normalizePath, TFile } from 'obsidian';
import path from 'path';
import { PluginSettings } from '../types';
import { StudyPathGenerationResult, StudyPathPlan, StudyPathStage } from '../types/studyPath';
import { StudySourceContext } from '../types/studySources';
import { LLMClientService } from './LLMClientService';
import { StudySourceLibrary } from './StudySourceLibrary';

interface CanvasNode {
  id: string;
  type: 'text' | 'file';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  color?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: 'right' | 'left' | 'top' | 'bottom';
  toNode: string;
  toSide: 'right' | 'left' | 'top' | 'bottom';
}

export class StudyPathGenerator {
  constructor(
    private app: App,
    private settings: PluginSettings,
    private llmClientService: LLMClientService,
    private sourceLibrary: StudySourceLibrary
  ) {}

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  async generateCSharpStudyPath(): Promise<StudyPathGenerationResult> {
    const client = this.llmClientService.getClientForProvider(this.settings.studyPathProvider);
    if (!client) {
      throw new Error('Study path LLM client not initialized. Check study path provider settings.');
    }

    const scan = await this.sourceLibrary.scan();
    const context = await this.sourceLibrary.buildContext(scan, this.settings.studyPathContextMaxTokens);

    if (context.files.length === 0) {
      throw new Error('No included study source files were available. Check Study Source Library settings and paths.');
    }

    const response = await client.generateText({
      model: this.settings.studyPathModel || this.settings.defaultTextModel,
      message: this.buildPrompt(context),
      temperature: this.settings.studyPathTemperature,
      maxTokens: this.settings.studyPathMaxTokens,
      language: this.settings.defaultLanguage,
    });

    const plan = this.parsePlan(response.output);
    const markdownFile = await this.createOrUpdateVaultFile(
      this.settings.studyPathMarkdownPath,
      this.renderMarkdown(plan, context)
    );
    const canvasFile = await this.createOrUpdateVaultFile(
      this.settings.studyPathCanvasPath,
      JSON.stringify(this.renderCanvas(plan, markdownFile.path), null, 2)
    );

    return {
      plan,
      markdownPath: markdownFile.path,
      canvasPath: canvasFile.path,
      sourceFileCount: context.files.length,
      estimatedContextTokens: context.estimatedTokens,
    };
  }

  private buildPrompt(context: StudySourceContext): string {
    const sourceBlocks = context.files.map((file, index) => {
      const trimmed = file.content.length > 12000 ? `${file.content.slice(0, 12000)}\n\n[truncated]` : file.content;
      return [
        `SOURCE ${index + 1}`,
        `Group: ${file.groupName}`,
        `Type: ${file.type}`,
        `Path: ${file.path}`,
        `Relative path: ${file.relativePath}`,
        'Content:',
        '```',
        trimmed,
        '```',
      ].join('\n');
    }).join('\n\n---\n\n');

    return [
      'Create a practical C# developer study path from the provided local reference material.',
      'Return strict JSON only. Do not wrap the answer in markdown fences.',
      '',
      'The goal is not a generic syllabus. Use the source material to create a staged path that is useful inside an Obsidian knowledge base.',
      'Prefer a compact, learn-by-building path with exercises/checkpoints. Include BCL and LINQPad-friendly practice where relevant.',
      '',
      'JSON schema:',
      '{',
      '  "title": "short title",',
      '  "audience": "learner profile",',
      '  "goal": "one paragraph goal",',
      '  "prerequisites": ["item"],',
      '  "stages": [',
      '    {',
      '      "id": "stage-1",',
      '      "title": "stage title",',
      '      "summary": "what this stage is for",',
      '      "outcomes": ["measurable outcome"],',
      '      "topics": ["topic"],',
      '      "practice": ["concrete practice task"],',
      '      "checkpoints": ["how to verify learning"],',
      '      "sourceHints": ["source relative path or local file hint"]',
      '    }',
      '  ],',
      '  "sourceNotes": ["short note about how sources influenced the plan"]',
      '}',
      '',
      'Constraints:',
      '- Produce 6 to 10 stages.',
      '- Keep each list focused: 3 to 6 items per list.',
      '- Make stage ordering explicit from fundamentals to practical application.',
      '- Prefer sourceHints that match provided relative paths.',
      '- Avoid claiming that you read material not provided here.',
      '',
      `Approximate context tokens supplied: ${context.estimatedTokens}`,
      `Skipped included files due to context cap/read errors: ${context.skippedFiles}`,
      '',
      sourceBlocks,
    ].join('\n');
  }

  private parsePlan(output: string): StudyPathPlan {
    const jsonText = this.extractJsonObject(output);
    const parsed = JSON.parse(jsonText) as Partial<StudyPathPlan>;
    const stages = Array.isArray(parsed.stages) ? parsed.stages.map((stage, index) => this.parseStage(stage, index)) : [];

    if (stages.length === 0) {
      throw new Error('Generated study path did not contain stages.');
    }

    return {
      title: this.requireString(parsed.title, 'title'),
      audience: this.requireString(parsed.audience, 'audience'),
      goal: this.requireString(parsed.goal, 'goal'),
      prerequisites: this.toStringArray(parsed.prerequisites),
      stages,
      sourceNotes: this.toStringArray(parsed.sourceNotes),
    };
  }

  private parseStage(value: unknown, index: number): StudyPathStage {
    const stage = value as Partial<StudyPathStage>;
    const id = typeof stage.id === 'string' && stage.id.trim() ? stage.id.trim() : `stage-${index + 1}`;

    return {
      id,
      title: this.requireString(stage.title, `stages[${index}].title`),
      summary: this.requireString(stage.summary, `stages[${index}].summary`),
      outcomes: this.toStringArray(stage.outcomes),
      topics: this.toStringArray(stage.topics),
      practice: this.toStringArray(stage.practice),
      checkpoints: this.toStringArray(stage.checkpoints),
      sourceHints: this.toStringArray(stage.sourceHints),
    };
  }

  private renderMarkdown(plan: StudyPathPlan, context: StudySourceContext): string {
    const stages = plan.stages.map((stage, index) => [
      `## ${index + 1}. ${stage.title}`,
      '',
      stage.summary,
      '',
      this.renderList('Outcomes', stage.outcomes),
      this.renderList('Topics', stage.topics),
      this.renderList('Practice', stage.practice),
      this.renderList('Checkpoints', stage.checkpoints),
      this.renderList('Source hints', stage.sourceHints),
    ].filter(Boolean).join('\n')).join('\n\n');

    return [
      `# ${plan.title}`,
      '',
      `Generated: ${new Date().toISOString()}`,
      `Provider/model: ${this.settings.studyPathProvider} / ${this.settings.studyPathModel}`,
      `Source files used: ${context.files.length}`,
      `Estimated source context tokens: ${context.estimatedTokens}`,
      '',
      `Audience: ${plan.audience}`,
      '',
      '## Goal',
      '',
      plan.goal,
      '',
      this.renderList('Prerequisites', plan.prerequisites),
      stages,
      this.renderList('Source notes', plan.sourceNotes),
      '',
      '## Source Context',
      '',
      ...context.files.map((file) => `- ${file.groupName}: \`${file.relativePath}\` (~${file.estimatedTokens} tokens)`),
      '',
    ].join('\n');
  }

  private renderCanvas(plan: StudyPathPlan, markdownPath: string): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];
    const stageWidth = 420;
    const stageHeight = 260;
    const gapX = 520;
    const rowGapY = 360;

    nodes.push({
      id: 'plan',
      type: 'file',
      file: markdownPath,
      x: 0,
      y: 0,
      width: 420,
      height: 160,
      color: '1',
    });

    plan.stages.forEach((stage, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const nodeId = stage.id || `stage-${index + 1}`;
      nodes.push({
        id: nodeId,
        type: 'text',
        x: col * gapX,
        y: 260 + row * rowGapY,
        width: stageWidth,
        height: stageHeight,
        color: String((index % 6) + 2),
        text: this.renderStageNodeText(stage, index),
      });

      edges.push({
        id: `edge-${index === 0 ? 'plan' : plan.stages[index - 1].id}-${nodeId}`,
        fromNode: index === 0 ? 'plan' : (plan.stages[index - 1].id || `stage-${index}`),
        fromSide: index === 0 ? 'bottom' : 'right',
        toNode: nodeId,
        toSide: index === 0 ? 'top' : 'left',
      });
    });

    return { nodes, edges };
  }

  private renderStageNodeText(stage: StudyPathStage, index: number): string {
    return [
      `## ${index + 1}. ${stage.title}`,
      '',
      stage.summary,
      '',
      '**Practice**',
      ...stage.practice.slice(0, 4).map((item) => `- ${item}`),
      '',
      '**Checkpoints**',
      ...stage.checkpoints.slice(0, 3).map((item) => `- ${item}`),
    ].join('\n');
  }

  private renderList(title: string, items: string[]): string {
    if (items.length === 0) {
      return '';
    }

    return [`### ${title}`, '', ...items.map((item) => `- ${item}`), ''].join('\n');
  }

  private async createOrUpdateVaultFile(filePath: string, content: string): Promise<TFile> {
    const normalized = normalizePath(filePath);
    await this.ensureVaultFolder(path.posix.dirname(normalized));
    const existing = this.app.vault.getAbstractFileByPath(normalized);

    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return existing;
    }

    return await this.app.vault.create(normalized, content);
  }

  private async ensureVaultFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!normalized || normalized === '.') {
      return;
    }

    const parts = normalized.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.createFolder(current);
      }
    }
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

    throw new Error('The model response did not contain a JSON study path.');
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Generated study path is missing ${field}.`);
    }
    return value.trim();
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : [];
  }
}
