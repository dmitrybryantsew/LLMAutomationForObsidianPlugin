import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * Labelled evaluation query set for the retrieval system (runbook §9.4).
 *
 * 40 queries grounded in the actual content of the fixture vault at
 * ../testMdFiles (10 .md files across 3 folders). Each query has one or more
 * expected file paths that must appear in the top-5 search results.
 *
 * Query categories:
 *  - exact:    a distinctive term that appears in exactly one file
 *  - paraphrase: a natural-language question whose answer lives in one file
 *  - multi:    a term appearing in several files (all expected files must be
 *              represented in the top-5, OR at least one if multi-note recall
 *              is measured loosely)
 *  - noanswer: a term that does not appear in any fixture file (expect 0 hits)
 *  - heading:  a query targeting a specific file + heading section
 */

export type QueryCategory = 'exact' | 'paraphrase' | 'multi' | 'noanswer' | 'heading';

export interface LabelledQuery {
  id: string;
  query: string;
  category: QueryCategory;
  /** Paths (relative to fixture root, forward slashes) that should appear in top-5. */
  expectedPaths: string[];
  /** For heading queries, the heading path that should appear. */
  expectedHeading?: string;
}

const FIXTURE_ROOT = path.resolve(
  path.join(process.cwd(), '..', 'testMdFiles')
);

// Normalise the agent's Windows-path labels to forward-slash relative paths.
function p(rel: string): string {
  return rel.replace(/\\/g, '/');
}

