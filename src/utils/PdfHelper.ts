/**
 * PdfHelper - PDF Text Extraction Utility
 * 
 * Provides functionality to extract text content from PDF files for use as context in LLM queries.
 * Uses pdfjs-dist for PDF parsing and supports worker configuration for Obsidian environment.
 */

import { App, TFile, Notice } from 'obsidian';

// Dynamic import for pdfjs-dist to handle cases where package is not installed
let pdfjsLib: any = null;
try {
    pdfjsLib = require('pdfjs-dist');
    // Set worker source for proper PDF.js operation
    if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
        const workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    }
} catch (error) {
    console.warn('pdfjs-dist not installed. PDF extraction will not work until npm install is run.');
}

export class PdfHelper {
    private app: App;
    private maxPages: number = 50; // Limit to prevent context overflow

    constructor(app: App) {
        this.app = app;
        this.checkPdfJsAvailability();
    }

    /**
     * Check if PDF.js is available and warn if not
     */
    private checkPdfJsAvailability(): void {
        if (!pdfjsLib) {
            new Notice('PDF.js library not installed. Please run "npm install" to enable PDF text extraction.');
        }
    }

    /**
     * Extract text content from a PDF file
     * @param file - The PDF file to extract text from
     * @returns Promise<string> - The extracted text content
     */
    async extractText(file: TFile): Promise<string> {
        // Check PDF.js availability
        this.checkPdfJsAvailability();

        // Validate file extension
        if (file.extension !== 'pdf') {
            throw new Error('File is not a PDF');
        }

        try {
            // Read PDF file as binary data
            const arrayBuffer = await this.app.vault.readBinary(file);

            // Load PDF document
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdfDocument = await loadingTask.promise;

            // Get total page count
            const totalPages = pdfDocument.numPages;
            const pagesToProcess = Math.min(totalPages, this.maxPages);

            // Extract text from each page
            const textItems: string[] = [];
            
            for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
                try {
                    const page = await pdfDocument.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    
                    // Join text items from the page
                    const pageText = textContent.items
                        .map((item: any) => item.str)
                        .join(' ');
                    
                    textItems.push(pageText);
                } catch (pageError) {
                    console.error(`Failed to extract text from page ${pageNum}:`, pageError);
                    // Continue with next page even if one fails
                }
            }

            // Combine all page text with newlines
            const extractedText = textItems.join('\n\n');

            // Clean up the extracted text
            const cleanedText = this.cleanText(extractedText);

            // Log warning if we limited the pages
            if (totalPages > this.maxPages) {
                new Notice(
                    `PDF has ${totalPages} pages. Only first ${this.maxPages} pages were extracted to prevent context overflow.`
                );
            }

            return cleanedText;

        } catch (error) {
            console.error('Failed to extract text from PDF:', error);
            throw new Error(
                `Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Clean extracted text by removing excessive whitespace
     * @param text - The text to clean
     * @returns Cleaned text
     */
    private cleanText(text: string): string {
        // Replace multiple whitespace with single space
        let cleaned = text.replace(/\s+/g, ' ');
        
        // Remove excessive newlines (more than 2 consecutive)
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
        
        // Trim leading/trailing whitespace
        cleaned = cleaned.trim();
        
        return cleaned;
    }

    /**
     * Set the maximum number of pages to extract
     * @param maxPages - Maximum number of pages to extract
     */
    setMaxPages(maxPages: number): void {
        if (maxPages > 0) {
            this.maxPages = maxPages;
        }
    }

    /**
     * Get the current maximum pages setting
     * @returns Current maximum pages
     */
    getMaxPages(): number {
        return this.maxPages;
    }
}
