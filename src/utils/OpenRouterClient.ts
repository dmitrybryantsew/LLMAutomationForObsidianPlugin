/**
 * OpenRouter API Client
 * Handles all OpenRouter API interactions directly from the plugin
 * 
 * This client provides a clean TypeScript interface to the OpenRouter API,
 * handling authentication, error handling, retry logic, and response formatting.
 */

import {
    TextGenerationOptions,
    VisionAnalysisOptions,
    ImageGenerationOptions,
    GenerationResponse,
    AnalysisResponse,
    ImageResponse,
    OpenRouterError,
    OpenRouterConfig,
    OpenRouterRequestPayload,
    OpenRouterApiResponse,
    FileContext
} from '../types/openrouter';

/**
 * OpenRouter API Client
 */
export class OpenRouterClient {
    private apiKey: string;
    private baseUrl: string;
    private referer: string;
    private timeout: number;
    private maxRetries: number;

    constructor(config: OpenRouterConfig) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1/chat/completions";
        this.referer = config.referer || "https://obsidian.md";
        this.timeout = config.timeout || 60000; // 60 seconds default
        this.maxRetries = config.maxRetries || 3;
    }

    /**
     * Generate text using OpenRouter API
     * 
     * @param options - Text generation options
     * @returns Generated text response with metadata
     * @throws OpenRouterError if API request fails
     */
    async generateText(options: TextGenerationOptions): Promise<GenerationResponse> {
        const startTime = Date.now();
        const requestTime = new Date().toISOString();

        // Build message content
        const messageContent = this.buildMessageContent(
            options.message,
            options.files,
            options.language
        );

        // Prepare request payload
        const payload: OpenRouterRequestPayload = {
            model: options.model,
            messages: [
                {
                    role: "user",
                    content: messageContent
                }
            ],
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 2000
        };

        // Prepare headers
        const headers = {
            "Authorization": `Bearer ${this.apiKey}`,
            "HTTP-Referer": this.referer,
            "Content-Type": "application/json"
        };

        try {
            // Make API request with retry logic
            const response = await this.fetchWithRetry(
                this.baseUrl,
                {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload)
                }
            );

            // Parse response
            const result: OpenRouterApiResponse = await response.json();

            // Extract content
            const content = result.choices[0].message.content;

            // Calculate elapsed time
            const completionTime = new Date().toISOString();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

            // Build response
            return {
                output: content,
                metadata: {
                    provider_name: result.provider?.name || "OpenRouter",
                    actual_model: result.model,
                    request_time: requestTime,
                    completion_time: completionTime,
                    elapsed_time: elapsed
                }
            };
        } catch (error) {
            if (error instanceof OpenRouterError) {
                throw error;
            }
            throw new OpenRouterError(
                `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                undefined,
                { type: 'network_error' }
            );
        }
    }

    /**
     * Analyze image using OpenRouter Vision API
     * 
     * @param options - Vision analysis options
     * @returns Analysis response with metadata
     * @throws OpenRouterError if API request fails
     */
    async analyzeImage(options: VisionAnalysisOptions): Promise<AnalysisResponse> {
        const startTime = Date.now();
        const requestTime = new Date().toISOString();

        // Prepare request payload for vision
        const payload: OpenRouterRequestPayload = {
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
        const headers = {
            "Authorization": `Bearer ${this.apiKey}`,
            "HTTP-Referer": this.referer,
            "Content-Type": "application/json"
        };

        try {
            // Make API request with retry logic
            const response = await this.fetchWithRetry(
                this.baseUrl,
                {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload)
                }
            );

            // Parse response
            const result: OpenRouterApiResponse = await response.json();

            // Extract content
            const content = result.choices[0].message.content;

            // Calculate elapsed time
            const completionTime = new Date().toISOString();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

            // Build response
            return {
                analysis: content,
                metadata: {
                    provider_name: result.provider?.name || "OpenRouter",
                    actual_model: result.model,
                    request_time: requestTime,
                    completion_time: completionTime,
                    elapsed_time: elapsed
                }
            };
        } catch (error) {
            if (error instanceof OpenRouterError) {
                throw error;
            }
            throw new OpenRouterError(
                `Vision API network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                undefined,
                { type: 'network_error' }
            );
        }
    }

    /**
     * Generate image (if supported by OpenRouter)
     * 
     * Note: OpenRouter may not support image generation directly.
     * This method is included for future compatibility.
     * 
     * @param options - Image generation options
     * @returns Image generation response
     * @throws OpenRouterError if not supported or request fails
     */
    async generateImage(options: ImageGenerationOptions): Promise<ImageResponse> {
        const startTime = Date.now();

        // OpenRouter doesn't support image generation directly
        // This method is included for future compatibility
        throw new OpenRouterError(
            "Image generation is not directly supported by OpenRouter. " +
            "Please use a dedicated image generation service.",
            undefined,
            { type: 'not_supported' }
        );
    }

    /**
     * Update API key
     * 
     * @param apiKey - New API key
     */
    updateApiKey(apiKey: string): void {
        this.apiKey = apiKey;
    }

    /**
     * Build message content from options
     * 
     * @param message - Main message
     * @param files - Optional file contexts
     * @param language - Optional language specification
     * @returns Formatted message content
     */
    private buildMessageContent(
        message: string,
        files?: FileContext[],
        language?: string
    ): string {
        let content = message;

        // Add file contexts if provided
        if (files && files.length > 0) {
            const fileContents = files
                .filter(f => f.content)
                .map(f => `// ${f.name} contents:\n${f.content}\n`)
                .join("\n");

            if (fileContents) {
                content += `\n\nContext Files:\n${fileContents}`;
            }
        }

        // Add language specification if provided
        if (language) {
            content += `\n\nPlease answer in ${language}`;
        }

        return content;
    }

    /**
     * Fetch with retry logic and timeout
     * 
     * @param url - Request URL
     * @param options - Fetch options
     * @returns Response from API
     * @throws OpenRouterError if all retries fail
     */
    private async fetchWithRetry(
        url: string,
        options: RequestInit
    ): Promise<Response> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                // Create abort controller for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);

                // Make request
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });

                // Clear timeout
                clearTimeout(timeoutId);

                // Check if response is OK
                if (!response.ok) {
                    // Don't retry on client errors (4xx)
                    if (response.status >= 400 && response.status < 500) {
                        const errorData = await this.parseErrorResponse(response);
                        throw new OpenRouterError(
                            errorData.message || `API request failed with status ${response.status}`,
                            response.status,
                            errorData
                        );
                    }

                    // Retry on server errors (5xx)
                    if (attempt < this.maxRetries - 1) {
                        continue;
                    }

                    // Last attempt failed
                    const errorData = await this.parseErrorResponse(response);
                    throw new OpenRouterError(
                        errorData.message || `API request failed with status ${response.status}`,
                        response.status,
                        errorData
                    );
                }

                return response;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                // Don't retry on abort (timeout)
                if (lastError.name === 'AbortError') {
                    throw new OpenRouterError(
                        `Request timeout after ${this.timeout}ms`,
                        undefined,
                        { type: 'timeout' }
                    );
                }

                // Don't retry on last attempt
                if (attempt === this.maxRetries - 1) {
                    break;
                }

                // Exponential backoff
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // All retries failed
        throw new OpenRouterError(
            `Request failed after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
            undefined,
            { type: 'retry_exhausted' }
        );
    }

    /**
     * Parse error response from API
     * 
     * @param response - Failed response
     * @returns Parsed error details
     */
    private async parseErrorResponse(response: Response): Promise<any> {
        try {
            const data = await response.json();
            return data.error || data;
        } catch {
            return {
                message: response.statusText || 'Unknown error',
                type: 'api_error'
            };
        }
    }
}

/**
 * Factory function to create OpenRouter client
 * 
 * @param apiKey - OpenRouter API key
 * @param config - Optional configuration
 * @returns Configured OpenRouter client
 */
export function createOpenRouterClient(
    apiKey: string,
    config?: Partial<OpenRouterConfig>
): OpenRouterClient {
    return new OpenRouterClient({
        apiKey,
        ...config
    });
}