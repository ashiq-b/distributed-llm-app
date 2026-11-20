/** Splits a streamed reply into its reasoning (inside <think>…</think>) and its answer. */
export function splitThinking(text: string): { thinking: string | null; answer: string; stillThinking: boolean } {
  const open = text.indexOf("<think>");
  if (open < 0) return { thinking: null, answer: text, stillThinking: false };
  const close = text.indexOf("</think>", open);
  if (close < 0) return { thinking: text.slice(open + 7).trim(), answer: "", stillThinking: true };
  return { thinking: text.slice(open + 7, close).trim(), answer: text.slice(close + 8).trimStart(), stillThinking: false };
}
