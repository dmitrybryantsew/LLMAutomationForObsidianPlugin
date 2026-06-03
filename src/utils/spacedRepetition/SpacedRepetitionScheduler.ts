import { QuestionReviewState, ReviewGrade, ReviewScheduleState, ScheduledReviewResult } from '../../types/spacedRepetition';

const ALGORITHM_NAME = 'mnemosyne_like_v1';
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;

export interface SchedulerOptions {
  gradeZeroReaskDelay: number;
}

export class SpacedRepetitionScheduler {
  private options: SchedulerOptions;

  constructor(options: SchedulerOptions) {
    this.options = options;
  }

  scheduleReview(previousState: QuestionReviewState | null, grade: ReviewGrade, now: Date = new Date()): ScheduledReviewResult {
    const previousSchedule = previousState?.schedule ?? this.createInitialSchedule();
    const nextSchedule: ReviewScheduleState = {
      ...previousSchedule,
      algorithm: previousSchedule.algorithm || ALGORITHM_NAME,
      lastGrade: grade,
    };

    if (grade === 0) {
      nextSchedule.lapseCount += 1;
      nextSchedule.duePosition = 0;

      return {
        nextRepeatAt: now.toISOString(),
        shouldReask: true,
        reaskAfterCount: Math.max(0, this.options.gradeZeroReaskDelay),
        schedule: nextSchedule,
      };
    }

    const intervalDays = this.calculateIntervalDays(previousSchedule, grade);
    nextSchedule.intervalDays = intervalDays;
    nextSchedule.ease = this.calculateEase(previousSchedule.ease, grade);
    nextSchedule.repetitionCount += 1;
    nextSchedule.duePosition = null;

    return {
      nextRepeatAt: this.addDays(now, intervalDays).toISOString(),
      shouldReask: false,
      reaskAfterCount: 0,
      schedule: nextSchedule,
    };
  }

  createInitialState(now: Date = new Date()): QuestionReviewState {
    return {
      nextRepeatAt: now.toISOString(),
      shouldReask: false,
      reaskAfterCount: 0,
      lastReviewedAt: null,
      schedule: this.createInitialSchedule(),
    };
  }

  isDue(state: Pick<QuestionReviewState, 'nextRepeatAt' | 'shouldReask'>, now: Date = new Date()): boolean {
    return state.shouldReask || new Date(state.nextRepeatAt).getTime() <= now.getTime();
  }

  decrementReaskCounter(state: QuestionReviewState): QuestionReviewState {
    if (!state.shouldReask || state.reaskAfterCount <= 0) {
      return state;
    }

    return {
      ...state,
      reaskAfterCount: state.reaskAfterCount - 1,
    };
  }

  private createInitialSchedule(): ReviewScheduleState {
    return {
      algorithm: ALGORITHM_NAME,
      intervalDays: 0,
      ease: 2.5,
      repetitionCount: 0,
      lapseCount: 0,
      lastGrade: null,
      duePosition: null,
    };
  }

  private calculateIntervalDays(previousSchedule: ReviewScheduleState, grade: Exclude<ReviewGrade, 0>): number {
    if (previousSchedule.repetitionCount === 0 || previousSchedule.intervalDays <= 0) {
      switch (grade) {
        case 1:
        case 2:
          return 1;
        case 3:
          return 3;
        case 4:
          return 5;
      }
    }

    switch (grade) {
      case 1:
        return 1;
      case 2:
        return Math.max(1, previousSchedule.intervalDays * 1.2);
      case 3:
        return Math.max(2, previousSchedule.intervalDays * previousSchedule.ease);
      case 4:
        return Math.max(3, previousSchedule.intervalDays * (previousSchedule.ease + 0.35));
    }
  }

  private calculateEase(previousEase: number, grade: Exclude<ReviewGrade, 0>): number {
    let nextEase = previousEase;

    if (grade === 1) {
      nextEase -= 0.2;
    } else if (grade === 2) {
      nextEase -= 0.05;
    } else if (grade === 4) {
      nextEase += 0.1;
    }

    return Math.min(MAX_EASE, Math.max(MIN_EASE, nextEase));
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + Math.floor(days));
    return next;
  }
}
