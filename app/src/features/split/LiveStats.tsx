// Speed of the answer as it streams, from real token arrival times.
import { useEffect, useState } from "react";
import { useChat } from "@/lib/stores";
import { tokensPerSecond } from "@/lib/rate";
import { seconds } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function LiveStats({ className }: { className?: string }) {
  const { live, sending, summary } = useChat();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [sending]);

  const rate = tokensPerSecond(live);
  if (sending) {
    return (
      <p className={cn("num flex items-center gap-2 text-sm", className)} aria-live="off">
        <span aria-hidden className="size-2 rounded-full bg-signal motion-safe:animate-pulse" />
        {live ? (
          <>
            <span className="font-semibold">{rate == null ? "…" : rate.toFixed(1)}</span>
            <span className="text-muted-foreground">tokens/s, {live.tokens} so far</span>
          </>
        ) : (
          <span className="text-muted-foreground">Reading your message…</span>
        )}
      </p>
    );
  }
  if (!summary) return null;
  const avg = summary.millis > 0 ? (summary.tokens * 1000) / summary.millis : null;
  return (
    <p className={cn("num text-sm text-muted-foreground", className)}>
      {summary.tokens} tokens in {seconds(summary.millis)}
      {avg != null && `, ${avg.toFixed(1)} tokens/s`}
      {summary.stopped === "cancelled" && ", stopped"}
    </p>
  );
}
