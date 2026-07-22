function sanitizeFilename(input: string, separator: string = ' '): string {
  return input
    .replace(/[<>:"/\\|?*\[\]#]/g, '') // Removes invalid filename characters including # (breaks Obsidian wikilinks)
    .replace(/\s+/g, separator) 
    .slice(0, 100);
}

/**
 * Serializes a JS value into a valid YAML scalar for Obsidian frontmatter.
 * - Arrays become YAML flow sequence [a, b, c] (Obsidian's preferred format for tags)
 * - Strings with special chars are single-quoted (internal ' doubled to '')
 * - Numbers/booleans left as-is; null/undefined becomes empty
 */
function yamlValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    const items = value.map((v: unknown) => yamlValue(v));
    return `[${items.join(', ')}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  const str = String(value);
  const hasSpecial = str === '' || str === 'true' || str === 'false' || str === 'null'
    || /["\u003a\[\]{}#&*!|>'%@`,]/.test(str)
    || /[\x0a\x0d\x09]/.test(str)
    || /^\d/.test(str);
  if (!hasSpecial) {
    return str;
  }
  // Single-quoted YAML scalar — internal ' doubled to ''
  const escaped = str.replace(/'/g, "''");
  return `'${escaped}'`;
}

// Deprecated: sanitizeForMetadata is kept for backward compatibility but
// is now a no-op.  Use yamlValue() for proper YAML frontmatter serialization.
// The old implementation backslash-escaped " and : which produced invalid YAML.
function sanitizeForMetadata(text: string): string {
  return text;
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
export { yamlValue };
export { chunkTranscriptBySentences };
