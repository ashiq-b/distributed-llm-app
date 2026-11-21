// The frame around every screen: bottom tabs on a phone, a sidebar on desktop (≥ 900 px)
// with the split view docked on the right while a model is loading or loaded.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import SplitView from "@/features/split/SplitView";
import { useDevice, useLayout, useNav, useRole } from "@/lib/stores";
import { freeMib } from "@/lib/format";
import { cn } from "@/lib/utils";
import About from "./About";
import Notice from "./Notice";
import RoleChip from "./RoleChip";
import ThemeToggle from "./ThemeToggle";
import Wordmark from "./Wordmark";
import { routes } from "./routes";
import { useIsDesktop } from "./useMediaQuery";

export default function Shell() {
  const desktop = useIsDesktop();
  const { screen: current, go } = useNav();
  const route = routes.find((r) => r.id === current)!;
  const info = useDevice((s) => s.info);
  const main = useRef<HTMLElement>(null);
  const role = useRole((s) => s.role?.role);
  const split = role === "host" || role === "loading";
  const typing = useTyping();
  const layout = useLayout();
  const dock = split && layout.split;

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
      <TooltipProvider delayDuration={300}>
        <div
          data-nav={layout.nav ? "open" : "closed"}
          data-dock={dock ? "open" : "closed"}
          className={cn(
            "grid h-full transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none",
            layout.nav && dock && "grid-cols-[15rem_minmax(0,1fr)_21rem] wide:grid-cols-[16rem_minmax(0,1fr)_24rem]",
            layout.nav && !dock && "grid-cols-[15rem_minmax(0,1fr)_0rem] wide:grid-cols-[16rem_minmax(0,1fr)_0rem]",
            !layout.nav && dock && "grid-cols-[4.25rem_minmax(0,1fr)_21rem] wide:grid-cols-[4.25rem_minmax(0,1fr)_24rem]",
            !layout.nav && !dock && "grid-cols-[4.25rem_minmax(0,1fr)_0rem]",
          )}
        >
          <nav aria-label="Sidebar" className={cn("flex min-h-0 flex-col overflow-hidden border-r pb-5 pt-7", layout.nav ? "px-3.5" : "items-center px-2")}>
            <div className={cn("flex items-center pb-8", layout.nav ? "justify-between pl-3" : "flex-col gap-5")}>
              <button type="button" onClick={() => layout.setAbout(true)} aria-label="About distllm"
                className="-m-1.5 rounded-lg p-1.5 transition-opacity hover:opacity-80">
                {layout.nav ? <Wordmark /> : <WordmarkIcon />}
              </button>
              <div className={cn("flex items-center", layout.nav ? "gap-1" : "flex-col-reverse gap-4")}>
                <ThemeToggle />
                <Toggle label={layout.nav ? "Hide sidebar" : "Show sidebar"} side="right" onClick={layout.toggleNav}>
                  {layout.nav ? <PanelLeftClose /> : <PanelLeftOpen />}
                </Toggle>
              </div>
            </div>
            <ul className="w-full space-y-1">
              {routes.map((r) => {
                const on = r.id === current;
                const item = (
                  <button
                    onClick={() => go(r.id)}
                    aria-current={on ? "page" : undefined}
                    aria-label={layout.nav ? undefined : r.label}
                    className={cn(
                      "flex h-10 w-full items-center gap-3 rounded-[10px] text-left font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      layout.nav ? "px-3" : "justify-center",
                      on && "bg-signal-soft text-signal-ink hover:bg-signal-soft hover:text-signal-ink",
                    )}
                  >
                    <r.icon className="size-[1.1rem] shrink-0" strokeWidth={1.6} aria-hidden />
                    {layout.nav && r.label}
                  </button>
                );
                return (
                  <li key={r.id}>
                    {layout.nav ? item : (
                      <Tooltip>
                        <TooltipTrigger asChild>{item}</TooltipTrigger>
                        <TooltipContent side="right">{r.label}</TooltipContent>
                      </Tooltip>
                    )}
                  </li>
                );
              })}
            </ul>
            {layout.nav ? (
              <div className="mt-auto space-y-1 border-t px-3 pt-4">
                <p className="truncate font-semibold">{info?.name ?? "This device"}</p>
                <RoleChip className="flex" />
                {info && <p className="num text-sm text-muted-foreground">{freeMib(info.free_mem_mb)}</p>}
                <button type="button" onClick={() => layout.setAbout(true)}
                  className="-ml-1 mt-2 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                  <Info className="size-3.5" aria-hidden />About
                </button>
              </div>
            ) : (
              <div className="mt-auto flex flex-col items-center gap-4 border-t pt-4">
                <Toggle label="About distllm" side="right" onClick={() => layout.setAbout(true)}><Info /></Toggle>
                <RoleChip className="w-6 justify-center [&>span:last-child]:sr-only" />
              </div>
            )}
          </nav>

          <main ref={main} className="relative min-w-0 overflow-y-auto overflow-x-clip">
            {split && !layout.split && (
              <div className="sticky top-0 z-10 flex h-0 justify-end overflow-visible pr-4 pt-4">
                <Toggle label="Show how it's split" side="left" onClick={layout.toggleSplit} className="border bg-surface shadow-sm">
                  <PanelRightOpen />
                </Toggle>
              </div>
            )}
            {screen}
          </main>

          <aside aria-label="Split" aria-hidden={!dock} inert={!dock || undefined}
            className={cn("min-h-0 min-w-0 overflow-y-auto overflow-x-clip bg-surface", dock && "border-l")}>
            {dock && (
              <div className="px-7 pb-7 pt-10">
                <div className="mb-1 flex items-start justify-between gap-3">
                  <h2 className="font-serif text-2xl font-medium">How it's split</h2>
                  <Toggle label="Hide how it's split" side="left" onClick={layout.toggleSplit} className="-mr-2 -mt-0.5">
                    <PanelRightClose />
                  </Toggle>
                </div>
                <p className="mb-5 text-sm text-muted-foreground">Live, from the devices doing the work.</p>
                <SplitView />
              </div>
            )}
          </aside>
        </div>
        <About open={layout.about} onOpenChange={layout.setAbout} />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex items-center justify-between gap-4 pb-2 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <button type="button" onClick={() => layout.setAbout(true)} aria-label="About distllm" className="-m-2 flex min-h-11 items-center rounded-lg p-2">
            <Wordmark />
          </button>
          <div className="flex min-w-0 items-center gap-3">
            <RoleChip className="justify-end" />
            <ThemeToggle />
          </div>
        </header>

        <main ref={main} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain pl-safe-l pr-safe-r">{screen}</main>

        {/* Out of the way while typing: the keyboard already takes half the screen. */}
        <nav aria-label="Tabs" hidden={typing} className="border-t bg-surface pb-safe-b pl-safe-l pr-safe-r">
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
      <About open={layout.about} onOpenChange={layout.setAbout} />
    </TooltipProvider>
  );
}

/** True while a text field has focus (the on-screen keyboard is up on a phone). */
function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = document.activeElement;
      setTyping(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(el.type)));
    };
    const later = () => setTimeout(check, 0);           // focus has moved on by then
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return typing;
}

/** An icon button that shows or hides a panel, with its name as a tooltip. */
function Toggle({ label, side, onClick, className, children }: {
  label: string; side: "left" | "right"; onClick: () => void; className?: string; children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} onClick={onClick}
          className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[1.1rem]", className)}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

function WordmarkIcon() {
  return (
    <svg width="24" height="22" viewBox="0 0 24 22" role="img" aria-label="distllm" className="shrink-0">
      <rect x="5" y="0" width="14" height="3" rx="1.5" className="fill-signal" />
      <rect x="1.5" y="4.75" width="21" height="3" rx="1.5" className="fill-signal" />
      <rect x="0" y="9.5" width="24" height="3" rx="1.5" className="fill-foreground" />
      <rect x="1.5" y="14.25" width="21" height="3" rx="1.5" className="fill-foreground" />
      <rect x="5" y="19" width="14" height="3" rx="1.5" className="fill-foreground" />
    </svg>
  );
}
