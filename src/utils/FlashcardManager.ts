/**
 * @deprecated Superseded by the database-backed flashcard pipeline (SpacedRepetitionDatabase,
 * FlashcardGenerationView, SpacedRepetitionManualQuestionModal, SpacedRepetitionCardManagementView).
 * Kept temporarily so the one-time migration command can still parse files this class's format
 * produced. Safe to delete once migration tooling is no longer needed by any supported upgrade path.
 */

/**
 * FlashcardManager - Spaced Repetition Flashcard Management
 * 
 * Provides functionality to generate high-quality flashcards using an iterative LLM approach.
 * Supports multiple card styles and ensures proper formatting for Obsidian SR plugins.
 */

import { App, TFile, Notice } from 'obsidian';
import { LLMClientService } from './LLMClientService';
import { PluginSettings } from '../types';
import { TextGenerationOptions } from '../types/openrouter';
import { ErrorHandler } from './ErrorHandler';

export type CardStyle = 'basic' | 'cloze' | 'multiline';
export type Difficulty = 'Recall' | 'Analysis' | 'Application';

export interface FlashcardGenerationOptions {
    context: string;
    count: number;
    instructions: string;
    difficulty: Difficulty;
    cardStyle: CardStyle;
    sourceNote: string;
    onProgress?: (current: number, total: number) => void;
}

export class FlashcardManager {
    private app: App;
    private settings: PluginSettings;
    private llmClientService: LLMClientService;

    constructor(app: App, settings: PluginSettings, llmClientService: LLMClientService) {
        this.app = app;
        this.settings = settings;
        this.llmClientService = llmClientService;
    }

    /**
     * Get list of existing decks for a specific note
     * @param noteName - The name of the source note
     * @returns Promise<string[]> - Array of deck names (without .md extension)
     */
    async getDecksForNote(noteName: string): Promise<string[]> {
        try {
            const flashcardFolder = this.settings.flashcardFolder || 'Flashcards';
            const noteFolder = `${flashcardFolder}/${noteName}`;

            // Check if the note folder exists
            if (!await this.app.vault.adapter.exists(noteFolder)) {
                return [];
            }

            // Get all markdown files in the folder
            const files = await this.app.vault.adapter.list(noteFolder);
            
            // Filter and extract deck names
            const decks = files.files
                .filter((path: string) => path.endsWith('.md'))
                .map((path: string) => {
                    const fileName = path.split('/').pop() || '';
                    return fileName.replace(/\.md$/, '');
                });

            return decks;
        } catch (error) {
            ErrorHandler.handleError(error, 'FILE_OPERATION', {
                operation: 'getDecksForNote',
                noteName
            });
            return [];
        }
    }

    /**
     * Generate a batch of flashcards using iterative LLM approach
     * @param options - Generation options including context, count, instructions, etc.
     * @returns Promise<string[]> - Array of generated flashcard strings
     */
    async generateCardBatch(options: FlashcardGenerationOptions): Promise<string[]> {
        const { context, count, instructions, difficulty, cardStyle, sourceNote, onProgress } = options;

        try {
            // Step 1: Concept Extraction
            const concepts = await this.extractConcepts(context, count);
            
            if (concepts.length === 0) {
                throw new Error('No concepts could be extracted from the provided context');
            }

            // Step 2: Iterative Card Generation
            const cards: string[] = [];
            const totalCards = Math.min(concepts.length, count);

            for (let i = 0; i < totalCards; i++) {
                const concept = concepts[i];
                
                try {
                    // Update progress callback
                    if (onProgress) {
                        onProgress(i + 1, totalCards);
                    }

                    // Generate individual card
                    const card = await this.generateSingleCard(
                        concept,
                        difficulty,
                        instructions,
                        cardStyle,
                        context
                    );

                    // Append source note link
                    const cardWithSource = `${card}\n\n[[${sourceNote}]]`;
                    cards.push(cardWithSource);

                } catch (cardError) {
                    // Log error but continue with other cards
                    console.error(`Failed to generate card for concept "${concept}":`, cardError);
                    ErrorHandler.handleError(cardError, 'API_GENERATE_ERROR', {
                        operation: 'generateSingleCard',
                        concept,
                        difficulty,
                        cardStyle
                    });
                    // Continue with next card
                }
            }

            return cards;
        } catch (error) {
            ErrorHandler.handleError(error, 'API_GENERATE_ERROR', {
                operation: 'generateCardBatch',
                count,
                difficulty,
                cardStyle
            });
            throw error;
        }
    }

