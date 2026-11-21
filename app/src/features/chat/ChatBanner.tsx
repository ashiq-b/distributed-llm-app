// When the model or a device fails: what happened, in the app's own words, and what to do.
import { useShallow } from "zustand/react/shallow";
import { RotateCw, Server, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chosenPeers, loadModel, useChat, useNav, usePeers, type ChatProblem } from "@/lib/stores";

const TITLE: Record<ChatProblem["kind"], string> = {
  worker_lost: "A device dropped out",
  out_of_memory: "Not enough memory",
  not_loaded: "No model loaded",
  other: "Something went wrong",
};

const HELP: Record<ChatProblem["kind"], string> = {
  worker_lost: "The model was unloaded, since part of it was on that device. Your conversation is kept. Reconnect loads it again with the devices still here, or choose others.",
  out_of_memory: "The devices together don't have room for this model. Turn on more workers, or pick a smaller model.",
  not_loaded: "Load the model again to keep chatting. Your conversation is kept.",
  other: "",
};

export default function ChatBanner() {
  const problem = useChat((s) => s.problem);
  const lastLoad = useChat((s) => s.lastLoad);
  const workers = usePeers(useShallow(chosenPeers));
  const go = useNav((s) => s.go);
  if (!problem) return null;
  const dismiss = () => useChat.setState({ problem: null });
  // Reconnect with the chosen workers that are still on the network.
  const reconnect = () => lastLoad && loadModel(lastLoad.modelId, lastLoad.workers.filter((w) => workers.includes(w)));

  return (
    <div role="alert" className="relative rounded-2xl border border-destructive/45 bg-destructive/[0.07] p-4 pr-11">
      <p className="font-semibold">{TITLE[problem.kind]}</p>
      <p className="mt-0.5 break-words text-sm text-muted-foreground">{problem.message}</p>
      {HELP[problem.kind] && <p className="mt-2 text-pretty text-sm">{HELP[problem.kind]}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {(problem.kind === "worker_lost" || problem.kind === "not_loaded") && lastLoad && (
          <Button size="sm" variant="signal" onClick={reconnect}><RotateCw aria-hidden />Reconnect</Button>
        )}
        {problem.kind !== "other" && (
          <Button size="sm" variant="outline" onClick={() => { dismiss(); go("devices"); }}><Server aria-hidden />Choose devices</Button>
        )}
      </div>
      <button type="button" aria-label="Dismiss" onClick={dismiss}
        className="absolute right-1.5 top-1.5 flex size-11 items-center desk:size-9 justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
