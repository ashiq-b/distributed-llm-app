// What this build is (app version, the pinned llama.cpp, its RPC protocol), and the one
// thing to know before turning a device into a worker: the network has to be trusted.
import { useEffect, useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { about, type About as AboutInfo } from "@/lib/tauri";
import { UNKNOWN } from "@/lib/format";
import { useIsDesktop } from "./useMediaQuery";
import Wordmark from "./Wordmark";

export const TRUSTED_LAN =
  "Devices talk over llama.cpp's RPC protocol, which has no password and no encryption. While a device is a worker, anyone on the same Wi‑Fi can find it and send it work, and what passes between devices can be read on the network. Use Worker only on a network you trust, such as your home or office Wi‑Fi, and switch back to Idle when you're done.";

function Body() {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { about().then(setInfo).catch(() => setFailed(true)); }, []);
  const v = (x: string | undefined) => x ?? (failed ? UNKNOWN : "…");
  return (
    <div className="space-y-6">
      <dl className="num grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2.5 border-y py-4 text-sm">
        <dt className="text-muted-foreground">App version</dt>
        <dd>{v(info?.app_ver)}</dd>
        <dt className="text-muted-foreground">llama.cpp</dt>
        <dd className="min-w-0">
          {v(info?.llama_cpp_tag)}
          <span className="block select-all break-all font-mono text-xs text-muted-foreground" title="Commit">{v(info?.llama_cpp_commit)}</span>
        </dd>
        <dt className="text-muted-foreground">RPC protocol</dt>
        <dd>{v(info?.rpc_proto)} <span className="text-muted-foreground">(devices must match)</span></dd>
      </dl>
      <section aria-labelledby="trusted-lan" className="rounded-2xl border border-warn/40 bg-warn/[0.07] p-4">
        <h3 id="trusted-lan" className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="size-[1.1rem] shrink-0 text-warn" aria-hidden />
          Use on a network you trust
        </h3>
        <p className="mt-1.5 text-pretty text-sm">{TRUSTED_LAN}</p>
      </section>
    </div>
  );
}

const INTRO = "Runs a language model across the phones and computers on your Wi‑Fi, each holding part of it, with llama.cpp.";

export default function About({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const desktop = useIsDesktop();
  const title: ReactNode = <span className="flex items-center gap-3"><Wordmark /></span>;
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby="about-intro" className="max-w-md rounded-2xl bg-surface">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg">{title}<span className="sr-only">About</span></DialogTitle>
            <DialogDescription id="about-intro" className="text-pretty">{INTRO}</DialogDescription>
          </DialogHeader>
          {open && <Body />}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-surface pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <SheetHeader className="mb-4 text-left">
          <SheetTitle className="text-lg">{title}<span className="sr-only">About</span></SheetTitle>
          <SheetDescription className="text-pretty">{INTRO}</SheetDescription>
        </SheetHeader>
        {open && <Body />}
      </SheetContent>
    </Sheet>
  );
}
