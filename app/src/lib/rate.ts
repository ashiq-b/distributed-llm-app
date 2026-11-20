// Live speed of an answer, from the arrival times of its tokens.
export interface Live {
  tokens: number;
  /** When the first token arrived (ms, performance.now()). */
  firstAt: number;
  lastAt: number;
}

export function addToken(live: Live | null, now: number): Live {
  return live ? { ...live, tokens: live.tokens + 1, lastAt: now } : { tokens: 1, firstAt: now, lastAt: now };
}

/** Tokens per second between the first and the latest token; null until there are two. */
export function tokensPerSecond(live: Live | null): number | null {
  if (!live || live.tokens < 2 || live.lastAt <= live.firstAt) return null;
  return ((live.tokens - 1) * 1000) / (live.lastAt - live.firstAt);
}
