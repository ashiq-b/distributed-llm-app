// The frame around every screen: bottom tabs on a phone, a sidebar on desktop (≥ 900 px)
// with the split view docked on the right.
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import SplitPanel from "@/features/split/SplitPanel";
import { useDevice } from "@/lib/stores";
import { freeMib } from "@/lib/format";
import { cn } from "@/lib/utils";
import Notice from "./Notice";
import RoleChip from "./RoleChip";
import { routes, type RouteId } from "./routes";
import { useIsDesktop } from "./useMediaQuery";

function Wordmark() {
  return (
    <span className="flex items-baseline text-xl font-bold tracking-tight">
      Dist<span className="text-signal">LLM</span>
    </span>
  );
}

export default function Shell() {
  const desktop = useIsDesktop();
  const [current, setCurrent] = useState<RouteId>("devices");
  const route = routes.find((r) => r.id === current)!;
  const info = useDevice((s) => s.info);

  const screen = (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 desk:px-8 desk:py-8">
      <Notice />
      <route.Screen />
    </div>
  );

  if (desktop) {
    return (
      <TooltipProvider>
        <div className="grid h-full grid-cols-[15rem_minmax(0,1fr)_20rem] wide:grid-cols-[16rem_minmax(0,1fr)_23rem]">
          <nav aria-label="Sidebar" className="flex flex-col border-r bg-surface pt-[calc(env(safe-area-inset-top)+1.5rem)]">
            <div className="px-6 pb-8"><Wordmark /></div>
            <ul className="space-y-1 px-3">
              {routes.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setCurrent(r.id)}
                    aria-current={r.id === current ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      r.id === current && "bg-signal-soft text-signal-ink hover:bg-signal-soft hover:text-signal-ink",
                    )}
                  >
                    <r.icon className="size-[1.1rem]" aria-hidden />
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-auto space-y-1 border-t px-6 py-5">
              <p className="truncate font-medium">{info?.name ?? "This device"}</p>
              <RoleChip />
              {info && <p className="text-sm text-muted-foreground">{freeMib(info.free_mem_mb)}</p>}
            </div>
          </nav>

          <main className="min-w-0">
            <ScrollArea className="h-full">{screen}</ScrollArea>
          </main>

          <aside aria-label="Split" className="border-l bg-surface">
            <ScrollArea className="h-full">
              <div className="px-6 py-8">
                <h2 className="mb-5 text-sm font-medium text-muted-foreground">How the model is split</h2>
                <SplitPanel />
              </div>
            </ScrollArea>
          </aside>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-4 border-b bg-surface px-4 pb-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <Wordmark />
          <RoleChip className="justify-end" />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pl-safe-l pr-safe-r">{screen}</main>

        <nav aria-label="Tabs" className="border-t bg-surface pb-safe-b pl-safe-l pr-safe-r">
          <ul className="grid grid-cols-3">
            {routes.map((r) => {
              const on = r.id === current;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => setCurrent(r.id)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground",
                      on && "text-signal",
                    )}
                  >
                    {on && <span aria-hidden className="absolute inset-x-8 top-0 h-0.5 rounded-full bg-signal" />}
                    <r.icon className="size-5" aria-hidden />
                    {r.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </TooltipProvider>
  );
}
