import { describe, expect, it } from 'vitest';
import { SpacedRepetitionScheduler, shuffleReviewCards } from '../../src/utils/spacedRepetition/SpacedRepetitionScheduler';

describe('SpacedRepetitionScheduler', () => {
  const now = new Date('2026-06-03T08:00:00.000Z');

  it('schedules grade 0 as same-session reask', () => {
    const scheduler = new SpacedRepetitionScheduler({ gradeZeroReaskDelay: 3 });
    const result = scheduler.scheduleReview(scheduler.createInitialState(now), 0, now);

    expect(result.nextRepeatAt).toBe(now.toISOString());
    expect(result.shouldReask).toBe(true);
    expect(result.reaskAfterCount).toBe(3);
    expect(result.schedule.lapseCount).toBe(1);
    expect(result.schedule.repetitionCount).toBe(0);
  });

  it('schedules new remembered cards using initial intervals', () => {
    const scheduler = new SpacedRepetitionScheduler({ gradeZeroReaskDelay: 3 });
    const initial = scheduler.createInitialState(now);

    expect(scheduler.scheduleReview(initial, 1, now).schedule.intervalDays).toBe(1);
    expect(scheduler.scheduleReview(initial, 2, now).schedule.intervalDays).toBe(1);
    expect(scheduler.scheduleReview(initial, 3, now).schedule.intervalDays).toBe(3);
    expect(scheduler.scheduleReview(initial, 4, now).schedule.intervalDays).toBe(5);
  });

  it('schedules weak cards for later the same day', () => {
    const scheduler = new SpacedRepetitionScheduler({ gradeZeroReaskDelay: 3, sameDayReviewDelayMinutes: 180 });
    const result = scheduler.scheduleLaterToday(scheduler.createInitialState(now), now);

    expect(result.nextRepeatAt).toBe('2026-06-03T11:00:00.000Z');
    expect(result.shouldReask).toBe(false);
    expect(result.reaskAfterCount).toBe(0);
    expect(result.schedule.intervalDays).toBe(0);
    expect(result.schedule.lastGrade).toBe(1);
  });

  it('decrements reask counter without clearing reask flag', () => {
    const scheduler = new SpacedRepetitionScheduler({ gradeZeroReaskDelay: 3 });
    const reask = scheduler.scheduleReview(scheduler.createInitialState(now), 0, now);
    const state = {
      nextRepeatAt: reask.nextRepeatAt,
      shouldReask: reask.shouldReask,
      reaskAfterCount: reask.reaskAfterCount,
      schedule: reask.schedule,
    };

    const decremented = scheduler.decrementReaskCounter(state);

    expect(decremented.shouldReask).toBe(true);
    expect(decremented.reaskAfterCount).toBe(2);
  });

  it('clamps ease after repeated low grades', () => {
    const scheduler = new SpacedRepetitionScheduler({ gradeZeroReaskDelay: 3 });
    let state = scheduler.createInitialState(now);

    for (let i = 0; i < 20; i += 1) {
      const result = scheduler.scheduleReview(state, 1, now);
      state = {
        nextRepeatAt: result.nextRepeatAt,
        shouldReask: result.shouldReask,
        reaskAfterCount: result.reaskAfterCount,
        schedule: result.schedule,
      };
    }

    expect(state.schedule.ease).toBe(1.3);
  });

  it('shuffles review cards while prioritizing shouldReask cards at the start', () => {
    const cards = [
      { id: '1', questionText: 'Card 1', shouldReask: false },
      { id: '2', questionText: 'Card 2', shouldReask: true },
      { id: '3', questionText: 'Card 3', shouldReask: false },
      { id: '4', questionText: 'Card 4', shouldReask: false },
      { id: '5', questionText: 'Card 5', shouldReask: true },
    ];

    const sequence = [0.99, 0.0, 0.5];
    let idx = 0;
    const mockRng = () => sequence[idx++ % sequence.length];

    const shuffled = shuffleReviewCards(cards, mockRng);

    // Both shouldReask cards must be at the very front
    expect(shuffled.slice(0, 2).map((c) => c.shouldReask)).toEqual([true, true]);
    expect(shuffled.slice(0, 2).map((c) => c.id)).toEqual(['2', '5']);

    // Regular cards are present and shuffled
    expect(shuffled.slice(2).map((c) => c.shouldReask)).toEqual([false, false, false]);
    expect(shuffled).toHaveLength(5);
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(['1', '2', '3', '4', '5']));
  });

  it('handles empty cards array or all-reask cards gracefully', () => {
    expect(shuffleReviewCards([])).toEqual([]);

    const allReask = [{ id: '1', shouldReask: true }, { id: '2', shouldReask: true }];
    expect(shuffleReviewCards(allReask).map((c) => c.id)).toEqual(['1', '2']);
  });
});
