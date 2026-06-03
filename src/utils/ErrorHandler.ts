import { Notice } from "obsidian";

type ErrorCategory =
  | "FILE_OPERATION"
  | "API_ERROR"
  | "NETWORK_ERROR"
  | "VALIDATION_ERROR"
  | "HISTORY_ERROR"
  | "UNKNOWN_ERROR"
  | "TAG_MANAGER_INIT"
  | "API_GENERATE_ERROR"
  | "API_FETCH_ERROR"
  | "ARTICLE_PROCESSING_ERROR"
  | "VIEW_ACTIVATION_ERROR"
  | "DATABASE_ERROR";

interface ErrorDetails {
  message: string;
  category: ErrorCategory;
  context?: Record<string, unknown>;
  originalError?: unknown;
}

class ErrorHandler {
  private static consoleLog: boolean = true;
  private static debugMode: boolean = false;

  /**
   * Enable or disable debug mode for error handling
   */
  static setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  static handleError(error: unknown, category: ErrorCategory, context?: Record<string, unknown>) {
    let errorDetails: ErrorDetails;

    if (error instanceof Error) {
      errorDetails = {
        message: error.message,
        category,
        context,
        originalError: error
      };
    } else if (typeof error === 'string') {
      errorDetails = {
        message: error,
        category,
        context
      };
    } else {
      errorDetails = {
        message: 'An unknown error occurred',
        category: "UNKNOWN_ERROR",
        context,
        originalError: error
      };
    }

    this.processError(errorDetails);
  }

  private static processError(details: ErrorDetails) {
    // Log error if logging is enabled
    if (this.consoleLog) {
      this.logError(details);
    }
    
    // Log error if debug mode is enabled (enhanced logging)
    if (this.debugMode) {
      this.logDebugError(details);
    }

    // Show notification with appropriate message
    this.showNotification(details);

    // Additional processing based on category
    switch (details.category) {
      case "API_ERROR":
        this.handleApiError(details);
        break;
      case "NETWORK_ERROR":
        this.handleNetworkError(details);
        break;
      case "FILE_OPERATION":
        this.handleFileError(details);
        break;
      // Add more specific handlers as needed
    }
  }

  private static logError(details: ErrorDetails) {
    console.group(`Error: ${details.category}`);
    console.error('Message:', details.message);
    if (details.context) {
      console.error('Context:', details.context);
    }
    if (details.originalError) {
      console.error('Original Error:', details.originalError);
    }
    console.groupEnd();
  }

  private static logDebugError(details: ErrorDetails) {
    const timestamp = new Date().toISOString();
    console.group(`[DEBUG] [${timestamp}] [ERROR] ${details.category}`);
    console.error('Message:', details.message);
    
    if (details.context) {
      console.error('Context:', details.context);
    }
    
    if (details.originalError) {
      if (details.originalError instanceof Error) {
        console.error('Stack Trace:', details.originalError.stack);
      } else {
        console.error('Original Error:', details.originalError);
      }
    }
    
    console.groupEnd();
  }

  private static showNotification(details: ErrorDetails) {
    const baseMessage = this.getBaseMessage(details.category);
    const specificMessage = details.message;
    new Notice(`${baseMessage}: ${specificMessage}`);
  }

  private static getBaseMessage(category: ErrorCategory): string {
    switch (category) {
      case "FILE_OPERATION":
        return "File Operation Failed";
      case "API_ERROR":
        return "API Error";
      case "NETWORK_ERROR":
        return "Network Error";
      case "VALIDATION_ERROR":
        return "Validation Error";
      case "HISTORY_ERROR":
        return "History Operation Failed";
      case "TAG_MANAGER_INIT":
        return "Tag manager initialisatioin Failed";
      case "API_GENERATE_ERROR":
        return "Failed to generate answer via llm";
      case "API_FETCH_ERROR":
        return "failed to get article text";
      case "ARTICLE_PROCESSING_ERROR":
        return "failed to process article";
      case "VIEW_ACTIVATION_ERROR":
        return "failed to activate view";
      case "DATABASE_ERROR":
        return "Database Operation Failed";
      case "UNKNOWN_ERROR":
        return "An Error Occurred";
    }
  }

  private static handleApiError(details: ErrorDetails) {
    // Handle API specific errors (e.g., retry logic, refresh tokens, etc.)
    if (details.context?.statusCode === 401) {
      // Handle authentication error
      new Notice("Authentication failed. Please check your credentials.");
    }
  }

  private static handleNetworkError(details: ErrorDetails) {
    // Handle network specific errors (e.g., retry logic, offline mode, etc.)
    if (details.message.includes("Failed to fetch")) {
      new Notice("Network error. Please check your internet connection.");
    }
  }

  private static handleFileError(details: ErrorDetails) {
    // Handle file operation specific errors
    if (details.message.includes("Permission denied")) {
      new Notice("Permission error. Please check file permissions.");
    }
  }

  // Utility method to check if an error is a specific type
  static isNetworkError(error: unknown): boolean {
    return error instanceof Error && 
           (error.message.includes("Failed to fetch") || 
            error.message.includes("Network request failed"));
  }

  // Enable/disable console logging
  static setLogging(enabled: boolean) {
    this.consoleLog = enabled;
  }

  // Helper method to create context
  static createContext(contextData: Record<string, unknown>): Record<string, unknown> {
    return {
      timestamp: new Date().toISOString(),
      ...contextData
    };
  }
}

export {ErrorHandler}