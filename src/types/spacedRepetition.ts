export type ReviewGrade = 0 | 1 | 2 | 3 | 4;

export type QuestionType = 'multiple_choice' | 'typed_exact' | 'typed_llm_checked' | 'self_check';

export type AnswerCheckMode = 'self' | 'exact' | 'llm';

export type StudySetSourceType = 'manual' | 'tag' | 'folder' | 'links' | 'backlinks' | 'query';

export interface SpacedRepetitionSettings {
  enabled: boolean;
  databasePath: string;
  maxReviewCardsPerSession: number;
  newCardsPerDay: number;
  gradeZeroReaskDelay: number;
  includeLinkedNotesByDefault: boolean;
}

export interface ReviewScheduleState {
  algorithm: string;
  intervalDays: number;
  ease: number;
  repetitionCount: number;
  lapseCount: number;
  lastGrade: ReviewGrade | null;
  duePosition?: number | null;
}

export interface QuestionReviewState {
  questionId?: string;
  nextRepeatAt: string;
  shouldReask: boolean;
  reaskAfterCount: number;
  lastReviewedAt?: string | null;
  schedule: ReviewScheduleState;
}

export interface ScheduledReviewResult {
  nextRepeatAt: string;
  shouldReask: boolean;
  reaskAfterCount: number;
  schedule: ReviewScheduleState;
}

export interface ReviewRecordInput {
  questionId: string;
  grade: ReviewGrade;
  userAnswer?: string | null;
  checkerResult?: Record<string, unknown> | null;
  elapsedMs?: number | null;
}

export interface AnswerCheckerResult {
  isAcceptable: boolean;
  confidence: number;
  feedback: string;
  correctedAnswer?: string | null;
}

export interface SpacedRepetitionNoteRecord {
  id: string;
  notePath: string;
  noteTitle: string;
  contentHash?: string | null;
  tags: string[];
}

export interface SpacedRepetitionStudySetRecord {
  id: string;
  name: string;
  description?: string | null;
  sourceType: StudySetSourceType;
  sourceRule: Record<string, unknown>;
  tags: string[];
  enabled: boolean;
}

export interface SpacedRepetitionQuestionInput {
  noteId?: string | null;
  studySetId?: string | null;
  questionName?: string | null;
  questionText: string;
  questionType: QuestionType;
  answerText?: string | null;
  choices?: string[] | null;
  answerCheckMode: AnswerCheckMode;
  metadata?: Record<string, unknown>;
  nextRepeatAt?: string;
  enabled?: boolean;
}

export interface NoteChatRecord {
  id: string;
  noteId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface NoteChatMessageRecord {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}
