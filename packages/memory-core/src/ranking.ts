const TOKEN_SPLIT_PATTERN = /[^\p{L}\p{N}_]+/u;

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(TOKEN_SPLIT_PATTERN)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function lexicalScore(content: string, query: string | undefined): number {
  if (!query || query.trim().length === 0) {
    return 0;
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const contentTokens = new Set(tokenize(content));
  const matched = queryTokens.reduce(
    (count, token) => count + (contentTokens.has(token) ? 1 : 0),
    0,
  );
  return matched / queryTokens.length;
}

export function recencyScore(updatedAt: number, now = Date.now()): number {
  const ageMs = Math.max(0, now - updatedAt);
  const ageMinutes = ageMs / 60_000;
  return 1 / (1 + ageMinutes);
}

export function combinedScore(
  content: string,
  query: string | undefined,
  updatedAt: number,
  now = Date.now(),
): number {
  const lexical = lexicalScore(content, query);
  const recency = recencyScore(updatedAt, now);
  if (!query || query.trim().length === 0) {
    return recency;
  }
  return lexical * 0.7 + recency * 0.3;
}
