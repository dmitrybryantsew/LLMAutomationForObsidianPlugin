export interface PluginCommandCatalogEntry {
  id: string;
  name: string;
  group: string;
  description: string;
  hotkeys?: string[];
}

export const COMMAND_CHEATSHEET_NOTE_PATH = 'LLM Automation Plugin Commands.md';

export const PLUGIN_COMMAND_CATALOG: PluginCommandCatalogEntry[] = [
  {
    id: 'create-command-cheatsheet',
    name: 'Create/Update Plugin Commands Cheatsheet',
    group: 'Plugin Help',
    description: 'Creates or updates this generated note with all command palette commands registered by the plugin.',
  },
  {
    id: 'open-text-generator-panel',
    name: 'Open Text Generator Panel',
    group: 'Generation',
    description: 'Opens the text generation side panel.',
  },
  {
    id: 'add-manual-spaced-repetition-question',
    name: 'Add Manual Spaced Repetition Question',
    group: 'Spaced Repetition',
    description: 'Adds a manually written review question linked to the active note.',
  },
  {
    id: 'generate-spaced-repetition-from-current-note',
    name: 'Generate Spaced Repetition Questions From Current Note',
    group: 'Spaced Repetition',
    description: 'Uses Ollama to generate review questions from the active note and saves them to the spaced repetition database.',
  },
  {
    id: 'open-spaced-repetition-review',
    name: 'Open Spaced Repetition Review',
    group: 'Spaced Repetition',
    description: 'Opens the review view for due spaced repetition cards.',
  },
  {
    id: 'chat-with-current-note-ollama',
    name: 'Chat With Current Note Using Ollama',
    group: 'Spaced Repetition',
    description: 'Chats with Ollama using the active note as context and saves the chat history in the spaced repetition database.',
  },
  {
    id: 'open-image-generator-panel',
    name: 'Open Image Generator Panel',
    group: 'Generation',
    description: 'Opens the image generation side panel.',
  },
  {
    id: 'request-transcript',
    name: 'Request Video Transcript',
    group: 'Video And Transcripts',
    description: 'Requests a transcript for a video URL.',
  },
  {
    id: 'create-video-summary',
    name: 'Create Video Summary',
    group: 'Video And Transcripts',
    description: 'Creates a summary for a single video.',
  },
  {
    id: 'batch-video-summary',
    name: 'Batch Video Summarization',
    group: 'Video And Transcripts',
    description: 'Creates summaries for a playlist or batch of videos.',
  },
  {
    id: 'video-processing-queue',
    name: 'Open Video Processing Queue',
    group: 'Video And Transcripts',
    description: 'Opens the video processing queue view.',
  },
  {
    id: 'request-article-summary',
    name: 'Summarize Web Article',
    group: 'Articles',
    description: 'Creates a summary for a web article.',
  },
  {
    id: 'process-local-transcript',
    name: 'Process Local Transcript File',
    group: 'Video And Transcripts',
    description: 'Processes a transcript file already stored locally.',
  },
  {
    id: 'view-transcript-from-database',
    name: 'View Transcript from Database',
    group: 'Database',
    description: 'Opens database-stored transcript content for the active note.',
  },
  {
    id: 'init-tags',
    name: 'Init=tags',
    group: 'Tags',
    description: 'Initializes the managed tag set and shows the known tags.',
  },
  {
    id: 'scan-vault-transcript-notes',
    name: 'Scan Vault for AI-Generated Notes with Transcripts',
    group: 'Database',
    description: 'Scans the vault for notes with embedded or database-backed transcript content.',
  },
  {
    id: 'migrate-transcripts-to-database',
    name: 'Migrate All Transcripts to Database',
    group: 'Database',
    description: 'Moves embedded transcript content into the local transcript database.',
  },
  {
    id: 'migrate-descriptions-to-database',
    name: 'Migrate Descriptions to Database',
    group: 'Database',
    description: 'Moves embedded descriptions into the local transcript database.',
  },
  {
    id: 'migrate-detailed-summaries-to-database',
    name: 'Migrate Detailed Summaries to Database',
    group: 'Database',
    description: 'Moves embedded detailed summaries into the local transcript database.',
  },
  {
    id: 'cleanup-standalone-transcripts',
    name: 'Clean Up Standalone Transcript Files',
    group: 'Database',
    description: 'Finds standalone transcript files and offers cleanup options.',
  },
  {
    id: 'delete-note-with-database-cleanup',
    name: 'Delete Current Note (with Database Cleanup)',
    group: 'Database',
    description: 'Deletes the active note and associated database records after confirmation.',
  },
  {
    id: 'quick-context-query',
    name: 'Quick Query (Current Note Context)',
    group: 'Generation',
    description: 'Asks an LLM a quick question using the current note as context.',
    hotkeys: ['Mod+Shift+Q'],
  },
  {
    id: 'generate-quiz',
    name: 'Generate Quiz from Context',
    group: 'Learning',
    description: 'Generates quiz questions from the active note or selected context.',
  },
  {
    id: 'generate-flashcards',
    name: 'Generate Flashcards from Context',
    group: 'Learning',
    description: 'Generates flashcards from the active note or selected context.',
  },
  {
    id: 'initialize-path-structure',
    name: 'Initialize Path Structure',
    group: 'Path Structure',
    description: 'Initializes the knowledge-base path/domain structure.',
  },
  {
    id: 'add-domain',
    name: 'Add New Knowledge Domain',
    group: 'Path Structure',
    description: 'Adds a new top-level knowledge domain.',
  },
  {
    id: 'add-subject',
    name: 'Add New Subject to Domain',
    group: 'Path Structure',
    description: 'Adds a subject under an existing domain.',
  },
  {
    id: 'add-topic',
    name: 'Add New Topic to Subject',
    group: 'Path Structure',
    description: 'Adds a topic under an existing subject.',
  },
  {
    id: 'add-series',
    name: 'Add New Series to Topic',
    group: 'Path Structure',
    description: 'Adds a content series under an existing topic.',
  },
  {
    id: 'add-author',
    name: 'Add New Author to Series',
    group: 'Path Structure',
    description: 'Adds an author under an existing series.',
  },
  {
    id: 'link-content',
    name: 'Link Existing Content File',
    group: 'Path Structure',
    description: 'Links an existing note or content file into the path structure.',
  },
  {
    id: 'create-path-backup',
    name: 'Create Path Structure Backup',
    group: 'Path Structure',
    description: 'Creates a backup of the current path structure data.',
  },
];

export function renderCommandCheatsheet(): string {
  const generatedAt = new Date().toISOString();
  const groups = Array.from(new Set(PLUGIN_COMMAND_CATALOG.map((entry) => entry.group)));

  const sections = groups.map((group) => {
    const rows = PLUGIN_COMMAND_CATALOG
      .filter((entry) => entry.group === group)
      .map((entry) => {
        const hotkeys = entry.hotkeys?.join(', ') ?? '';
        return `| ${entry.name} | \`${entry.id}\` | ${hotkeys} | ${entry.description} |`;
      })
      .join('\n');

    return `## ${group}\n\n| Command | ID | Hotkeys | What it does |\n| --- | --- | --- | --- |\n${rows}`;
  });

  return [
    '# LLM Automation Plugin Commands',
    '',
    `Generated: ${generatedAt}`,
    '',
    'This note is generated by the plugin command `Create/Update Plugin Commands Cheatsheet`.',
    '',
    ...sections,
    '',
  ].join('\n');
}
