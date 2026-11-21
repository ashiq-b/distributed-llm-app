// Load a model (on this device, with the workers picked in Devices) and talk to it.
// If a device drops out, the conversation stays on screen with a banner that says what
// happened and what to do; the composer waits until the model is back.
import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { ChevronUp, Power, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import MeshView from "@/features/mesh/MeshView";
import { peerNodes } from "@/features/mesh/nodes";
import { LayerBar } from "@/features/split/LayerBands";
import LiveStats from "@/features/split/LiveStats";
import SplitView from "@/features/split/SplitView";
import { chatHistory, chatReset, chatSend, chatStop, leaveRole, type DeviceShare } from "@/lib/tauri";
import { chosenPeers, classify, loadModel, useChat, useLayout, useModels, useNav, useNotice, usePeers, useRole } from "@/lib/stores";
import { toneOf } from "@/features/split/LayerBands";
import { withPeerNames } from "@/features/split/names";
import { fileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/app/useMediaQuery";
import ChatBanner from "./ChatBanner";
import Composer from "./Composer";
import MessageList from "./MessageList";

function LoadPanel() {
  const models = useModels((s) => s.models).filter((m) => m.status.state === "ready");
  const peers = usePeers((s) => s.peers);
  const workers = usePeers(useShallow(chosenPeers));
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
        {chosen.length > 0 && <MeshView className="h-44" nodes={peerNodes(chosen)} listen={false} trunk="This device" />}
        <p className="mt-2 text-pretty text-sm text-muted-foreground">
          {chosen.length === 0
            ? "Runs on this device only. Turn on workers in Devices to split it."
            : `Split across this device and ${chosen.map((p) => p.name).join(", ")}.`}
        </p>
      </div>
      <Button variant="signal" className="w-full desk:w-auto" disabled={busy || !id}
        onClick={async () => {
          setBusy(true);
          try { await loadModel(id, workers); } finally { setBusy(false); }
        }}>
        Load {models.find((m) => m.id === id)?.name}
      </Button>
    </div>
  );
}

/** Phone: the split, folded into a card that opens a sheet. Until the sheet has been
 * opened once, the card says plainly that it opens and what's inside. */
function SplitSheet({ shares: raw }: { shares: DeviceShare[] }) {
  const peers = usePeers((s) => s.peers);
  const { seenSplit, sawSplit } = useLayout();
  const shares = withPeerNames(raw, peers);
  return (
    <Sheet onOpenChange={(open) => open && sawSplit()}>
      <SheetTrigger asChild>
        <button
          className={cn(
            "group relative w-full touch-manipulation rounded-2xl border bg-surface p-3.5 text-left transition-transform active:scale-[0.99]",
            !seenSplit && "border-signal/50 shadow-[0_0_0_4px_hsl(var(--signal)/0.10)]",
          )}
          aria-label="How it's split: open the live view of which device holds which layers"
        >
          <span className="mb-2.5 flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              {!seenSplit && (
                <span aria-hidden className="relative flex size-2 shrink-0">
                  <span className="absolute inset-0 rounded-full bg-signal motion-safe:animate-ping" />
                  <span className="relative size-2 rounded-full bg-signal" />
                </span>
              )}
              <span className="truncate">How it's split</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-signal">
              {seenSplit ? "Open" : "Tap to see it live"}
              <ChevronUp aria-hidden className="size-4 transition-transform group-active:-translate-y-0.5" />
            </span>
          </span>
          <LayerBar shares={shares} />
          <span className="num mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {shares.map((s, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", toneOf(shares, i))} />
                <span className={cn("truncate", !s.is_remote && "text-signal")}>{s.is_remote ? s.name : "This device"}</span>
                {s.layers && <span>{s.layers[0]}–{s.layers[1]}</span>}
              </span>
            ))}
          </span>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-surface pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <SheetHeader className="mb-2 text-left">
          <SheetTitle className="font-serif text-2xl font-medium">How it's split</SheetTitle>
          <SheetDescription>Live, from the devices doing the work.</SheetDescription>
        </SheetHeader>
        <SplitView />
      </SheetContent>
    </Sheet>
  );
}

/** "This device and Mac": the devices holding the model, by the names they announce. */
function devicesLine(shares: DeviceShare[]) {
  const names = shares.map((s) => (s.is_remote ? s.name : "this device"));
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return list ? `On ${list}` : "";
}

/** The conversation with a loaded model, or, after a device dropped out, the same
 * conversation waiting for the model to come back (`shares` is null then). */