    /**
     * Extract key concepts from context using LLM
     * @param context - The text content to analyze
     * @param count - Number of concepts to extract
     * @returns Promise<string[]> - Array of concept strings
     */
    private async extractConcepts(context: string, count: number): Promise<string[]> {
        const client = this.llmClientService.getClient();
        if (!client) {
            throw new Error('LLM client not initialized');
        }

        const prompt = `Identify ${count} key concepts/facts from this text that are suitable for flashcards. 
Return ONLY a JSON string array of concepts. Do not include any other text or explanation.

Context:
${context}`;

        const options: TextGenerationOptions = {
            model: this.settings.openrouterTextModel || this.settings.defaultTextModel,
            message: prompt,
            temperature: 0.5,
            maxTokens: 1000,
            language: this.settings.defaultLanguage
        };

        try {
            const response = await client.generateText(options);
            const output = response.output.trim();

            // Try to parse JSON response
            try {
                // Extract JSON array from response (handle cases where LLM adds extra text)
                const jsonMatch = output.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const concepts = JSON.parse(jsonMatch[0]);
                    return Array.isArray(concepts) ? concepts : [];
                }
                
                // If no JSON array found, try parsing the entire output
                const parsed = JSON.parse(output);
                return Array.isArray(parsed) ? parsed : [];
            } catch (parseError) {
                console.error('Failed to parse concepts JSON:', parseError);
                throw new Error('Failed to parse concepts from LLM response');
            }
        } catch (error) {
            ErrorHandler.handleError(error, 'API_GENERATE_ERROR', {
                operation: 'extractConcepts',
                count
            });
            throw error;
        }
    }

    /**
     * Generate a single flashcard for a specific concept
     * @param concept - The concept to create a card for
     * @param difficulty - Difficulty level
     * @param instructions - Additional user instructions
     * @param cardStyle - Style of card to generate
     * @param context - Original context for reference
     * @returns Promise<string> - Generated flashcard string
     */
    private async generateSingleCard(
        concept: string,
        difficulty: Difficulty,
        instructions: string,
        cardStyle: CardStyle,
        context: string
    ): Promise<string> {
        const client = this.llmClientService.getClient();
        if (!client) {
            throw new Error('LLM client not initialized');
        }

        // Build prompt based on card style
        const styleInstructions = this.getStyleInstructions(cardStyle);
        
        const prompt = `Create a flashcard for the following concept.

Concept: "${concept}"
Difficulty: ${difficulty}
${instructions ? `Additional Instructions: ${instructions}` : ''}

${styleInstructions}

Context for reference:
${context}

IMPORTANT: Output ONLY the flashcard in the specified format. Do not include any explanations or extra text.`;

        const options: TextGenerationOptions = {
            model: this.settings.openrouterTextModel || this.settings.defaultTextModel,
            message: prompt,
            temperature: 0.7,
            maxTokens: 500,
            language: this.settings.defaultLanguage
        };

        try {
            const response = await client.generateText(options);
            let card = response.output.trim();

            // Ensure the card has the correct format based on style
            card = this.validateAndFixCardFormat(card, cardStyle);

            return card;
        } catch (error) {
            ErrorHandler.handleError(error, 'API_GENERATE_ERROR', {
                operation: 'generateSingleCard',
                concept,
                difficulty,
                cardStyle
            });
            throw error;
        }
    }

    /**
     * Get style-specific instructions for card generation
     * @param cardStyle - The card style
     * @returns Instructions string
     */
    private getStyleInstructions(cardStyle: CardStyle): string {
        switch (cardStyle) {
            case 'basic':
                return 'Format: "Question::Answer". Use the double colon (::) separator between question and answer.';
            case 'cloze':
                return 'Format: Create a sentence with the answer hidden using cloze deletion syntax: "The answer is {c1::answer}". You can use multiple clozes like {c1::answer1} {c2::answer2}.';
            case 'multiline':
                return 'Format: Use "Question::" followed by the question on the next line, then "Answer:" followed by the answer on subsequent lines. Use the double colon (::) separator.';
            default:
                return 'Format: "Question::Answer". Use the double colon (::) separator between question and answer.';
        }
    }

    /**
     * Validate and fix card format
     * @param card - The generated card
     * @param cardStyle - Expected card style
     * @returns Validated card string
     */
    private validateAndFixCardFormat(card: string, cardStyle: CardStyle): string {
        // For basic and multiline, ensure :: separator exists
        if (cardStyle === 'basic' || cardStyle === 'multiline') {
            if (!card.includes('::')) {
                // Try to infer question/answer split
                const parts = card.split('\n', 2);
                if (parts.length === 2) {
                    card = `${parts[0]}::${parts[1]}`;
                } else {
                    // Fallback: add separator at end
                    card = `${card}::`;
                }
            }
        }

        return card;
    }

    /**
     * Save flashcards to a deck file
     * @param noteName - The name of the source note
     * @param deckName - The name of the deck
     * @param cards - Array of flashcard strings
     * @returns Promise<string> - Full path to the saved file
     */
    async saveFlashcards(noteName: string, deckName: string, cards: string[]): Promise<string> {
        try {
            const flashcardFolder = this.settings.flashcardFolder || 'Flashcards';
            const subfolderPath = `${flashcardFolder}/${noteName}`;
            const filename = `${deckName}.md`;
            const filePath = `${subfolderPath}/${filename}`;

            // Ensure subfolder exists
            if (!await this.app.vault.adapter.exists(subfolderPath)) {
                await this.app.vault.createFolder(subfolderPath);
            }

            // Check if file exists
            const fileExists = await this.app.vault.adapter.exists(filePath);

            // Build content
            let content: string;
            
            if (fileExists) {
                // Append to existing file
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    const existingContent = await this.app.vault.read(file);
                    content = existingContent + '\n\n' + cards.join('\n\n');
                    await this.app.vault.modify(file, content);
                } else {
                    throw new Error(`File not found: ${filePath}`);
                }
            } else {
                // Create new file with header
                const header = `# Flashcards for [[${noteName}]]
#flashcard

`;
                content = header + cards.join('\n\n');
                await this.app.vault.create(filePath, content);
            }

            return filePath;
        } catch (error) {
            ErrorHandler.handleError(error, 'FILE_OPERATION', {
                operation: 'saveFlashcards',
                noteName,
                deckName
            });
            throw error;
        }
    }

    /**
     * Update settings
     * @param settings - New settings
     */
    updateSettings(settings: PluginSettings): void {
        this.settings = settings;
    }
}
