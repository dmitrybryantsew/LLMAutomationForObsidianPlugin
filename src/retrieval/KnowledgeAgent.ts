import {
  BoundedSourceRead,
  EvidencePack,
  KnowledgeAgentOptions,
  KnowledgeAgentResult,
  KnowledgeAgentStep,
  SearchHit,
  SearchRequest,
} from '../types/retrieval';
import { DEFAULT_AGENT_OPTIONS } from '../types/retrieval';
import { GROUNDED_ANSWER_INSTRUCTION } from './EvidencePackBuilder';
import { RetrievalService } from './RetrievalService';

export interface KnowledgeAgentDeps {
  retrievalService: RetrievalService;
  generateText: (options: {
    model: string;
    message: string;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<string>;
  model: string;
}

const SEARCH_RESULTS_HEADER = `You are a knowledge retrieval assistant. You search a local knowledge base and answer questions with citations.

You have access to a search tool. Below are the current search results for the user's question.
Review the results. If you need more detail, you can request to read specific results by number.
If you have enough information, write your final answer.

Search results (numbered):
`;

const READ_REQUEST_PROMPT = `Below are the full text excerpts of the sources you requested.
Read them carefully, then write your final answer to the user's question.
Cite every factual claim with the bracketed source ID, for example [S1].
If the evidence is insufficient, say "I could not find this in the indexed sources."

Sources:
`;

export class KnowledgeAgent {
  constructor(private deps: KnowledgeAgentDeps) {}

  async answer(
    question: string,
    options: Partial<KnowledgeAgentOptions> = {}
  ): Promise<KnowledgeAgentResult> {
    const opts = { ...DEFAULT_AGENT_OPTIONS, ...options };
    const startTime = performance.now();

    const steps: KnowledgeAgentStep[] = [];
    let searchCalls = 0;
    let readCalls = 0;
    const readChunks = new Map<string, SearchHit>();
    const allHits: SearchHit[] = [];
    let truncated = false;

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), opts.timeoutMs);

    try {
      // Step 1: Initial search
      const initialQuery = question;
      const searchStart = performance.now();
      const hits = await this.deps.retrievalService.search({
        query: initialQuery,
        limit: 20,
      });
      const searchElapsed = performance.now() - searchStart;
      searchCalls++;

      allHits.push(...hits);

      steps.push({
        type: 'search',
        query: initialQuery,
        searchResultCount: hits.length,
        searchResultPaths: hits.slice(0, 10).map((h) => h.path),
        searchResultSnippets: hits.slice(0, 10).map((h) => this.formatSnippet(h)),
        latencyMs: searchElapsed,
      });

      if (hits.length === 0) {
        const answer = 'I could not find this in the indexed sources. No search results were returned.';
        const totalElapsed = performance.now() - startTime;
        return {
          answer,
          citations: [],
          evidencePack: { query: question, items: [], totalEstimatedTokens: 0, omittedHitCount: 0 },
          steps,
          totalLatencyMs: totalElapsed,
          searchCalls,
          readCalls,
          truncated,
        };
      }

      // Step 2: Ask LLM which sources to read (or if it can answer from snippets)
      const selectionPrompt = this.buildSelectionPrompt(question, hits, opts);
      const selectionStart = performance.now();
      const selectionResponse = await this.deps.generateText({
        model: this.deps.model,
        message: selectionPrompt,
        temperature: 0.1,
        maxTokens: 500,
      });
      const selectionElapsed = performance.now() - selectionStart;

      const readIndices = this.parseReadRequest(selectionResponse, hits.length);

      steps.push({
        type: 'read',
        readChunkId: readIndices.length > 0 ? readIndices.map((i) => hits[i]?.id).filter(Boolean).join(', ') : undefined,
        readPath: readIndices.length > 0 ? readIndices.map((i) => hits[i]?.path).filter(Boolean).join(', ') : undefined,
        readSnippet: selectionResponse.slice(0, 200),
        latencyMs: selectionElapsed,
      });

      // Step 3: Read the selected sources
      for (const idx of readIndices) {
        if (readCalls >= opts.maxReadCalls) {
          truncated = true;
          break;
        }
        const hit = hits[idx];
        if (!hit) continue;
        readChunks.set(hit.id, hit);
        readCalls++;
      }

      // If LLM didn't select any reads, use top hits by default
      if (readChunks.size === 0 && hits.length > 0) {
        const defaultReadCount = Math.min(3, hits.length, opts.maxReadCalls);
        for (let i = 0; i < defaultReadCount; i++) {
          readChunks.set(hits[i].id, hits[i]);
          readCalls++;
        }
      }

      // Step 4: Build evidence pack from read chunks
      const selectedHits = Array.from(readChunks.values());
      const evidencePack = this.deps.retrievalService
        ? await this.buildEvidencePack(question, selectedHits, opts)
        : { query: question, items: [], totalEstimatedTokens: 0, omittedHitCount: 0 };

      // Step 5: Generate final answer
      const answerPrompt = this.buildAnswerPrompt(question, selectedHits, opts);
      const answerStart = performance.now();
      const answer = await this.deps.generateText({
        model: this.deps.model,
        message: answerPrompt,
        temperature: opts.temperature,
        maxTokens: opts.maxAnswerTokens,
      });
      const answerElapsed = performance.now() - answerStart;

      const citations = this.extractCitations(answer);

      steps.push({
        type: 'answer',
        answer,
        citations,
        latencyMs: answerElapsed,
      });

      const totalElapsed = performance.now() - startTime;

      return {
        answer,
        citations,
        evidencePack,
        steps,
        totalLatencyMs: totalElapsed,
        searchCalls,
        readCalls,
        truncated,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private formatSnippet(hit: SearchHit): string {
    const heading = hit.headingPath.length > 0 ? hit.headingPath.join(' > ') : '';
    const snippet = hit.text.slice(0, 200).replace(/\n/g, ' ');
    return `[${heading || hit.basename}] ${snippet}...`;
  }

  private buildSelectionPrompt(
    question: string,
    hits: SearchHit[],
    opts: KnowledgeAgentOptions
  ): string {
    const lines: string[] = [];
    lines.push(SEARCH_RESULTS_HEADER);
    lines.push('');

    for (let i = 0; i < Math.min(hits.length, 10); i++) {
      const hit = hits[i];
      const heading = hit.headingPath.length > 0 ? hit.headingPath.join(' > ') : '';
      const snippet = hit.text.slice(0, 300).replace(/\n/g, ' ');
      lines.push(`[${i + 1}] ${hit.basename} — ${heading}`);
      lines.push(`    ${snippet}...`);
      lines.push('');
    }

    lines.push(`User question: ${question}`);
    lines.push('');
    lines.push('Reply with ONLY the numbers of the sources you want to read in full (e.g. "1,3,5").');
    lines.push('If you can answer from the snippets alone, reply with "ANSWER".');

    return lines.join('\n');
  }

  private parseReadRequest(response: string, hitCount: number): number[] {
    const trimmed = response.trim().toUpperCase();

    if (trimmed.includes('ANSWER')) return [];

    const numbers = trimmed.match(/\d+/g);
    if (!numbers) return [];

    const indices = numbers
      .map((n) => parseInt(n, 10) - 1)
      .filter((i) => i >= 0 && i < hitCount);

    return [...new Set(indices)];
  }

  private buildAnswerPrompt(
    question: string,
    hits: SearchHit[],
    opts: KnowledgeAgentOptions
  ): string {
    const lines: string[] = [];
    lines.push(GROUNDED_ANSWER_INSTRUCTION);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('EVIDENCE:');
    lines.push('');

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const citationId = `S${i + 1}`;
      const heading = hit.headingPath.length > 0 ? hit.headingPath.join(' > ') : '';
      lines.push(`[${citationId}] ${hit.path} — ${heading} (lines ${hit.startLine}-${hit.endLine})`);
      lines.push('```');
      lines.push(hit.text);
      lines.push('```');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push(`User question: ${question}`);
    lines.push('');
    lines.push('Answer the question using only the evidence above. Cite claims with [S1], [S2], etc.');

    return lines.join('\n');
  }

  private extractCitations(answer: string): string[] {
    const matches = answer.match(/\[S\d+\]/g);
    return matches ? [...new Set(matches)] : [];
  }

  private async buildEvidencePack(
    query: string,
    hits: SearchHit[],
    opts: KnowledgeAgentOptions
  ): Promise<EvidencePack> {
    const { EvidencePackBuilder } = await import('./EvidencePackBuilder');
    const builder = new EvidencePackBuilder();
    return builder.build(query, hits, { evidenceTokenBudget: opts.maxEvidenceTokens });
  }
}
