/**
 * Base LLM Client
 * Abstract base class for LLM provider implementations
 */

import {
    ProviderConfig,
    ProviderRequestPayload,
    ProviderApiResponse,
    ProviderMetadata
} from '../types/providers';
import {
    TextGenerationOptions,
    VisionAnalysisOptions,
    GenerationResponse,
    AnalysisResponse,
    OpenRouterError,
    FileContext
} from '../types/openrouter';
import { DebugLogger } from './DebugLogger';
import { requestUrl, RequestUrlParam } from 'obsidian';

/**
 * Abstract base class for LLM provider clients
 */
export abstract class BaseLLMClient {
    protected config: ProviderConfig;
    protected timeout: number;
    protected maxRetries: number;
    protected debug: DebugLogger;

    constructor(config: ProviderConfig, debugMode: boolean = false, debugPrefix: string = 'BaseLLM') {
        this.config = config;
        this.timeout = config.timeout || 60000;
        this.maxRetries = config.maxRetries || 3;
        this.debug = new DebugLogger(debugMode, debugPrefix);
    }

    /**
     * Generate text using the provider's API
     * 
     * @param options - Text generation options
     * @returns Generated text response with metadata
     * @throws OpenRouterError if API request fails
     */
    abstract generateText(options: TextGenerationOptions): Promise<GenerationResponse>;

    /**
     * Analyze image using the provider's vision API
     * 
     * @param options - Vision analysis options
     * @returns Analysis response with metadata
     * @throws OpenRouterError if API request fails
     */
    abstract analyzeImage(options: VisionAnalysisOptions): Promise<AnalysisResponse>;

    /**
     * Update API key
     * 
     * @param apiKey - New API key
     */
    updateApiKey(apiKey: string): void {
        this.config.apiKey = apiKey;
    }