export const LABELLED_QUERIES: LabelledQuery[] = [
  // --- A. Exact-term queries (15) ---
  { id: 'A1', query: 'vibe coding', category: 'exact', expectedPaths: [p('Andrej_Karpathy/How_I_use_LLMs.md')] },
  { id: 'A2', query: 'NotebookLM', category: 'exact', expectedPaths: [p('Andrej_Karpathy/How_I_use_LLMs.md')] },
  { id: 'A3', query: 'FineWeb', category: 'exact', expectedPaths: [p('Andrej_Karpathy/Deep_Dive_into_LLMs_like_ChatGPT.md')] },
  { id: 'A4', query: 'Swiss cheese capabilities', category: 'exact', expectedPaths: [p('Andrej_Karpathy/Deep_Dive_into_LLMs_like_ChatGPT.md')] },
  { id: 'A5', query: '9.11 vs. 9.9', category: 'exact', expectedPaths: [p('Andrej_Karpathy/Deep_Dive_into_LLMs_like_ChatGPT.md')] },
  { id: 'A6', query: 'AlphaGo', category: 'exact', expectedPaths: [p('Andrej_Karpathy/Deep_Dive_into_LLMs_like_ChatGPT.md')] },
  { id: 'A7', query: 'FrontierMath', category: 'exact', expectedPaths: [p('AI_Explained/o3-mini_and_the_\u201cAI_War\u201d.md')] },
  { id: 'A8', query: 'Alexandr Wang', category: 'exact', expectedPaths: [p('AI_Explained/o3-mini_and_the_\u201cAI_War\u201d.md')] },
  { id: 'A9', query: 'Project Stargate', category: 'exact', expectedPaths: [p('AI_Explained/Nothing_Much_Happens_in_AI,_Then_Everything_Does_All_At_Once.md')] },
  { id: 'A10', query: "Humanity's Last Exam", category: 'exact', expectedPaths: [p('AI_Explained/Nothing_Much_Happens_in_AI,_Then_Everything_Does_All_At_Once.md')] },
  { id: 'A11', query: 'Protoclone', category: 'exact', expectedPaths: [p('AI_Explained/Claude_3.7_is_More_Significant_than_its_Name_Implies_(ft_DeepSeek_R2_+_GPT_4.5_coming_soon).md')] },
  { id: 'A12', query: 'Continue.dev', category: 'exact', expectedPaths: [p('AICodeKing/VSCode + ClaudeDev + Continue STOP PAYING for CURSOR with this OPENSOURCE & LOCAL Alternative.md')] },
  { id: 'A13', query: 'Tavily API', category: 'exact', expectedPaths: [p('AICodeKing/Ra-AID_SUPER_AGENTIC_Coder_This_3-STEP_Opensource_Agentic_CODER_Beats_CLINE_&_CURSOR.md')] },
  { id: 'A14', query: 'SambaNova', category: 'exact', expectedPaths: [p('AICodeKing/Deepseek_DEEP_Agent_This_AI_Agent_CAN_CONTROL_1000s_OF_BROWSERS_AT_ONCE!_(Deep_Research).md')] },
  { id: 'A15', query: 'vowel-ordered adjectives', category: 'exact', expectedPaths: [p('AICodeKing/DeepSeek-V3.1_(0324_-_Fully_Tested)_This_NEW_MAJOR_Upgrade_to_Deepseek_BEATS_3.7_Sonnet!.md')] },

  // --- B. Paraphrase queries (10) ---
  { id: 'B1', query: 'How does Karpathy use Cursor for AI-assisted app building', category: 'paraphrase', expectedPaths: [p('Andrej_Karpathy/How_I_use_LLMs.md')] },
  { id: 'B2', query: 'dataset with 15 trillion tokens from 44TB of data', category: 'paraphrase', expectedPaths: [p('Andrej_Karpathy/Deep_Dive_into_LLMs_like_ChatGPT.md')] },
  { id: 'B3', query: 'Sam Altman compared to Napoleon AI model release', category: 'paraphrase', expectedPaths: [p('AI_Explained/o3-mini_and_the_\u201cAI_War\u201d.md')] },
  { id: 'B4', query: '100 billion US AI investment compared to Manhattan Project', category: 'paraphrase', expectedPaths: [p('AI_Explained/Nothing_Much_Happens_in_AI,_Then_Everything_Does_All_At_Once.md')] },
  { id: 'B5', query: 'humanoid robot single neural network for collaboration', category: 'paraphrase', expectedPaths: [p('AI_Explained/Claude_3.7_is_More_Significant_than_its_Name_Implies_(ft_DeepSeek_R2_+_GPT_4.5_coming_soon).md')] },
  { id: 'B6', query: 'free local alternative to Cursor using VS Code extensions', category: 'paraphrase', expectedPaths: [p('AICodeKing/VSCode + ClaudeDev + Continue STOP PAYING for CURSOR with this OPENSOURCE & LOCAL Alternative.md')] },
  { id: 'B7', query: 'three-stage Research Planning Implementation architecture open-source coder', category: 'paraphrase', expectedPaths: [p('AICodeKing/Ra-AID_SUPER_AGENTIC_Coder_This_3-STEP_Opensource_Agentic_CODER_Beats_CLINE_&_CURSOR.md')] },
  { id: 'B8', query: 'AI coding agent MCP servers runs locally on macOS', category: 'paraphrase', expectedPaths: [p('AICodeKing/Goose_This_NEW_AI_Coding_Agent_is_PRETTY_AMAZING_&_Beats_CLINE_AIDER!.md')] },
  { id: 'B9', query: 'free alternative to OpenAI Deep Research control thousands of browsers', category: 'paraphrase', expectedPaths: [p('AICodeKing/Deepseek_DEEP_Agent_This_AI_Agent_CAN_CONTROL_1000s_OF_BROWSERS_AT_ONCE!_(Deep_Research).md')] },
  { id: 'B10', query: 'non-reasoning model beat Claude 3.7 Sonnet math front-end coding', category: 'paraphrase', expectedPaths: [p('AICodeKing/DeepSeek-V3.1_(0324_-_Fully_Tested)_This_NEW_MAJOR_Upgrade_to_Deepseek_BEATS_3.7_Sonnet!.md')] },

  // --- C. Multi-note queries (5) ---
  { id: 'C1', query: 'Aider', category: 'multi', expectedPaths: [
    p('AICodeKing/VSCode + ClaudeDev + Continue STOP PAYING for CURSOR with this OPENSOURCE & LOCAL Alternative.md'),
    p('AICodeKing/Ra-AID_SUPER_AGENTIC_Coder_This_3-STEP_Opensource_Agentic_CODER_Beats_CLINE_&_CURSOR.md'),
    p('AICodeKing/Goose_This_NEW_AI_Coding_Agent_is_PRETTY_AMAZING_&_Beats_CLINE_AIDER!.md'),
  ] },
  { id: 'C2', query: 'Cline', category: 'multi', expectedPaths: [
    p('AICodeKing/Ra-AID_SUPER_AGENTIC_Coder_This_3-STEP_Opensource_Agentic_CODER_Beats_CLINE_&_CURSOR.md'),
    p('AICodeKing/Goose_This_NEW_AI_Coding_Agent_is_PRETTY_AMAZING_&_Beats_CLINE_AIDER!.md'),
  ] },
  { id: 'C3', query: 'DeepSeek R1', category: 'multi', expectedPaths: [
    p('Andrej_Karpathy/How_I_use_LLMs.md'),
    p('Andrej_Karpathy/Deep_Dive_into_LLMs_like_ChatGPT.md'),
    p('AI_Explained/o3-mini_and_the_\u201cAI_War\u201d.md'),
    p('AI_Explained/Nothing_Much_Happens_in_AI,_Then_Everything_Does_All_At_Once.md'),
    p('AICodeKing/Goose_This_NEW_AI_Coding_Agent_is_PRETTY_AMAZING_&_Beats_CLINE_AIDER!.md'),
  ] },
  { id: 'C4', query: 'Hassabis AGI timeline', category: 'multi', expectedPaths: [
    p('AI_Explained/Nothing_Much_Happens_in_AI,_Then_Everything_Does_All_At_Once.md'),
    p('AI_Explained/Claude_3.7_is_More_Significant_than_its_Name_Implies_(ft_DeepSeek_R2_+_GPT_4.5_coming_soon).md'),
  ] },
  { id: 'C5', query: 'jailbreaking AI models', category: 'multi', expectedPaths: [
    p('AI_Explained/Nothing_Much_Happens_in_AI,_Then_Everything_Does_All_At_Once.md'),
    p('AI_Explained/Claude_3.7_is_More_Significant_than_its_Name_Implies_(ft_DeepSeek_R2_+_GPT_4.5_coming_soon).md'),
  ] },

  // --- D. No-answer queries (5) ---
  // These must use terms where NO individual token appears in the fixtures,
  // so FTS5 AND-matching returns zero hits. Terms like "Claude 4" fail because
  // "Claude" and "4" both appear individually.
  { id: 'D1', query: 'Windsurf Codeium', category: 'noanswer', expectedPaths: [] },
  { id: 'D2', query: 'Tabnine Kite', category: 'noanswer', expectedPaths: [] },
  { id: 'D3', query: 'Replit Ghostwriter', category: 'noanswer', expectedPaths: [] },
  { id: 'D4', query: 'Sourcegraph Cody', category: 'noanswer', expectedPaths: [] },
  { id: 'D5', query: 'Bito Qodo', category: 'noanswer', expectedPaths: [] },

  // --- D-hard. Hard no-answer queries (10) ---
  // These contain common words that DO appear individually in the fixtures
  // (in unrelated contexts), but the combined concept does not exist.
  // An OR fallback must NOT surface these unrelated chunks as evidence.
  { id: 'D6', query: 'Unity Blender physics game engine', category: 'noanswer', expectedPaths: [] },
  { id: 'D7', query: 'Android iOS mobile app development', category: 'noanswer', expectedPaths: [] },
  { id: 'D8', query: 'Tailwind Bootstrap CSS framework', category: 'noanswer', expectedPaths: [] },
  { id: 'D9', query: 'React Vue Angular Svelte comparison', category: 'noanswer', expectedPaths: [] },
  { id: 'D10', query: 'AWS Azure GCP cloud provider pricing', category: 'noanswer', expectedPaths: [] },
  { id: 'D11', query: 'medical hospital doctor health insurance', category: 'noanswer', expectedPaths: [] },
  { id: 'D12', query: 'nutrition diet cooking recipe blog', category: 'noanswer', expectedPaths: [] },
  { id: 'D13', query: 'business marketing finance sales strategy', category: 'noanswer', expectedPaths: [] },
  { id: 'D14', query: 'school university college lecture schedule', category: 'noanswer', expectedPaths: [] },
  { id: 'D15', query: 'Python Ruby Rust Go programming languages', category: 'noanswer', expectedPaths: [] },

  // --- E. Heading queries (5) ---
  { id: 'E1', query: 'DeepSeek-R1 chain-of-thought reasoning', category: 'heading', expectedPaths: [p('Andrej_Karpathy/Deep_Dive_into_LLMs_like_ChatGPT.md')] },
  { id: 'E2', query: 'Claude Artifacts app prototyping', category: 'heading', expectedPaths: [p('Andrej_Karpathy/How_I_use_LLMs.md')] },
  { id: 'E3', query: 'Simple Bench competition finale', category: 'heading', expectedPaths: [p('AI_Explained/o3-mini_and_the_\u201cAI_War\u201d.md')] },
  { id: 'E4', query: 'humanoid robot developments', category: 'heading', expectedPaths: [p('AI_Explained/Claude_3.7_is_More_Significant_than_its_Name_Implies_(ft_DeepSeek_R2_+_GPT_4.5_coming_soon).md')] },
  { id: 'E5', query: 'DeepSeek R1 analysis training secrets', category: 'heading', expectedPaths: [p('AI_Explained/Nothing_Much_Happens_in_AI,_Then_Everything_Does_All_At_Once.md')] },
];

export interface FixtureFile {
  rel: string;
  content: string;
  mtime: number;
  size: number;
}

export function listFixtureFiles(): FixtureFile[] {
  const out: FixtureFile[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = readFileSync(full, 'utf8');
        const st = statSync(full);
        const rel = path.relative(FIXTURE_ROOT, full).replace(/\\/g, '/');
        out.push({ rel, content, mtime: st.mtimeMs, size: Buffer.byteLength(content) });
      }
    }
  }
  walk(FIXTURE_ROOT);
  return out;
}

export { FIXTURE_ROOT };
