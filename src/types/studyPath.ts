export interface StudyPathPlan {
  title: string;
  audience: string;
  goal: string;
  prerequisites: string[];
  stages: StudyPathStage[];
  sourceNotes: string[];
}

export interface StudyPathStage {
  id: string;
  title: string;
  summary: string;
  outcomes: string[];
  topics: string[];
  practice: string[];
  checkpoints: string[];
  sourceHints: string[];
}

export interface StudyPathGenerationResult {
  plan: StudyPathPlan;
  markdownPath: string;
  canvasPath: string;
  sourceFileCount: number;
  estimatedContextTokens: number;
}
