export type ReminderSchedule = {
  visitAt: string;
  remindAt: string;
};

export class ReminderTimeError extends Error {
  constructor(public readonly code: 'too_soon' | 'too_far') {
    super(`Invalid reminder schedule: ${code}`);
  }
}

export function buildReminderSchedule(input: {
  visitTime: string;
  remindMinutesBefore: number;
  nowMs?: number;
}): ReminderSchedule {
  const now = input.nowMs ?? Date.now();
  const visitAt = new Date(input.visitTime);
  const remindAt = new Date(
    visitAt.getTime() - input.remindMinutesBefore * 60_000
  );
  if (
    !Number.isFinite(visitAt.getTime()) ||
    visitAt.getTime() <= now ||
    remindAt.getTime() <= now + 30_000
  ) {
    throw new ReminderTimeError('too_soon');
  }
  if (remindAt.getTime() > now + 30 * 24 * 60 * 60 * 1000) {
    throw new ReminderTimeError('too_far');
  }
  return {
    visitAt: visitAt.toISOString(),
    remindAt: remindAt.toISOString()
  };
}
