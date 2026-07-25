import {
  BoundedSourceRead,
  EvidencePack,
  KnowledgeAgentEvent,
  KnowledgeAgentEventCallback,
  KnowledgeAgentEvidence,
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

  /**
   * Full one-shot agent loop: search → read → answer.
   * Emits progress events via ``onEvent`` if provided.
   */
  async answer(
    question: string,
    options: Partial<KnowledgeAgentOptions> = {},
    onEvent?: KnowledgeAgentEventCallback
  ): Promise<KnowledgeAgentResult> {
    const opts = { ...DEFAULT_AGENT_OPTIONS, ...options };
    const startTime = performance.now();

    // Phase 1: gather evidence
    const evidence = await this.prepareEvidence(question, opts, onEvent);

    if (evidence.hits.length === 0) {
      const totalElapsed = performance.now() - startTime;
      onEvent?.({ phase: 'done', message: 'No evidence found' });
      return {
        answer: 'I could not find this in the indexed sources. No search results were returned.',
        citations: [],
        evidencePack: evidence.evidencePack,
        steps: evidence.steps,
        totalLatencyMs: totalElapsed,
        searchCalls: evidence.searchCalls,
        readCalls: evidence.readCalls,
        truncated: evidence.truncated,
      };
    }

    // Phase 2: generate answer from the gathered evidence
    const result = await this.generateAnswer(question, evidence, opts, onEvent);
    return {
      ...result,
      totalLatencyMs: performance.now() - startTime,
    };
  }

  /**
   * Phase 1: Search the knowledge base, ask the LLM which sources to read,
   * and return the selected evidence. The caller can preview this evidence
   * (with checkboxes) before calling ``generateAnswer``.
   */
  async prepareEvidence(
    question: string,
    options: Partial<KnowledgeAgentOptions> = {},
    onEvent?: KnowledgeAgentEventCallback
  ): Promise<KnowledgeAgentEvidence> {
    const opts = { ...DEFAULT_AGENT_OPTIONS, ...options };
    const steps: KnowledgeAgentStep[] = [];
    let searchCalls = 0;
    let readCalls = 0;
    const readChunks = new Map<string, SearchHit>();
    let truncated = false;

    // Step 0: Extract search terms from the question
    onEvent?.({ phase: 'extracting-terms', message: 'Extracting search terms...' });
    const refinedQuery = await this.extractSearchTerms(question, opts);
    steps.push({
      type: 'search',
      query: refinedQuery,
      searchResultCount: 0,
      searchResultPaths: [],
      searchResultSnippets: [],
      latencyMs: 0,
    });

    // Step 1: Search with refined query
    onEvent?.({ phase: 'searching', message: `Searching: "${refinedQuery.slice(0, 60)}"...` });
    const searchStart = performance.now();
    const hits = await this.deps.retrievalService.search({
      query: refinedQuery,
      limit: 20,
    });
    const searchElapsed = performance.now() - searchStart;
    searchCalls++;

    // Update the search step with results
    const searchStep = steps[0];
    searchStep.searchResultCount = hits.length;
    searchStep.searchResultPaths = hits.slice(0, 10).map((h) => h.path);
    searchStep.searchResultSnippets = hits.slice(0, 10).map((h) => this.formatSnippet(h));
    searchStep.latencyMs = searchElapsed;

    if (hits.length === 0) {
      onEvent?.({ phase: 'done', message: 'No search results' });
      return {
        hits: [],
        evidencePack: { query: question, items: [], totalEstimatedTokens: 0, omittedHitCount: 0 },
        steps,
        searchCalls,
        readCalls,
        truncated,
        refinedQuery,
      };
    }

    // Step 2: Ask LLM which sources to read
    onEvent?.({ phase: 'selecting', message: 'Selecting sources to read...' });
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
    onEvent?.({ phase: 'reading', message: `Reading ${readIndices.length || 'top'} sources...` });
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

    // Build evidence pack from read chunks
    const selectedHits = Array.from(readChunks.values());
    const evidencePack = await this.buildEvidencePack(question, selectedHits, opts);

    onEvent?.({
      phase: 'done',
      message: `Found ${selectedHits.length} evidence source(s)`,
      data: selectedHits,
    });

    return {
      hits: selectedHits,
      evidencePack,
      steps,
      searchCalls,
      readCalls,
      truncated,
      refinedQuery,
    };
  }

  /**
   * Phase 2: Generate a grounded answer from the selected evidence.
   * The caller may have modified the hits (e.g. deselected some via checkboxes)
   * before calling this.
   */
  async generateAnswer(
    question: string,
    evidence: KnowledgeAgentEvidence,
    options: Partial<KnowledgeAgentOptions> = {},
    onEvent?: KnowledgeAgentEventCallback
  ): Promise<KnowledgeAgentResult> {
    const opts = { ...DEFAULT_AGENT_OPTIONS, ...options };

    onEvent?.({ phase: 'answering', message: 'Generating answer...' });
    const answerPrompt = this.buildAnswerPrompt(question, evidence.hits, opts);
    const answerStart = performance.now();
    const answer = await this.deps.generateText({
      model: this.deps.model,
      message: answerPrompt,
      temperature: opts.temperature,
      maxTokens: opts.maxAnswerTokens,
    });
    const answerElapsed = performance.now() - answerStart;

    const citations = this.extractCitations(answer);

    const steps = [...evidence.steps];
    steps.push({
      type: 'answer',
      answer,
      citations,
      latencyMs: answerElapsed,
    });

    onEvent?.({ phase: 'done', message: 'Answer generated' });

    return {
      answer,
      citations,
      evidencePack: evidence.evidencePack,
      steps,
      totalLatencyMs: 0,
      searchCalls: evidence.searchCalls,
      readCalls: evidence.readCalls,
      truncated: evidence.truncated,
    };
  }

  private formatSnippet(hit: SearchHit): string {
    const heading = hit.headingPath.length > 0 ? hit.headingPath.join(' > ') : '';
    const snippet = hit.text.slice(0, 200).replace(/\n/g, ' ');
    return `[${heading || hit.basename}] ${snippet}...`;
  }

  private async extractSearchTerms(
    question: string,
    opts: KnowledgeAgentOptions
  ): Promise<string> {
    const words = question.trim().split(/\s+/);
    if (words.length <= 5) return question;

    const prompt = `Extract 2-5 key search terms from this question. Reply with ONLY the terms separated by spaces, nothing else.

Question: ${question}

Search terms:`;

    try {
      const response = await this.deps.generateText({
        model: this.deps.model,
        message: prompt,
        temperature: 0.1,
        maxTokens: 50,
      });
      const cleaned = response.trim().replace(/^search terms?:?\s*/i, '').trim();
      if (cleaned.length > 0 && cleaned.length < question.length) {
        return cleaned;
      }
    } catch {
      // Fall through to simple truncation
    }

    return words.slice(0, 5).join(' ');
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
    if (opts.allowGeneralKnowledge) {
      lines.push('');
      lines.push('If you use general knowledge not from the evidence, label it as "General knowledge (uncited)" and do not present it as source evidence.');
    }
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
