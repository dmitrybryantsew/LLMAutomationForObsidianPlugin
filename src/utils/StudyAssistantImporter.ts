import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { ImportedStudyAssistantExercise, StudyAssistantExerciseEntry } from '../types/codingExercise';

const DIFFICULTIES = ['Basic', 'Simple', 'Medium', 'Hard'];

interface ParsedExerciseBlock {
  exerciseNumber: string;
  title: string;
  block: string;
}

export class StudyAssistantImporter {
  constructor(private rootPath: string) {}

  updateRootPath(rootPath: string): void {
    this.rootPath = rootPath;
  }

  async listExercises(): Promise<StudyAssistantExerciseEntry[]> {
    const bclRoot = this.getBclRoot();
    const entries: StudyAssistantExerciseEntry[] = [];

    const namespaceDirs = await this.safeReadDir(bclRoot);
    for (const namespaceDir of namespaceDirs) {
      if (!namespaceDir.isDirectory()) {
        continue;
      }

      const namespaceName = namespaceDir.name;
      for (const difficulty of DIFFICULTIES) {
        const filePath = path.join(bclRoot, namespaceName, 'Exercises', difficulty, `${difficulty}.md`);
        const markdown = await this.safeReadFile(filePath);
        if (!markdown) {
          continue;
        }

        const blocks = this.splitExerciseBlocks(markdown);
        for (const block of blocks) {
          entries.push({
            id: `${namespaceName}/${difficulty}/${block.exerciseNumber}`,
            namespace: namespaceName,
            difficulty,
            exerciseNumber: block.exerciseNumber,
            title: block.title,
            filePath,
          });
        }
      }
    }

    return entries.sort((a, b) => a.id.localeCompare(b.id));
  }

  async loadExercise(entry: StudyAssistantExerciseEntry): Promise<ImportedStudyAssistantExercise> {
    const markdown = await readFile(entry.filePath, 'utf8');
    const block = this.splitExerciseBlocks(markdown)
      .find((candidate) => candidate.exerciseNumber === entry.exerciseNumber);

    if (!block) {
      throw new Error(`Exercise block not found: ${entry.id}`);
    }

    return {
      ...entry,
      description: this.extractSection(block.block, 'Description') || this.extractDescriptionFallback(block.block),
      requirements: this.extractListSection(block.block, 'Requirements'),
      template: this.extractCodeBlock(block.block, 'Template') || '// Your code here',
      referenceSolution: this.extractCodeBlock(block.block, 'Solution') || '',
      hints: this.extractListSection(block.block, 'Hints'),
    };
  }

  private getBclRoot(): string {
    return path.join(this.rootPath, 'Study', 'Topic', 'BCL');
  }

  private async safeReadDir(dirPath: string) {
    try {
      return await readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  private async safeReadFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  private splitExerciseBlocks(markdown: string): ParsedExerciseBlock[] {
    const headerRegex = /^## Exercise\s+(\d+):\s*(.+)$/gm;
    const matches = Array.from(markdown.matchAll(headerRegex));
    const blocks: ParsedExerciseBlock[] = [];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const start = match.index ?? 0;
      const end = i + 1 < matches.length ? matches[i + 1].index ?? markdown.length : markdown.length;
      blocks.push({
        exerciseNumber: match[1],
        title: match[2].trim(),
        block: markdown.slice(start, end).trim(),
      });
    }

    return blocks;
  }

  private extractSection(markdown: string, sectionName: string): string {
    const pattern = new RegExp(`### ${this.escapeRegex(sectionName)}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n### |\\r?\\n---|$)`, 'i');
    const match = markdown.match(pattern);
    return match ? match[1].trim() : '';
  }

  private extractDescriptionFallback(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    const content: string[] = [];
    let seenHeader = false;

    for (const line of lines) {
      if (line.startsWith('## Exercise ')) {
        seenHeader = true;
        continue;
      }
      if (!seenHeader) {
        continue;
      }
      if (line.startsWith('### ') || line.trim() === '---') {
        break;
      }
      if (line.trim()) {
        content.push(line.trim());
      }
    }

    return content.join('\n');
  }

  private extractListSection(markdown: string, sectionName: string): string[] {
    const section = this.extractSection(markdown, sectionName);
    if (!section) {
      return [];
    }

    return section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  }

  private extractCodeBlock(markdown: string, sectionName: string): string {
    const pattern = new RegExp(`### ${this.escapeRegex(sectionName)}\\s*\\r?\\n\\s*\`\`\`(?:csharp|cs)?\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``, 'i');
    const match = markdown.match(pattern);
    return match ? match[1].trim() : '';
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
