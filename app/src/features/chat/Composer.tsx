// Where you write. Enter sends on desktop (Shift+Enter for a new line); on a phone the
// return key adds a line and the arrow sends. While a reply is being written the arrow
// becomes Stop, which ends it where it is (the reply is kept).
import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Composer({
  sending, disabled, desktop, onSend, onStop, placeholder = "Ask something",
}: {
  sending: boolean;
  /** No model to talk to (e.g. a worker dropped out): the field is shown but can't be used. */
  disabled?: boolean;
  desktop: boolean;
  onSend: (text: string, think: boolean) => void;
  onStop: () => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [think, setThink] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // The field grows with what's typed, up to its max height, then scrolls.
  const grow = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };

  const send = () => {
    const t = text.trim();
    if (!t || sending || disabled) return;
    setText("");
    if (box.current) box.current.style.height = "";
    onSend(t, think);
  };

  return (
    <form className="sticky bottom-0 -mx-1 mt-4 bg-background pb-3 pt-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <div
        className={cn(
          "cursor-text rounded-[22px] border border-input bg-raised py-1.5 pl-4 pr-1.5 transition-[border-color,box-shadow,opacity]",
          "focus-within:border-signal/60 focus-within:shadow-[0_0_0_4px_hsl(var(--signal)/0.14)]",
          disabled && "cursor-not-allowed opacity-55",
        )}
        onClick={(e) => { if (e.target === e.currentTarget) box.current?.focus(); }}
      >
        <label htmlFor="msg" className="sr-only">Message</label>
        <textarea id="msg" ref={box} rows={1} placeholder={placeholder} disabled={disabled} enterKeyHint={desktop ? "send" : "enter"}
          className="block max-h-40 min-h-10 w-full resize-none bg-transparent py-2 pr-2.5 text-base leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed"
          value={text} onChange={(e) => { setText(e.target.value); grow(e.target); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && desktop) { e.preventDefault(); send(); } }} />
        <div className="flex items-center justify-between">
          <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" disabled={disabled} className="size-[18px] accent-[hsl(var(--signal))]" checked={think} onChange={(e) => setThink(e.target.checked)} />
            Think first
          </label>
          {sending ? (
            <Button type="button" variant="outline" size="icon" aria-label="Stop" onClick={onStop}><Square className="fill-current" /></Button>
          ) : (
            <Button type="submit" variant="signal" size="icon" aria-label="Send" disabled={disabled || !text.trim()}><ArrowUp /></Button>
          )}
        </div>
      </div>
    </form>
  );
}
