// The frame around every screen: bottom tabs on a phone, a sidebar on desktop (≥ 900 px)
// with the split view docked on the right.
import { useEffect, useRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import SplitPanel from "@/features/split/SplitPanel";
import { useDevice, useNav } from "@/lib/stores";
import { freeMib } from "@/lib/format";
import { cn } from "@/lib/utils";
import Notice from "./Notice";
import RoleChip from "./RoleChip";
import Wordmark from "./Wordmark";
import { routes } from "./routes";
import { useIsDesktop } from "./useMediaQuery";

export default function Shell() {
  const desktop = useIsDesktop();
  const { screen: current, go } = useNav();
  const route = routes.find((r) => r.id === current)!;
  const info = useDevice((s) => s.info);
  const main = useRef<HTMLElement>(null);

  // A new screen starts at its top.
  useEffect(() => { main.current?.scrollTo?.({ top: 0 }); }, [current]);

  const screen = (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-4 px-5 pb-8 pt-6 desk:px-12 desk:pt-10">
      <Notice />
      <route.Screen />
    </div>
  );

  if (desktop) {
    return (
      <TooltipProvider>
        <div className="grid h-full grid-cols-[15rem_minmax(0,1fr)_21rem] wide:grid-cols-[16rem_minmax(0,1fr)_24rem]">
          <nav aria-label="Sidebar" className="flex min-h-0 flex-col border-r px-3.5 pb-5 pt-7">
            <div className="px-3 pb-8"><Wordmark /></div>
            <ul className="space-y-1">
              {routes.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => go(r.id)}
                    aria-current={r.id === current ? "page" : undefined}
                    className={cn(
                      "flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-left font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      r.id === current && "bg-signal-soft text-signal-ink hover:bg-signal-soft hover:text-signal-ink",
                    )}
                  >
                    <r.icon className="size-[1.1rem]" strokeWidth={1.6} aria-hidden />
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-auto space-y-1 border-t px-3 pt-4">
              <p className="truncate font-semibold">{info?.name ?? "This device"}</p>
              <RoleChip className="flex" />
              {info && <p className="num text-sm text-muted-foreground">{freeMib(info.free_mem_mb)}</p>}
            </div>
          </nav>

          <main ref={main} className="min-w-0 overflow-y-auto overflow-x-clip">{screen}</main>

          <aside aria-label="Split" className="min-h-0 overflow-y-auto overflow-x-clip border-l bg-surface px-7 pb-7 pt-10">
            <h2 className="mb-1 font-serif text-2xl font-medium">How it's split</h2>
            <p className="mb-5 text-sm text-muted-foreground">Live, from the devices doing the work.</p>
            <SplitPanel />
          </aside>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex items-center justify-between gap-4 pb-2 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <Wordmark />
          <RoleChip className="justify-end" />
        </header>

        <main ref={main} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain pl-safe-l pr-safe-r">{screen}</main>

        <nav aria-label="Tabs" className="border-t bg-surface pb-safe-b pl-safe-l pr-safe-r">
          <ul className="grid grid-cols-3 px-2">
            {routes.map((r) => {
              const on = r.id === current;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => go(r.id)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "relative flex h-[3.4rem] w-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground transition-colors active:opacity-70",
                      on && "text-signal",
                    )}
                  >
                    <span aria-hidden className={cn("absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-signal transition-opacity", on ? "opacity-100" : "opacity-0")} />
                    <r.icon className="size-[1.375rem]" strokeWidth={1.6} aria-hidden />
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
