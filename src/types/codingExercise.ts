export type CodingExerciseLanguage = 'csharp-linqpad';

export interface CodingExercise {
  title: string;
  concept: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  language: CodingExerciseLanguage;
  task: string;
  desiredOutput: string;
  starterCode: string;
  visibleTests: string[];
  hiddenTests: string[];
  hints: string[];
}

export interface LocalRunResult {
  success: boolean;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

export interface StudyAssistantExerciseEntry {
  id: string;
  namespace: string;
  difficulty: string;
  exerciseNumber: string;
  title: string;
  filePath: string;
}

export interface ImportedStudyAssistantExercise extends StudyAssistantExerciseEntry {
  description: string;
  requirements: string[];
  template: string;
  referenceSolution: string;
  hints: string[];
}
