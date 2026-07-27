import { DomainError } from "./feature-gates";

export const QUIZ_QUESTION_COUNT = 10;
export const QUIZ_PASS_PERCENT = 80;
export const QUIZ_DURATION_MINUTES = 30;
export const MINIMUM_QUESTION_BANK = 20;

export function scoreQuiz(
  correct: number,
  total: number,
): {
  score: number;
  passed: boolean;
} {
  if (total !== QUIZ_QUESTION_COUNT || correct < 0 || correct > total) {
    throw new DomainError("INVALID_QUIZ_RESULT", "invalid quiz result");
  }
  const score = Math.round((correct / total) * 100);
  return { score, passed: score >= QUIZ_PASS_PERCENT };
}

export function assertAttemptOpen(startedAt: Date, submittedAt: Date): void {
  if (
    submittedAt.getTime() - startedAt.getTime() >
    QUIZ_DURATION_MINUTES * 60_000
  ) {
    throw new DomainError("QUIZ_TIMEOUT", "quiz attempt expired");
  }
}

export function deterministicDraw<T>(
  values: readonly T[],
  randomValues: readonly number[],
): T[] {
  if (values.length < MINIMUM_QUESTION_BANK) {
    throw new DomainError("QUESTION_BANK_TOO_SMALL", "20 questions required");
  }
  const shuffled = [...values];
  for (let index = shuffled.length - 1, randomIndex = 0; index > 0; index--) {
    const random = randomValues[randomIndex++ % randomValues.length] ?? 0;
    const swap = Math.floor(
      Math.max(0, Math.min(0.999999, random)) * (index + 1),
    );
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, QUIZ_QUESTION_COUNT);
}