    /**
     * Build message content from options
     * 
     * @param message - Main message
     * @param files - Optional file contexts
     * @param language - Optional language specification
     * @returns Formatted message content
     */
    protected buildMessageContent(
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
     * Fetch with retry logic and timeout using Obsidian's requestUrl API
     * This bypasses CORS restrictions by routing through Electron's Node.js backend
     *
     * @param url - Request URL
     * @param options - Fetch options
     * @returns Response from API (polyfilled to match standard fetch API)
     * @throws OpenRouterError if all retries fail
     */
    protected async fetchWithRetry(
        url: string,
        options: RequestInit
    ): Promise<Response> {
        let lastError: Error | null = null;
        const startTime = Date.now();

        this.debug.log('Starting fetch with retry', {
            url,
            method: options.method,
            timeout: this.timeout,
            maxRetries: this.maxRetries
        });

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                this.debug.log(`Attempt ${attempt + 1}/${this.maxRetries}`, {
                    url,
                    timestamp: new Date().toISOString()
                });

                // Log request details
                const headers = options.headers as Record<string, string> || {};
                const body = options.body ? JSON.parse(options.body as string) : undefined;
                this.debug.logRequest(url, options.method || 'GET', headers, body);

                // Convert fetch options to Obsidian requestUrl options
                const requestParams: RequestUrlParam = {
                    url: url,
                    method: options.method || 'GET',
                    headers: headers,
                    // Convert body to string if needed (requestUrl expects string | ArrayBuffer | undefined)
                    body: typeof options.body === 'string' ? options.body :
                            options.body instanceof ArrayBuffer ? options.body :
                            options.body instanceof Blob ? await (options.body as Blob).arrayBuffer() :
                            options.body instanceof ReadableStream ? undefined : // Can't convert ReadableStream
                            undefined,
                    throw: false // Don't throw errors on 4xx/5xx, let us handle status codes
                };

                // Use Obsidian's requestUrl API (bypasses CORS), with a local timeout guard.
                const response = await Promise.race([
                    requestUrl(requestParams),
                    new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(new OpenRouterError(
                                `Request timeout after ${this.timeout}ms`,
                                undefined,
                                { type: 'timeout' }
                            ));
                        }, this.timeout);
                    })
                ]);

                // Check if response is OK
                const isOk = response.status >= 200 && response.status < 300;
                if (!isOk) {
                    // Don't retry on client errors (4xx)
                    if (response.status >= 400 && response.status < 500) {
                        const errorData = this.parseErrorResponseData(response);
                        this.debug.logError(new Error(`Client error ${response.status}`), {
                            url,
                            status: response.status,
                            errorData
                        });
                        throw new OpenRouterError(
                            errorData.message || `API request failed with status ${response.status}`,
                            response.status,
                            errorData
                        );
                    }

                    // Retry on server errors (5xx)
                    if (attempt < this.maxRetries - 1) {
                        this.debug.logRetry(attempt + 1, this.maxRetries, Math.pow(2, attempt) * 1000, lastError || undefined);
                        continue;
                    }

                    // Last attempt failed
                    const errorData = this.parseErrorResponseData(response);
                    this.debug.logError(new Error(`Server error ${response.status}`), {
                        url,
                        status: response.status,
                        errorData,
                        attempts: attempt + 1
                    });
                    throw new OpenRouterError(
                        errorData.message || `API request failed with status ${response.status}`,
                        response.status,
                        errorData
                    );
                }

                // Log successful response
                const timing = DebugLogger.createTiming(startTime);
                const responseHeaders = response.headers || {};
                
                // Try to parse response body for logging
                let responseBody: any;
                try {
                    const contentType = responseHeaders['content-type'];
                    if (contentType && contentType.includes('application/json')) {
                        responseBody = response.json;
                    }
                } catch (e) {
                    responseBody = '[Unable to parse response body]';
                }
                
                this.debug.logResponse(response.status, responseHeaders, responseBody, timing);

                // Create polyfill response to match standard fetch API
                const headersObj: Record<string, string> = {};
                if (response.headers) {
                    Object.entries(response.headers).forEach(([key, value]) => {
                        headersObj[key] = String(value);
                    });
                }
                
                const polyfillResponse = {
                    ok: isOk,
                    status: response.status,
                    statusText: response.status.toString(),
                    headers: new Headers(headersObj),
                    // requestUrl parses JSON automatically, so we wrap it back in a promise
                    json: async () => response.json,
                    text: async () => response.text
                } as unknown as Response;

                return polyfillResponse;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                // Don't retry on OpenRouterError (API errors that shouldn't be retried)
                if (lastError instanceof OpenRouterError) {
                    this.debug.logError(lastError, {
                        url,
                        attempts: attempt + 1,
                        reason: 'OpenRouterError - not retrying'
                    });
                    throw lastError;
                }

                // Don't retry on last attempt
                if (attempt === this.maxRetries - 1) {
                    this.debug.logError(lastError, {
                        url,
                        attempts: attempt + 1,
                        reason: 'Max retries exhausted'
                    });
                    break;
                }

                // Exponential backoff
                const delay = Math.pow(2, attempt) * 1000;
                this.debug.logRetry(attempt + 1, this.maxRetries, delay, lastError);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // All retries failed
        const finalError = new OpenRouterError(
            `Request failed after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
            undefined,
            { type: 'retry_exhausted' }
        );
        this.debug.logError(finalError, {
            url,
            totalAttempts: this.maxRetries,
            lastError: lastError?.message
        });
        throw finalError;
    }

    /**
     * Parse error response from API (for requestUrl response)
     *
     * @param response - Failed response from requestUrl
     * @returns Parsed error details
     */
    protected async parseErrorResponse(response: Response): Promise<any> {
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
    protected parseErrorResponseData(response: any): any {
        try {
            if (response.json) {
                const data = response.json;
                return data.error || data;
            }
            return {
                message: 'Unknown error',
                type: 'api_error'
            };
        } catch {
            return {
                message: 'Unknown error',
                type: 'api_error'
            };
        }
    }

    /**
     * Extract provider metadata from API response
     * 
     * @param response - API response
     * @param startTime - Request start time
     * @returns Provider metadata
     */
    protected extractMetadata(
        response: ProviderApiResponse,
        startTime: number
    ): ProviderMetadata {
        const completionTime = new Date().toISOString();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

        return {
            provider_name: this.getProviderName(response),
            actual_model: response.model,
            request_time: new Date(startTime).toISOString(),
            completion_time: completionTime,
            elapsed_time: elapsed
        };
    }

    /**
     * Get provider name from response
     * Override in provider-specific implementations
     * 
     * @param response - API response
     * @returns Provider name
     */
    protected abstract getProviderName(response: ProviderApiResponse): string;

    /**
     * Build request headers
     * Override in provider-specific implementations
     * 
     * @returns Headers object
     */
    protected abstract buildHeaders(): Record<string, string>;

    /**
     * Build request payload
     * Override in provider-specific implementations
     * 
     * @param options - Generation options
     * @returns Request payload
     */
    protected abstract buildPayload(options: TextGenerationOptions | VisionAnalysisOptions): ProviderRequestPayload;
}

