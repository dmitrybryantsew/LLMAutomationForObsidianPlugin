function sanitizeFilename(input: string, separator: string = ' '): string {
  return input
    .replace(/[<>:"/\\|?*\[\]]/g, '') // Removes invalid filename characters including square brackets
    .replace(/\s+/g, separator) 
    .slice(0, 100);
}
    // Add helper method for metadata sanitization
function sanitizeForMetadata(text: string): string {
        // Replace problematic characters for YAML
        return text
          .replace(/"/g, '\\"')  // Escape quotes
          .replace(/:/g, '\\:')  // Escape colons
          .replace(/\n/g, ' ')   // Remove newlines
          .replace(/\r/g, ' ')   // Remove carriage returns
          .replace(/\t/g, ' ')   // Remove tabs
          .trim();
      }
      function chunkTranscriptBySentences(transcript: string, minWords: number = 5500, maxWords: number = 7000): string[] {
        // Split by sentence-ending punctuation followed by space or newline
        const sentences = transcript.match(/[^.!?]+[.!?]+(\s|$)/g) || [];
        
        const chunks: string[] = [];
        let currentChunk: string[] = [];
        let wordCount = 0;
        
        for (const sentence of sentences) {
          const sentenceWordCount = sentence.split(/\s+/).length;
          
          // If adding this sentence would exceed maxWords and we already have content,
          // finish the current chunk
          if (wordCount + sentenceWordCount > maxWords && wordCount >= minWords) {
            chunks.push(currentChunk.join(''));
            currentChunk = [];
            wordCount = 0;
          }
          
          currentChunk.push(sentence);
          wordCount += sentenceWordCount;
        }
        
        // Add the last chunk if there are remaining sentences
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join(''));
        }
        
        return chunks;
      }
      function chunkTranscript(transcript: string, minWords: number = 5500, maxWords: number = 7000): string[] {
        const words = transcript.split(/\s+/);
        const totalWords = words.length;
        
        // Calculate optimal chunk size to avoid small final chunk
        let chunkSize = maxWords;
        const estimatedChunks = Math.ceil(totalWords / maxWords);
        const lastChunkSize = totalWords - (estimatedChunks - 1) * maxWords;
        
        // If last chunk would be too small (less than minWords), redistribute
        if (lastChunkSize < minWords && estimatedChunks > 1) {
          // Recalculate chunk size to distribute words more evenly
          chunkSize = Math.ceil(totalWords / (estimatedChunks - 1));
          // If new chunk size is too large, just use the original maxWords
          if (chunkSize > maxWords * 1.3) {
            chunkSize = maxWords;
          }
        }
        
        // Create chunks based on calculated size
        const chunks: string[] = [];
        let currentChunk: string[] = [];
        let wordCount = 0;
        
        for (const word of words) {
          currentChunk.push(word);
          wordCount++;
          
          if (wordCount >= chunkSize) {
            chunks.push(currentChunk.join(' '));
            currentChunk = [];
            wordCount = 0;
          }
        }
        
        // Add the last chunk if there are remaining words
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join(' '));
        }
        
        return chunks;
      }

export {chunkTranscript};
export { sanitizeFilename };
export { sanitizeForMetadata };
export { chunkTranscriptBySentences };
