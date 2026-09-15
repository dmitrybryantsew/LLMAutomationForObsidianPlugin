import { App, Notice, TFile, normalizePath } from 'obsidian';
import type GptFreeTextGeneratorPlugin from '../../main';
import { CardManagementRecord } from './SpacedRepetitionDatabase';

export type FlashcardExportFormat = 'markdown' | 'json';

export interface FlashcardExportResult {
  path: string;
  count: number;
}

function renderCardsJson(cards: CardManagementRecord[], filters?: Record<string, unknown>): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    filters,
    cards,
  }, null, 2);
}

function renderCardsMarkdown(cards: CardManagementRecord[]): string {
  const lines = [
    '# Flashcard Export',
    '',
    `Exported: ${new Date().toISOString()}`,
    `Cards: ${cards.length}`,
    '',
  ];

  for (const card of cards) {
    lines.push(
      `## ${card.questionName || card.questionType}`,
      '',
      `- ID: \`${card.id}\``,
      `- Type: \`${card.questionType}\``,
      `- Deck: ${card.studySetName ?? 'No deck'}`,
      `- Note: ${card.notePath ?? 'No note'}`,
      `- Status: ${card.enabled ? 'Enabled' : 'Suspended'}${card.archivedAt ? ' (Archived)' : ''}`,
      `- Due: ${card.nextRepeatAt}`,
      '',
      '### Question',
      '',
      card.questionText,
      '',
      '### Answer',
      '',
      card.answerText ?? '',
      ''
    );

    if (Object.keys(card.metadata).length) {
      lines.push('### Metadata', '', '```json', JSON.stringify(card.metadata, null, 2), '```', '');
    }
  }

  return lines.join('\n');
}

async function ensureVaultFolder(app: App, folder: string): Promise<void> {
  const parts = normalizePath(folder).split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!await app.vault.adapter.exists(current)) {
      await app.vault.createFolder(current);
    }
  }
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Export flashcard records to Flashcards/Exports as markdown or JSON.
 * Shared by the flashcard hub and the card management view.
 */
export async function exportFlashcards(
  app: App,
  plugin: GptFreeTextGeneratorPlugin,
  cards: CardManagementRecord[],
  format: FlashcardExportFormat,
  options?: {
    /** Skip opening the created file (e.g. focus mode where opening is disruptive). */
    openFile?: boolean;
    /** Restricts the export to a single deck's name (used for filer naming). */
    label?: string;
  },
): Promise<FlashcardExportResult | null> {
  if (!cards.length) {
    new Notice('No cards to export');
    return null;
  }

  try {
    const folder = normalizePath(`${plugin.settings.flashcardFolder || 'Flashcards'}/Exports`);
    await ensureVaultFolder(app, folder);

    const timestamp = createTimestamp();
    const extension = format === 'json' ? 'json' : 'md';
    const label = options?.label ? `-${options.label.replace(/[\\/:*?"<>|]/g, '')}` : '';
    const path = normalizePath(`${folder}/flashcards${label}-export-${timestamp}.${extension}`);
    const content = format === 'json'
      ? renderCardsJson(cards)
      : renderCardsMarkdown(cards);

    const file: TFile = await app.vault.create(path, content);

    if (options?.openFile !== false) {
      await app.workspace.getLeaf(false).openFile(file);
    }

    new Notice(`Exported ${cards.length} card(s) to ${path}`);
    return { path, count: cards.length };
  } catch (error) {
    console.error('Failed to export flashcards:', error);
    new Notice(`Failed to export cards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}
