// Load a model (on this device, with the workers picked in Devices) and talk to it.
// (Task 4.4 replaces this with the full chat screen.)
import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { becomeHost, chatHistory, chatReset, chatSend, chatStop, leaveRole } from "@/lib/tauri";
import { chosenPeers, useChat, useModels, useNotice, usePeers, useRole } from "@/lib/stores";
import { seconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/app/useMediaQuery";
import SplitPanel from "@/features/split/SplitPanel";

function LoadCard() {
  const models = useModels((s) => s.models).filter((m) => m.status.state === "ready");
  const peers = usePeers((s) => s.peers);
  const workers = usePeers(chosenPeers);
  const fail = useNotice((s) => s.fail);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const id = models.some((m) => m.id === modelId) ? modelId : models[0]?.id ?? "";
  const names = workers.map((w) => peers.find((p) => p.id === w)?.name).filter(Boolean);

  if (models.length === 0) {
    return <p className="text-muted-foreground">No model on this device yet. Download one in Models, then load it here.</p>;
  }
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="text-sm text-muted-foreground">Model</span>
          <select
            className="h-11 w-full rounded-md border border-input bg-background px-3 desk:h-9"
            value={id}
            onChange={(e) => setModelId(e.target.value)}
          >
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          {names.length === 0 ? "Runs on this device only. Pick workers in Devices to split it." : `Split with ${names.join(", ")}.`}
        </p>
        <Button
          variant="signal"
          disabled={busy || !id}
          onClick={async () => {
            setBusy(true);
            try { await becomeHost(id, workers); } catch (e) { fail(e); } finally { setBusy(false); }
          }}
        >
          Load
        </Button>
      </CardContent>
    </Card>
  );
}

function SplitSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" aria-label="How the model is split"><Layers /></Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <SheetHeader className="mb-4 text-left">
          <SheetTitle>How the model is split</SheetTitle>
          <SheetDescription>As llama.cpp placed it when loading.</SheetDescription>
        </SheetHeader>
        <SplitPanel />
      </SheetContent>
    </Sheet>
  );
}

function Conversation({ modelId }: { modelId: string }) {
  const desktop = useIsDesktop();
  const { history, streaming, summary, sending } = useChat();
  const fail = useNotice((s) => s.fail);
  const [text, setText] = useState("");
  const [think, setThink] = useState(false);

  useEffect(() => { chatHistory().then((history) => useChat.setState({ history })).catch(fail); }, [fail]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    useChat.setState((s) => ({ history: [...s.history, { role: "user", content: t }], streaming: "", summary: null, sending: true }));
    try {
      const s = await chatSend(t, think);
      // Ran out of length mid-thought: keep the reasoning on screen, it's all there is.
      useChat.setState((st) => ({ summary: s, streaming: s.stopped === "max_tokens_while_thinking" ? st.streaming : "" }));
    } catch (e) {
      fail(e);
    } finally {
      useChat.setState({ sending: false, history: await chatHistory().catch(() => useChat.getState().history) });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">{modelId}</h1>
        {!desktop && <SplitSheet />}
        <Button variant="outline" disabled={sending} onClick={() => chatReset().then(() => useChat.setState({ history: [], streaming: "", summary: null })).catch(fail)}>
          New chat
        </Button>
        <Button variant="ghost" disabled={sending} onClick={() => leaveRole().then((role) => useRole.setState({ role })).catch(fail)}>
          Unload
        </Button>
      </div>

      {history.length === 0 && !sending && <p className="text-muted-foreground">Ask anything. Answers are generated across the devices in the split.</p>}

      <ol className="space-y-4">
        {history.map((m, i) => (
          <li key={i} className={cn("max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-4 py-2.5",
            m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-card border")}>
            {m.content}
          </li>
        ))}
        {streaming && (
          <li className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg border bg-card px-4 py-2.5" aria-live="polite">{streaming}</li>
        )}
      </ol>

      {summary?.stopped === "max_tokens_while_thinking" && (
        <p className="text-sm text-destructive">Ran out of length while thinking, so there is no answer. Ask again, or turn off Think first.</p>
      )}
      {summary && (
        <p className="text-sm text-muted-foreground">{summary.tokens} tokens in {seconds(summary.millis)}{summary.stopped === "cancelled" ? ", stopped" : ""}</p>
      )}

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          className="min-h-24 w-full resize-y rounded-lg border border-input bg-background px-4 py-3"
          placeholder="Ask something"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && desktop) { e.preventDefault(); send(); } }}
          aria-label="Message"
        />
        <div className="flex items-center gap-3">
          <label className="flex min-h-11 flex-1 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5 accent-[hsl(var(--signal))]" checked={think} onChange={(e) => setThink(e.target.checked)} />
            Think first
          </label>
          {sending
            ? <Button type="button" variant="outline" onClick={() => chatStop().catch(fail)}>Stop</Button>
            : <Button type="submit" variant="signal" disabled={!text.trim()}>Send</Button>}
        </div>
      </form>
    </div>
  );
}

export default function ChatScreen() {
  const role = useRole((s) => s.role);

  if (role?.role === "host") return <Conversation modelId={role.model_id} />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
      {role?.role === "loading" ? (
        <Card>
          <CardContent className="space-y-3 p-5">
            <p>Loading {role.model_id}</p>
            <Progress value={role.frac * 100} aria-label="Loading" />
            <p className="text-sm text-muted-foreground">{Math.round(role.frac * 100)}%. Weights the workers already have aren't sent again.</p>
          </CardContent>
        </Card>
      ) : role?.role === "worker" ? (
        <p className="text-muted-foreground">This device is a worker until the app is closed. Chat from the device that hosts the model.</p>
      ) : (
        <LoadCard />
      )}
    </div>
  );
}
