/**
 * OpenRouter Provider Client
 * OpenRouter-specific implementation of LLM provider
 */

import { BaseLLMClient } from './BaseLLMClient';
import {
    OpenRouterConfig,
    ProviderRequestPayload,
    ProviderApiResponse
} from '../types/providers';
import {
    TextGenerationOptions,
    VisionAnalysisOptions,
    GenerationResponse,
    AnalysisResponse
} from '../types/openrouter';
import { DebugLogger } from './DebugLogger';

/**
 * OpenRouter provider client
 */
export class OpenRouterProvider extends BaseLLMClient {
    private baseUrl: string;
    private referer: string;

    constructor(config: OpenRouterConfig, debugMode: boolean = false) {
        super(config, debugMode, 'OpenRouterProvider');
        this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1/chat/completions";
        this.referer = config.referer || "https://obsidian.md";
    }

    /**
     * Update base URL
     */
    updateBaseUrl(baseUrl: string): void {
        this.baseUrl = baseUrl;
    }

    /**
     * Generate text using OpenRouter API
     */
    async generateText(options: TextGenerationOptions): Promise<GenerationResponse> {
        const startTime = Date.now();

        // Build message content
        const messageContent = this.buildMessageContent(
            options.message,
            options.files,
            options.language
        );

        // Prepare request payload
        const payload = this.buildPayload({
            model: options.model,
            message: messageContent,
            temperature: options.temperature,
            maxTokens: options.maxTokens
        });

        // Prepare headers
        const headers = this.buildHeaders();

        // Log generation start
        this.debug.logStart('Text generation', {
            provider: 'OpenRouter',
            model: options.model,
            messageLength: messageContent.length,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            hasFiles: options.files && options.files.length > 0,
            language: options.language
        });

        try {
            // Make API request
            const response = await this.fetchWithRetry(
                this.baseUrl,
                {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload)
                }
            );

            // Parse response
            const result: ProviderApiResponse = await response.json();

            const content = this.extractMessageContent(result);

            // Extract metadata
            const providerMetadata = this.extractMetadata(result, startTime);

            // Log completion
            this.debug.logComplete('Text generation', DebugLogger.createTiming(startTime), {
                outputLength: content.length,
                providerName: providerMetadata.provider_name,
                actualModel: providerMetadata.actual_model
            });

            return {
                output: content,
                metadata: {
                    provider_name: providerMetadata.provider_name,
                    actual_model: providerMetadata.actual_model,
                    request_time: providerMetadata.request_time,
                    completion_time: providerMetadata.completion_time,
                    elapsed_time: providerMetadata.elapsed_time
                }
            };
        } catch (error) {
            this.debug.logError(error instanceof Error ? error : new Error(String(error)), {
                provider: 'OpenRouter',
                model: options.model,
                operation: 'generateText'
            });
            if (error instanceof Error && error.name === 'OpenRouterError') {
                throw error;
            }
            throw new Error(`OpenRouter text generation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Analyze image using OpenRouter Vision API
     */
    async analyzeImage(options: VisionAnalysisOptions): Promise<AnalysisResponse> {
        const startTime = Date.now();

        // Prepare request payload for vision
        const payload: ProviderRequestPayload = {
            model: options.model,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: options.prompt
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: options.imageUrl
                            }
                        }
                    ]
                }
            ],
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 2000
        };

        // Prepare headers
        const headers = this.buildHeaders();

        try {
            // Make API request
            const response = await this.fetchWithRetry(
                this.baseUrl,
                {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload)
                }
            );

            // Parse response
            const result: ProviderApiResponse = await response.json();

            const content = this.extractMessageContent(result);

            // Extract metadata
            const providerMetadata = this.extractMetadata(result, startTime);

            return {
                analysis: content,
                metadata: {
                    provider_name: providerMetadata.provider_name,
                    actual_model: providerMetadata.actual_model,
                    request_time: providerMetadata.request_time,
                    completion_time: providerMetadata.completion_time,
                    elapsed_time: providerMetadata.elapsed_time
                }
            };
        } catch (error) {
            if (error instanceof Error && error.name === 'OpenRouterError') {
                throw error;
            }
            throw new Error(`OpenRouter vision analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get provider name from response
     */
    protected getProviderName(response: ProviderApiResponse): string {
        return (response as any).provider?.name || "OpenRouter";
    }

    private extractMessageContent(result: ProviderApiResponse): string {
        const choice = result.choices?.[0];
        const message = choice?.message;
        const content = message?.content;

        if (typeof content === 'string' && content.trim()) {
            return content;
        }

        if (Array.isArray(content)) {
            const text = content
                .map((part) => {
                    if (typeof part === 'string') {
                        return part;
                    }
                    return part?.text ?? part?.content ?? '';
                })
                .filter((part) => part.trim())
                .join('\n');

            if (text.trim()) {
                return text;
            }
        }

        if (typeof message?.reasoning === 'string' && message.reasoning.trim()) {
            return message.reasoning;
        }

        const finishReason = choice?.finish_reason ?? 'unknown';
        const messageKeys = message ? Object.keys(message).join(', ') : 'none';
        throw new Error(`Invalid response format: missing choices content (finish_reason: ${finishReason}, message keys: ${messageKeys})`);
    }

    /**
     * Build request headers
     */
    protected buildHeaders(): Record<string, string> {
        return {
            "Authorization": `Bearer ${this.config.apiKey}`,
            "HTTP-Referer": this.referer,
            "Content-Type": "application/json"
        };
    }

    /**
     * Build request payload
     */
    protected buildPayload(options: TextGenerationOptions | VisionAnalysisOptions): ProviderRequestPayload {
        if ('message' in options) {
            // Text generation
            return {
                model: options.model,
                messages: [
                    {
                        role: "user",
                        content: options.message
                    }
                ],
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? 2000
            };
        } else {
            // Vision analysis
            const visionOptions = options as VisionAnalysisOptions;
            return {
                model: visionOptions.model,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: visionOptions.prompt
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: visionOptions.imageUrl
                                }
                            }
                        ]
                    }
                ],
                temperature: visionOptions.temperature ?? 0.7,
                max_tokens: visionOptions.maxTokens ?? 2000
            };
        }
    }
}

