/**
 * DebugLogger Utility
 * Centralized debug logging with structured output and data sanitization
 */

export interface TimingInfo {
    startTime: number;
    endTime: number;
    elapsed: number;
}

export interface DebugContext {
    [key: string]: any;
}

/**
 * DebugLogger class for structured debug logging
 * Only logs when debug mode is enabled to minimize overhead
 */
export class DebugLogger {
    private enabled: boolean;
    private prefix: string;

    constructor(enabled: boolean, prefix: string = 'DEBUG') {
        this.enabled = enabled;
        this.prefix = prefix;
    }

    /**
     * Check if debug logging is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Enable or disable debug logging
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * Log a general debug message
     */
    log(message: string, data?: DebugContext): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        console.log(`[${this.prefix}] [${timestamp}] ${message}`);
        
        if (data) {
            const sanitizedData = this.sanitize(data);
            console.log(sanitizedData);
        }
    }

    /**
     * Log an API request
     */
    logRequest(url: string, method: string, headers: Record<string, string>, body: any): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        console.log(`[${this.prefix}] [${timestamp}] [REQUEST] ${method} ${url}`);
        
        const sanitizedHeaders = this.sanitizeHeaders(headers);
        const sanitizedBody = this.truncate(body);
        
        console.log('  Headers:', sanitizedHeaders);
        console.log('  Body:', sanitizedBody);
    }

    /**
     * Log an API response
     */
    logResponse(status: number, headers: Record<string, string>, body: any, timing: TimingInfo): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        console.log(`[${this.prefix}] [${timestamp}] [RESPONSE] Status: ${status}`);
        
        console.log('  Headers:', headers);
        console.log('  Body:', this.truncate(body));
        console.log('  Timing:', this.formatTiming(timing));
    }

    /**
     * Log an error with full context
     */
    logError(error: Error, context?: DebugContext): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        console.error(`[${this.prefix}] [${timestamp}] [ERROR] ${error.message}`);
        
        if (error.stack) {
            console.error('  Stack Trace:', error.stack);
        }
        
        if (context) {
            const sanitizedContext = this.sanitize(context);
            console.error('  Context:', sanitizedContext);
        }
    }

    /**
     * Log operation start
     */
    logStart(operation: string, data?: DebugContext): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        console.log(`[${this.prefix}] [${timestamp}] [START] ${operation}`);
        
        if (data) {
            console.log('  Data:', this.sanitize(data));
        }
    }

    /**
     * Log operation completion
     */
    logComplete(operation: string, timing: TimingInfo, data?: DebugContext): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        console.log(`[${this.prefix}] [${timestamp}] [COMPLETE] ${operation}`);
        console.log('  Timing:', this.formatTiming(timing));
        
        if (data) {
            console.log('  Result:', this.sanitize(data));
        }
    }

    /**
     * Log retry attempt
     */
    logRetry(attempt: number, maxRetries: number, delay: number, error?: Error): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        console.log(`[${this.prefix}] [${timestamp}] [RETRY] Attempt ${attempt}/${maxRetries}`);
        console.log('  Delay:', `${delay}ms`);
        
        if (error) {
            console.log('  Error:', error.message);
        }
    }

    /**
     * Log timeout
     */
    logTimeout(timeout: number, attempt: number, maxRetries: number): void {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        console.warn(`[${this.prefix}] [${timestamp}] [TIMEOUT] Request timeout`);
        console.warn('  Timeout:', `${timeout}ms`);
        console.warn('  Attempt:', `${attempt}/${maxRetries}`);
    }

    /**
     * Sanitize data to remove sensitive information
     */
    private sanitize(data: any): any {
        if (!data) return data;

        // Handle arrays
        if (Array.isArray(data)) {
            return data.map(item => this.sanitize(item));
        }

        // Handle objects
        if (typeof data === 'object') {
            const sanitized: any = {};
            for (const key in data) {
                if (data.hasOwnProperty(key)) {
                    sanitized[key] = this.sanitizeValue(key, data[key]);
                }
            }
            return sanitized;
        }

        // Handle primitives
        return data;
    }

    /**
     * Sanitize a single value based on key name
     */
    private sanitizeValue(key: string, value: any): any {
        const lowerKey = key.toLowerCase();
        
        // Check for sensitive keys
        if (lowerKey.includes('apikey') || 
            lowerKey.includes('api_key') || 
            lowerKey.includes('password') ||
            lowerKey.includes('token') ||
            lowerKey.includes('secret')) {
            return this.maskSensitiveValue(value);
        }

        // Recursively sanitize objects and arrays
        if (typeof value === 'object' && value !== null) {
            return this.sanitize(value);
        }

        return value;
    }

    /**
     * Mask sensitive values
     */
    private maskSensitiveValue(value: any): string {
        if (typeof value !== 'string') return '***';
        
        if (value.length <= 8) {
            return '***';
        }
        
        // Show first 3 and last 3 characters
        return `${value.substring(0, 3)}***${value.substring(value.length - 3)}`;
    }

    /**
     * Sanitize headers specifically
     */
    private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
        const sanitized: Record<string, string> = {};
        
        for (const key in headers) {
            if (headers.hasOwnProperty(key)) {
                const lowerKey = key.toLowerCase();
                
                // Mask authorization headers
                if (lowerKey === 'authorization' || lowerKey === 'cookie') {
                    sanitized[key] = '***';
                } else {
                    sanitized[key] = headers[key];
                }
            }
        }
        
        return sanitized;
    }

    /**
     * Truncate long content
     */
    private truncate(data: any, maxLength: number = 500): any {
        if (!data) return data;
        
        // Don't truncate numbers or booleans
        if (typeof data === 'number' || typeof data === 'boolean') {
            return data;
        }

        // Truncate strings
        if (typeof data === 'string') {
            if (data.length > maxLength) {
                return data.substring(0, maxLength) + '...';
            }
            return data;
        }

        // Recursively truncate objects and arrays
        if (typeof data === 'object') {
            if (Array.isArray(data)) {
                return data.map(item => this.truncate(item, maxLength));
            }
            
            const truncated: any = {};
            for (const key in data) {
                if (data.hasOwnProperty(key)) {
                    truncated[key] = this.truncate(data[key], maxLength);
                }
            }
            return truncated;
        }

        return data;
    }

    /**
     * Format timing information
     */
    private formatTiming(timing: TimingInfo): string {
        return `${timing.elapsed.toFixed(2)}ms`;
    }

    /**
     * Create timing info from start time
     */
    static createTiming(startTime: number): TimingInfo {
        const endTime = Date.now();
        return {
            startTime,
            endTime,
            elapsed: endTime - startTime
        };
    }
}
