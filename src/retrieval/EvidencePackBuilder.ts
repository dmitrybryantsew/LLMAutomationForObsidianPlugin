import { EvidenceItem, EvidencePack, SearchHit } from '../types/retrieval';
import { estimateTokens } from './hashUtils';

export interface EvidencePackBuilderOptions {
  evidenceTokenBudget: number;
  instructionReserveRatio?: number;
}

export class EvidencePackBuilder {
  build(query: string, hits: SearchHit[], options: EvidencePackBuilderOptions): EvidencePack {
    const reserveRatio = options.instructionReserveRatio ?? 0.18;
    const usableBudget = Math.floor(options.evidenceTokenBudget * (1 - reserveRatio));
    const items: EvidenceItem[] = [];
    let totalEstimatedTokens = 0;
    let omittedHitCount = 0;

    hits.forEach((hit, index) => {
      const citationId = `S${index + 1}`;
      const estimated = estimateTokens(hit.text);
      const remaining = usableBudget - totalEstimatedTokens;

      if (remaining <= 0) {
        omittedHitCount += hits.length - index;
        return;
      }

      if (estimated <= remaining) {
        items.push({
          ...hit,
          citationId,
          estimatedTokens: estimated,
        });
        totalEstimatedTokens += estimated;
        return;
      }

      const truncatedText = truncateAtParagraphBoundary(hit.text, remaining * 4);
      if (!truncatedText) {
        omittedHitCount++;
        return;
      }

      items.push({
        ...hit,
        text: truncatedText,
        citationId,
        estimatedTokens: estimateTokens(truncatedText),
        truncated: true,
      });
      totalEstimatedTokens += estimateTokens(truncatedText);
      omittedHitCount += hits.length - index - 1;
    });

    return {
      query,
      items,
      totalEstimatedTokens,
      omittedHitCount,
    };
  }
}

function truncateAtParagraphBoundary(text: string, maxChars: number): string | null {
  if (maxChars <= 0) {
    return null;
  }
  if (text.length <= maxChars) {
    return text;
  }

  const paragraphs = text.split(/\n{2,}/);
  let result = '';
  for (const paragraph of paragraphs) {
    const next = result ? `${result}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      break;
    }
    result = next;
  }

  return result || null;
}

export function formatEvidenceForModel(item: EvidenceItem): string {
  const heading = item.headingPath.join(' > ');
  return [
    `[${item.citationId}]`,
    `Source: ${item.path}`,
    `Heading: ${heading}`,
    `Lines: ${item.startLine}-${item.endLine}`,
    'Content:',
    item.text,
  ].join('\n');
}

export function formatEvidenceFileContextName(item: EvidenceItem): string {
  const heading = item.headingPath.join(' > ');
  return `[${item.citationId}] ${item.basename} — ${heading}`;
}

export const GROUNDED_ANSWER_INSTRUCTION = [
  'Answer the user\'s question only from the supplied evidence.',
  'Cite every factual claim with the bracketed source ID, for example [S1].',
  'If evidence does not support the answer, say "I could not find this in the indexed sources."',
  'Do not invent citations, file paths, APIs, or details.',
  'Separate clearly any answer that relies on general knowledge, but general knowledge is disabled unless explicitly allowed.',
].join(' ');