function Conversation({ modelId, shares: raw }: { modelId: string; shares: DeviceShare[] | null }) {
  const desktop = useIsDesktop();
  const { history, streaming, sending } = useChat();
  const peers = usePeers((s) => s.peers);
  const fail = useNotice((s) => s.fail);
  const name = useModels((s) => s.models.find((m) => m.id === modelId)?.name ?? modelId);
  const end = useRef<HTMLDivElement>(null);
  const online = raw != null;
  const shares = raw ? withPeerNames(raw, peers) : null;
  const summary = useChat((s) => s.summary);

  useEffect(() => { chatHistory().then((history) => useChat.setState({ history })).catch(fail); }, [fail, online]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [history.length, streaming]);

  const send = async (text: string, think: boolean) => {
    useChat.setState((s) => ({ history: [...s.history, { role: "user", content: text }], streaming: "", summary: null, sending: true, live: null, problem: null }));
    try {
      const s = await chatSend(text, think);
      // Ran out of length mid-thought: keep the reasoning on screen, it's all there is.
      useChat.setState((st) => ({ summary: s, streaming: s.stopped === "max_tokens_while_thinking" ? st.streaming : "" }));
    } catch (e) {
      useChat.setState({ problem: classify(e), streaming: "" });
    } finally {
      useChat.setState({ sending: false, history: await chatHistory().catch(() => useChat.getState().history) });
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-10rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col desk:min-h-[calc(100dvh-4.5rem)]">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-balance break-words font-serif text-3xl font-medium tracking-tight desk:text-4xl">{name}</h1>
          <p className="num mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", online ? "bg-signal" : "bg-destructive")} />
            <span className="min-w-0 truncate">{shares ? devicesLine(shares) : "Not loaded"}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" disabled={sending || !online}
            onClick={() => chatReset().then(() => useChat.setState({ history: [], streaming: "", summary: null, live: null })).catch(fail)}>
            <SquarePen aria-hidden />New chat
          </Button>
          {online && (
            <Button variant="outline" size="sm" disabled={sending} onClick={() => leaveRole().then((role) => useRole.setState({ role })).catch(fail)}>
              <Power aria-hidden />Unload
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-3 empty:hidden">
        <ChatBanner />
        {!desktop && shares && <SplitSheet shares={shares} />}
      </div>

      <div className="mt-6 flex flex-1 flex-col">
        <MessageList history={history} streaming={streaming} sending={sending}
          empty="Ask anything. Every token passes through each device in the split." />
      </div>

      {summary?.stopped === "max_tokens_while_thinking" && (
        <p className="mt-3 text-sm text-destructive">Ran out of length while thinking, so there is no answer. Ask again, or turn off Think first.</p>
      )}
      <LiveStats className="mt-3" />
      <div ref={end} />

      <Composer desktop={desktop} sending={sending} disabled={!online}
        placeholder={online ? "Ask something" : "Reconnect to keep chatting"}
        onSend={send} onStop={() => chatStop().catch(fail)} />
    </div>
  );
}

export default function ChatScreen() {
  const role = useRole((s) => s.role);
  const go = useNav((s) => s.go);
  const desktop = useIsDesktop();

  const problem = useChat((s) => s.problem);
  const lastLoad = useChat((s) => s.lastLoad);
  const models = useModels((s) => s.models);
  const nameOf = (id: string) => models.find((m) => m.id === id)?.name ?? id;

  if (role?.role === "host") return <Conversation modelId={role.model_id} shares={role.shares} />;
  // A device dropped out mid-conversation: keep the conversation, wait for Reconnect.
  if (role?.role === "idle" && problem?.kind === "worker_lost" && lastLoad) {
    return <Conversation modelId={lastLoad.modelId} shares={null} />;
  }
  return (
    <div className="space-y-5">
      <h1 className="font-serif text-4xl font-medium tracking-tight">Chat</h1>
      <ChatBanner />
      {role?.role === "loading" ? (
        desktop ? (
          <div className="space-y-3">
            <p className="font-serif text-2xl">Loading {nameOf(role.model_id)}</p>
            <Progress value={role.frac * 100} aria-label="Loading" />
            <p className="num text-sm text-muted-foreground">{Math.round(role.frac * 100)}%</p>
          </div>
        ) : <SplitView />
      ) : role?.role === "worker" ? (
        <div className="space-y-4">
          <p className="text-pretty text-muted-foreground">This device is a worker, holding layers for other devices. To load a model here, switch it to Idle first.</p>
          <Button variant="outline" onClick={() => go("devices")}>Go to Devices</Button>
        </div>
      ) : (
        <LoadPanel />
      )}
    </div>
  );
}
