import { BaseLLMClient } from "./BaseLLMClient";
import { ChutesConfig, ProviderRequestPayload, ProviderApiResponse } from "../types/providers";
import {
    TextGenerationOptions,
    VisionAnalysisOptions,
    GenerationResponse,
    AnalysisResponse
} from "../types/openrouter";
import { DebugLogger } from './DebugLogger';

/**
 * ChutesProvider class for Chutes.ai API integration
 * Implements text generation using Chutes.ai's API
 * Documentation: https://docs.chutes.ai/api
 * Note: This is a simplified implementation following the OpenRouter pattern
 */
export class ChutesProvider extends BaseLLMClient {
    private baseUrl: string;

    constructor(config: ChutesConfig, debugMode: boolean = false) {
        super(config, debugMode, 'ChutesProvider');
        this.baseUrl = config.baseUrl || "https://llm.chutes.ai/v1/chat/completions";
    }

    /**
     * Update base URL
     */
    updateBaseUrl(baseUrl: string): void {
        this.baseUrl = baseUrl;
    }

    /**
     * Generate text using Chutes API
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
            provider: 'Chutes',
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

            // Extract content with null checking
            const rawContent = result.choices?.[0]?.message?.content;
            const content = typeof rawContent === 'string' ? rawContent : '';

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
                provider: 'Chutes',
                model: options.model,
                operation: 'generateText'
            });
            if (error instanceof Error && error.name === 'OpenRouterError') {
                throw error;
            }
            throw new Error(`Chutes text generation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Analyze image using Chutes Vision API
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

            // Extract content with null checking
            const rawContent = result.choices?.[0]?.message?.content;
            const content = typeof rawContent === 'string' ? rawContent : '';

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
            throw new Error(`Chutes vision analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get provider name from response
     */
    protected getProviderName(response: ProviderApiResponse): string {
        return (response as any).provider?.name || "Chutes";
    }

    /**
     * Build request headers
     */
    protected buildHeaders(): Record<string, string> {
        return {
            "Authorization": `Bearer ${this.config.apiKey}`,
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
