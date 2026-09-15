import { BaseLLMClient } from './BaseLLMClient';
import {
    ProviderApiResponse,
    ProviderRequestPayload,
    QwenGateConfig
} from '../types/providers';
import {
    AnalysisResponse,
    GenerationResponse,
    TextGenerationOptions,
    VisionAnalysisOptions
} from '../types/openrouter';
import { DebugLogger } from './DebugLogger';

interface QwenGateModelsResponse {
    data?: Array<{
        id?: string;
        name?: string;
    }>;
}

/**
 * Client for a local QwenGate instance (OpenAI-compatible Qwen gateway).
 * The gateway runs on the user's machine and does not require an API key.
 * Qwen models are thinking models: the visible answer arrives in `content`
 * while chain-of-thought arrives in `reasoning_content` — this client uses
 * content only, falling back to reasoning_content if content is empty.
 */
export class QwenGateProvider extends BaseLLMClient {
    private apiBase: string;

    constructor(config: QwenGateConfig, debugMode: boolean = false) {
        super(config, debugMode, 'QwenGateProvider');
        this.apiBase = this.normalizeApiBase(config.baseUrl || 'http://localhost:26405/v1');
    }

    updateBaseUrl(baseUrl: string): void {
        this.apiBase = this.normalizeApiBase(baseUrl);
    }

    async generateText(options: TextGenerationOptions): Promise<GenerationResponse> {
        const startTime = Date.now();
        const messageContent = this.buildMessageContent(options.message, options.files, options.language);
        const payload = this.buildPayload({
            ...options,
            message: messageContent
        });

        this.debug.logStart('Text generation', {
            provider: 'QwenGate',
            model: options.model,
            messageLength: messageContent.length,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            topP: options.topP
        });

        try {
            const response = await this.fetchWithRetry(
                `${this.apiBase}/chat/completions`,
                {
                    method: 'POST',
                    headers: this.buildHeaders(),
                    body: JSON.stringify(payload)
                }
            );

            const result: ProviderApiResponse = await response.json();
            const content = this.extractMessageContent(result);
            const providerMetadata = this.extractMetadata(result, startTime);

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
                provider: 'QwenGate',
                model: options.model,
                operation: 'generateText'
            });
            const detail = error instanceof Error ? error.message : 'Unknown error';
            const status = (error as { statusCode?: number })?.statusCode;
            const statusPrefix = status ? ` (HTTP ${status})` : '';
            throw new Error(`QwenGate text generation error${statusPrefix}: ${detail}`);
        }
    }

    async analyzeImage(options: VisionAnalysisOptions): Promise<AnalysisResponse> {
        const startTime = Date.now();
        const payload = this.buildPayload(options);
        const response = await this.fetchWithRetry(
            `${this.apiBase}/chat/completions`,
            {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(payload)
            }
        );

        const result: ProviderApiResponse = await response.json();
        const content = this.extractMessageContent(result);
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
    }

    async listModels(): Promise<string[]> {
        const response = await this.fetchWithRetry(
            `${this.apiBase}/models`,
            {
                method: 'GET',
                headers: this.buildHeaders()
            }
        );

        const result: QwenGateModelsResponse = await response.json();
        return (result.data ?? [])
            .map(model => model.id || model.name)
            .filter((model): model is string => Boolean(model));
    }

    protected getProviderName(_response: ProviderApiResponse): string {
        return 'QwenGate';
    }

    protected buildHeaders(): Record<string, string> {
        // Local gateway — no real auth, but keep the header for OpenAI-compat shape.
        return {
            Authorization: `Bearer ${this.config.apiKey || 'local'}`,
            'Content-Type': 'application/json'
        };
    }

    protected buildPayload(options: TextGenerationOptions | VisionAnalysisOptions): ProviderRequestPayload {
        const payload: ProviderRequestPayload = 'message' in options
            ? {
                model: options.model,
                messages: [
                    {
                        role: 'user',
                        content: options.message
                    }
                ],
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? 2000
            }
            : {
                model: options.model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: options.prompt },
                            { type: 'image_url', image_url: { url: options.imageUrl } }
                        ]
                    }
                ],
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? 2000
            };

        this.applyOptionalRequestSettings(payload, options);
        return payload;
    }

    private applyOptionalRequestSettings(
        payload: ProviderRequestPayload,
        options: TextGenerationOptions | VisionAnalysisOptions
    ): void {
        if (options.topP !== undefined) {
            payload.top_p = options.topP;
        }
        if (options.presencePenalty !== undefined) {
            payload.presence_penalty = options.presencePenalty;
        }
        if (options.frequencyPenalty !== undefined) {
            payload.frequency_penalty = options.frequencyPenalty;
        }
    }

    private extractMessageContent(result: ProviderApiResponse): string {
        const message = result.choices?.[0]?.message;
        const content = message?.content;

        let text = '';
        if (typeof content === 'string') {
            text = content;
        } else if (Array.isArray(content)) {
            text = content
                .map(part => typeof part === 'string' ? part : part.text ?? part.content ?? '')
                .filter(Boolean)
                .join('\n');
        }

        // Qwen thinking models may return the answer only in reasoning_content
        // when content is empty.
        if (!text.trim()) {
            const reasoning = message?.reasoning ?? (message as any)?.reasoning_content;
            if (typeof reasoning === 'string' && reasoning.trim()) {
                text = reasoning;
            }
        }

        return text;
    }

    private normalizeApiBase(baseUrl: string): string {
        let value = baseUrl.trim().replace(/\/+$/, '');
        value = value.replace(/\/chat\/completions$/, '');
        if (!value.endsWith('/v1')) {
            value = `${value}/v1`;
        }
        return value;
    }
}
