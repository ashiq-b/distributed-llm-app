// The conversation: your messages, the model's replies (reasoning folded away), and the
// reply being written, which grows token by token from the app's `token` events.
import type { ChatMessage } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import Markdown from "./Markdown";
import { splitThinking } from "./thinking";

function Reply({ text, live }: { text: string; live?: boolean }) {
  const { thinking, answer, stillThinking } = splitThinking(text);
  return (
    <div className="min-w-0 max-w-[92%]">
      {thinking != null && (
        <details className="mb-2 rounded-xl border px-3.5 py-2 text-sm text-muted-foreground" open={stillThinking}>
          <summary className="cursor-pointer select-none font-medium">{stillThinking ? "Thinking…" : "Thought it through"}</summary>
          <p className="mt-2 whitespace-pre-wrap break-words">{thinking}</p>
        </details>
      )}
      {(answer || !thinking) && (
        answer ? (
          <Markdown text={answer} className={cn("font-serif text-[1.1875rem] leading-[1.75rem]", live && "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-[1.05em] [&>*:last-child]:after:w-[2px] [&>*:last-child]:after:translate-y-[0.15em] [&>*:last-child]:after:bg-signal [&>*:last-child]:after:content-[''] motion-safe:[&>*:last-child]:after:animate-pulse")} />
        ) : (
          <p className="font-serif text-[1.1875rem] leading-[1.75rem] text-muted-foreground">{live ? "…" : ""}</p>
        )
      )}
    </div>
  );
}

export default function MessageList({
  history, streaming, sending, empty,
}: { history: ChatMessage[]; streaming: string; sending: boolean; empty?: string }) {
  return (
    <ol aria-label="Conversation" className="flex flex-1 flex-col gap-5">
      {history.length === 0 && !sending && empty && <li className="text-pretty text-muted-foreground">{empty}</li>}
      {history.map((m, i) =>
        m.role === "user" ? (
          <li key={i} className="max-w-[82%] self-end whitespace-pre-wrap break-words rounded-[18px] rounded-br-[5px] bg-primary px-4 py-2.5 text-primary-foreground">
            {m.content}
          </li>
        ) : (
          <li key={i}><Reply text={m.content} /></li>
        ),
      )}
      {(streaming || sending) && <li aria-live="polite" data-testid="streaming"><Reply text={streaming} live /></li>}
    </ol>
  );
}
