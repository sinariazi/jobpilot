export function passesMinimumDecisionScore(score: number | null, minimumScore: number) {
  return minimumScore <= 0 || (score !== null && score >= minimumScore);
}

export function compareDecisionScores(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}
