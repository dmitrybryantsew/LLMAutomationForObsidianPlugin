import { BaseLLMClient } from './BaseLLMClient';
import {
    OllamaConfig,
    ProviderApiResponse,
    ProviderRequestPayload
} from '../types/providers';
import {
    AnalysisResponse,
    GenerationResponse,
    TextGenerationOptions,
    VisionAnalysisOptions
} from '../types/openrouter';
import { DebugLogger } from './DebugLogger';

interface OllamaChatResponse {
    model?: string;
    message?: {
        role?: string;
        content?: string;
    };
    response?: string;
    done?: boolean;
}

interface OllamaTagsResponse {
    models?: Array<{
        name?: string;
        model?: string;
    }>;
}

export class OllamaProvider extends BaseLLMClient {
    private baseUrl: string;

    constructor(config: OllamaConfig, debugMode: boolean = false) {
        super({
            ...config,
            apiKey: config.apiKey || '',
            timeout: config.timeout ?? 120000
        }, debugMode, 'OllamaProvider');
        this.baseUrl = this.normalizeBaseUrl(config.baseUrl || 'http://localhost:11434');
    }

    updateBaseUrl(baseUrl: string): void {
        this.baseUrl = this.normalizeBaseUrl(baseUrl);
    }

    async generateText(options: TextGenerationOptions): Promise<GenerationResponse> {
        const startTime = Date.now();
        const messageContent = this.buildMessageContent(options.message, options.files, options.language);
        const payload = this.buildPayload({
            model: options.model,
            message: messageContent,
            temperature: options.temperature,
            maxTokens: options.maxTokens
        });

        this.debug.logStart('Text generation', {
            provider: 'Ollama',
            model: options.model,
            messageLength: messageContent.length,
            temperature: options.temperature,
            maxTokens: options.maxTokens
        });

        try {
            const response = await this.fetchWithRetry(
                `${this.baseUrl}/api/chat`,
                {
                    method: 'POST',
                    headers: this.buildHeaders(),
                    body: JSON.stringify(payload)
                }
            );
            const result: OllamaChatResponse = await response.json();
            const content = result.message?.content ?? result.response ?? '';

            if (!content) {
                throw new Error('Invalid Ollama response format: missing message content');
            }

            this.debug.logComplete('Text generation', DebugLogger.createTiming(startTime), {
                outputLength: content.length,
                actualModel: result.model || options.model
            });

            return {
                output: content,
                metadata: {
                    provider_name: 'Ollama',
                    actual_model: result.model || options.model,
                    request_time: new Date(startTime).toISOString(),
                    completion_time: new Date().toISOString(),
                    elapsed_time: ((Date.now() - startTime) / 1000).toFixed(2)
                }
            };
        } catch (error) {
            this.debug.logError(error instanceof Error ? error : new Error(String(error)), {
                provider: 'Ollama',
                model: options.model,
                operation: 'generateText'
            });
            throw new Error(`Ollama text generation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async analyzeImage(_options: VisionAnalysisOptions): Promise<AnalysisResponse> {
        throw new Error('Ollama vision analysis is not implemented for this plugin provider yet.');
    }

    async listModels(): Promise<string[]> {
        const response = await this.fetchWithRetry(
            `${this.baseUrl}/api/tags`,
            {
                method: 'GET',
                headers: this.buildHeaders()
            }
        );
        const result: OllamaTagsResponse = await response.json();
        return (result.models ?? [])
            .map(model => model.name || model.model)
            .filter((model): model is string => Boolean(model));
    }

    protected getProviderName(_response: ProviderApiResponse): string {
        return 'Ollama';
    }

    protected buildHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json'
        };
    }

    protected buildPayload(options: TextGenerationOptions | VisionAnalysisOptions): ProviderRequestPayload {
        if ('message' in options) {
            return {
                model: options.model,
                messages: [
                    {
                        role: 'user',
                        content: options.message
                    }
                ],
                temperature: options.temperature ?? 0.7,
                stream: false,
                options: {
                    num_predict: options.maxTokens ?? 2000
                }
            };
        }

        return {
            model: options.model,
            messages: [
                {
                    role: 'user',
                    content: options.prompt
                }
            ],
            stream: false
        };
    }

    private normalizeBaseUrl(baseUrl: string): string {
        return baseUrl.trim().replace(/\/+$/, '');
    }
}
