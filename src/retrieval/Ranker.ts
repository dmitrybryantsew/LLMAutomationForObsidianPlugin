import { SearchHit } from '../types/retrieval';

export interface RankerOptions {
  limit?: number;
  maxChunksPerFile?: number;
  maxChunksPerHeading?: number;
}

export class Ranker {
  select(hits: SearchHit[], options: RankerOptions = {}): SearchHit[] {
    const limit = options.limit ?? 10;
    const maxChunksPerFile = options.maxChunksPerFile ?? 2;
    const maxChunksPerHeading = options.maxChunksPerHeading ?? 1;
    const selected: SearchHit[] = [];
    const fileCounts = new Map<string, number>();
    const headingCounts = new Map<string, number>();

    for (const hit of hits) {
      const fileCount = fileCounts.get(hit.path) ?? 0;
      if (fileCount >= maxChunksPerFile) {
        continue;
      }

      const headingKey = `${hit.path}::${hit.headingPath.join('>')}`;
      const headingCount = headingCounts.get(headingKey) ?? 0;
      if (headingCount >= maxChunksPerHeading) {
        continue;
      }

      selected.push(hit);
      fileCounts.set(hit.path, fileCount + 1);
      headingCounts.set(headingKey, headingCount + 1);

      if (selected.length >= limit) {
        break;
      }
    }

    return selected;
  }
}
