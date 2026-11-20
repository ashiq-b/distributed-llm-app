import { cn } from "@/lib/utils";
import { useRole } from "@/lib/stores";
import type { RoleState } from "@/lib/tauri";

export function roleLabel(role: RoleState | null): string {
  switch (role?.role) {
    case undefined: return "Starting…";
    case "idle": return "Idle";
    case "worker": return `Worker on port ${role.status.endpoint.split(":").pop()}`;
    case "loading": return `Loading ${Math.round(role.frac * 100)}%`;
    case "host": return "Hosting";
  }
}

/** What this device is doing, as a dot and a few words. */
export default function RoleChip({ className }: { className?: string }) {
  const role = useRole((s) => s.role);
  const active = role?.role === "host" || role?.role === "loading" || role?.role === "worker";
  return (
    <span className={cn("num inline-flex min-w-0 items-center gap-2 text-sm", active ? "font-medium text-signal" : "text-muted-foreground", className)}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", active ? "bg-signal" : "bg-muted-foreground/60",
        role?.role === "loading" && "motion-safe:animate-pulse")} />
      <span className="truncate">{roleLabel(role)}</span>
    </span>
  );
}
