// Load a model (on this device, with the workers picked in Devices) and talk to it.
// (Task 4.4 adds the remaining chat states.)
import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import MeshView from "@/features/mesh/MeshView";
import { peerNodes } from "@/features/mesh/nodes";
import { LayerBar } from "@/features/split/LayerBands";
import LiveStats from "@/features/split/LiveStats";
import SplitPanel from "@/features/split/SplitPanel";
import { becomeHost, chatHistory, chatReset, chatSend, chatStop, leaveRole, type DeviceShare } from "@/lib/tauri";
import { chosenPeers, useChat, useModels, useNav, useNotice, usePeers, useRole } from "@/lib/stores";
import { fileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/app/useMediaQuery";
import { splitThinking } from "./thinking";

function LoadPanel() {
  const models = useModels((s) => s.models).filter((m) => m.status.state === "ready");
  const peers = usePeers((s) => s.peers);
  const workers = usePeers(useShallow(chosenPeers));
  const fail = useNotice((s) => s.fail);
  const go = useNav((s) => s.go);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const id = models.some((m) => m.id === modelId) ? modelId : models[0]?.id ?? "";
  const chosen = peers.filter((p) => workers.includes(p.id));

  if (models.length === 0) {
    return (
      <div className="space-y-4 border-t pt-5">
        <p className="text-pretty text-muted-foreground">No model on this device yet. Download one, then load it here.</p>
        <Button onClick={() => go("models")}>Go to Models</Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <fieldset className="border-t">
        <legend className="sr-only">Model</legend>
        {models.map((m) => (
          <label key={m.id} className="flex min-h-14 cursor-pointer items-center gap-3 border-b py-3">
            <input type="radio" name="model" className="size-5 accent-[hsl(var(--signal))]" checked={id === m.id} onChange={() => setModelId(m.id)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-serif text-xl font-medium">{m.name}</span>
              <span className="num block text-sm text-muted-foreground">{m.vendor}, {fileSize(m.size_bytes)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <MeshView className="h-44" nodes={peerNodes(chosen)} listen={false} trunk="This device" />
        <p className="mt-2 text-pretty text-sm text-muted-foreground">
          {chosen.length === 0
            ? "Runs on this device only. Turn on workers in Devices to split it."
            : `Split across this device and ${chosen.map((p) => p.name).join(", ")}.`}
        </p>
      </div>
      <Button variant="signal" className="w-full desk:w-auto" disabled={busy || !id}
        onClick={async () => {
          setBusy(true);
          try { await becomeHost(id, workers); } catch (e) { fail(e); } finally { setBusy(false); }
        }}>
        Load {models.find((m) => m.id === id)?.name}
      </Button>
    </div>
  );
}

function SplitSheet({ shares }: { shares: DeviceShare[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="w-full rounded-2xl border bg-surface p-3.5 text-left" aria-label="Show how the model is split">
          <LayerBar shares={shares} />
          <span className="mt-2.5 flex justify-between gap-3 text-sm">
            <span className="truncate text-muted-foreground">
              {shares.filter((s) => s.is_remote).map((s) => s.name).join(", ") || "This device only"}
            </span>
            <span className="shrink-0 font-semibold text-signal">How it's split</span>
          </span>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-surface pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <SheetHeader className="mb-2 text-left">
          <SheetTitle className="font-serif text-2xl font-medium">How it's split</SheetTitle>
          <SheetDescription>Live, from the devices doing the work.</SheetDescription>
        </SheetHeader>
        <SplitPanel />
      </SheetContent>
    </Sheet>
  );
}

function Reply({ text, live }: { text: string; live?: boolean }) {
  const { thinking, answer, stillThinking } = splitThinking(text);
  return (
    <div className="max-w-[92%] min-w-0">
      {thinking != null && (
        <details className="mb-2 rounded-xl border px-3.5 py-2 text-sm text-muted-foreground" open={stillThinking}>
          <summary className="cursor-pointer select-none font-medium">{stillThinking ? "Thinking…" : "Thought it through"}</summary>
          <p className="mt-2 whitespace-pre-wrap break-words">{thinking}</p>
        </details>
      )}
      {(answer || !thinking) && (
        <p className={cn("whitespace-pre-wrap break-words font-serif text-[1.1875rem] leading-[1.75rem]", live && !answer && "text-muted-foreground")}>
          {answer || (live ? "…" : "")}
        </p>
      )}
    </div>
  );
}

function Conversation({ modelId, shares }: { modelId: string; shares: DeviceShare[] }) {
  const desktop = useIsDesktop();
  const { history, streaming, summary, sending } = useChat();
  const fail = useNotice((s) => s.fail);
  const [text, setText] = useState("");
  const [think, setThink] = useState(false);
  const name = useModels((s) => s.models.find((m) => m.id === modelId)?.name ?? modelId);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { chatHistory().then((history) => useChat.setState({ history })).catch(fail); }, [fail]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [history.length, streaming]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setText("");
    useChat.setState((s) => ({ history: [...s.history, { role: "user", content: t }], streaming: "", summary: null, sending: true, live: null }));
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
    <div className="flex min-h-[calc(100dvh-10rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col desk:min-h-[calc(100dvh-4.5rem)]">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="min-w-0 truncate font-serif text-3xl font-medium tracking-tight desk:text-4xl">{name}</h1>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" disabled={sending}
            onClick={() => chatReset().then(() => useChat.setState({ history: [], streaming: "", summary: null, live: null })).catch(fail)}>
            New chat
          </Button>
          <Button variant="ghost" size="sm" disabled={sending} onClick={() => leaveRole().then((role) => useRole.setState({ role })).catch(fail)}>
            Unload
          </Button>
        </div>
      </div>

      {!desktop && <div className="mt-3"><SplitSheet shares={shares} /></div>}

      <ol className="mt-6 flex flex-1 flex-col gap-5">
        {history.length === 0 && !sending && (
          <li className="text-pretty text-muted-foreground">Ask anything. Every token passes through each device in the split.</li>
        )}
        {history.map((m, i) =>
          m.role === "user" ? (
            <li key={i} className="max-w-[82%] self-end whitespace-pre-wrap break-words rounded-[18px] rounded-br-[5px] bg-primary px-4 py-2.5 text-primary-foreground">
              {m.content}
            </li>
          ) : (
            <li key={i}><Reply text={m.content} /></li>
          ),
        )}
        {(streaming || sending) && <li aria-live="polite"><Reply text={streaming} live /></li>}
      </ol>

      {summary?.stopped === "max_tokens_while_thinking" && (
        <p className="mt-3 text-sm text-destructive">Ran out of length while thinking, so there is no answer. Ask again, or turn off Think first.</p>
      )}
      <LiveStats className="mt-3" />
      <div ref={end} />

      <form className="sticky bottom-0 -mx-1 mt-4 bg-background pb-3 pt-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div className="rounded-[22px] border border-input bg-raised py-1.5 pl-4 pr-1.5">
          <label htmlFor="msg" className="sr-only">Message</label>
          <textarea id="msg" rows={1} placeholder="Ask something"
            className="max-h-40 min-h-10 w-full resize-none bg-transparent py-2 text-base outline-none placeholder:text-muted-foreground"
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && desktop) { e.preventDefault(); send(); } }} />
          <div className="flex items-center justify-between">
            <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="size-[18px] accent-[hsl(var(--signal))]" checked={think} onChange={(e) => setThink(e.target.checked)} />
              Think first
            </label>
            {sending ? (
              <Button type="button" variant="outline" size="icon" aria-label="Stop" onClick={() => chatStop().catch(fail)}><Square className="fill-current" /></Button>
            ) : (
              <Button type="submit" variant="signal" size="icon" aria-label="Send" disabled={!text.trim()}><ArrowUp /></Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

export default function ChatScreen() {
  const role = useRole((s) => s.role);
  const desktop = useIsDesktop();

  if (role?.role === "host") return <Conversation modelId={role.model_id} shares={role.shares} />;
  return (
    <div className="space-y-5">
      <h1 className="font-serif text-4xl font-medium tracking-tight">Chat</h1>
      {role?.role === "loading" ? (
        desktop ? (
          <div className="space-y-3">
            <p className="font-serif text-2xl">Loading {role.model_id}</p>
            <Progress value={role.frac * 100} aria-label="Loading" />
            <p className="num text-sm text-muted-foreground">{Math.round(role.frac * 100)}%</p>
          </div>
        ) : <SplitPanel />
      ) : role?.role === "worker" ? (
        <p className="text-pretty text-muted-foreground">This device is holding layers for a host until the app is closed. Chat from the host.</p>
      ) : (
        <LoadPanel />
      )}
    </div>
  );
}
