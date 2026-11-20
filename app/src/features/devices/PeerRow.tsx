// One device on the network: what it announced, and whether it can hold layers for us.
// A device that can't is shown greyed with the reason, never silently left out.
import { HelpCircle, Laptop, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { DeviceInfo, PeerView } from "@/lib/tauri";
import { UNKNOWN } from "@/lib/format";
import { cn } from "@/lib/utils";

const PLATFORM: Record<string, string> = { ios: "iOS", android: "Android", macos: "macOS", windows: "Windows", linux: "Linux" };

/** Why this device can't be picked as a worker, or null if it can. */
export function unavailable(p: PeerView, local: DeviceInfo | null): string | null {
  switch (p.compat) {
    case "proto_mismatch":
      return `Different engine (${p.proto ?? UNKNOWN}; this device has ${local?.proto ?? UNKNOWN}). Install the same app version on both.`;
    case "app_version_mismatch":
      return `Different app version (${p.app_ver ?? UNKNOWN}; this device has ${local?.app_ver ?? UNKNOWN}). Install the same version on both.`;
  }
  if (p.role === "host") return "Hosting its own model, so it can't hold layers for this one.";
  if (p.role === "idle") return "Not a worker yet. Tap Start worker on that device.";
  return null;
}

export function PlatformIcon({ platform, className }: { platform: string | null; className?: string }) {
  const Icon = platform === "ios" || platform === "android" ? Smartphone : platform ? Laptop : HelpCircle;
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted", className)}>
      <Icon className="size-5" strokeWidth={1.6} aria-label={platform ? PLATFORM[platform] ?? platform : `platform ${UNKNOWN}`} />
    </span>
  );
}

export default function PeerRow({
  peer: p, local, chosen, onChoose,
}: { peer: PeerView; local: DeviceInfo | null; chosen: boolean; onChoose: (on: boolean) => void }) {
  const reason = unavailable(p, local);
  const role = p.role === "worker" ? "Worker" : p.role === "host" ? "Host" : p.role === "idle" ? "Idle" : `Role ${UNKNOWN}`;
  const memory = p.free_mem_mb == null ? `Free memory ${UNKNOWN}` : `${p.free_mem_mb.toLocaleString()} MiB free`;
  return (
    <li className="flex items-start gap-3.5 border-b py-3.5" aria-disabled={reason ? true : undefined}>
      <PlatformIcon platform={p.platform} className={cn(reason && "opacity-50")} />
      <div className={cn("min-w-0 flex-1", reason && "text-muted-foreground")}>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
          <span className="min-w-0 truncate">{p.name}</span>
          {p.source === "manual" && <Badge variant="outline" className="shrink-0 font-normal">Added by address</Badge>}
          {p.compat === "unknown" && <Badge variant="outline" className="shrink-0 font-normal">Version unknown</Badge>}
        </p>
        <p className="num text-sm text-muted-foreground">
          {p.platform ? PLATFORM[p.platform] ?? p.platform : `Platform ${UNKNOWN}`}, {role}, {memory}
        </p>
        <p className="num truncate text-xs text-muted-foreground">{p.addr}:{p.rpc_port}</p>
        {reason && <p className="mt-1.5 text-pretty text-sm text-foreground/80">{reason}</p>}
      </div>
      <Switch label={`Use ${p.name} as a worker`} checked={chosen && !reason} disabled={!!reason} onChange={onChoose} className="mt-0.5" />
    </li>
  );
}
