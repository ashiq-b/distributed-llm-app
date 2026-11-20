import { cn } from "@/lib/utils";
import { useRole } from "@/lib/stores";
import type { RoleState } from "@/lib/tauri";

export function roleLabel(role: RoleState | null): string {
  switch (role?.role) {
    case undefined: return "Starting…";
    case "idle": return "Idle";
    case "worker": return `Worker on port ${role.status.endpoint.split(":").pop()}`;
    case "loading": return `Loading ${Math.round(role.frac * 100)}%`;
    case "host": return `Hosting ${role.model_id}`;
  }
}

/** What this device is doing, as a dot and a few words. */
export default function RoleChip({ className }: { className?: string }) {
  const role = useRole((s) => s.role);
  const dot =
    role?.role === "host" || role?.role === "loading" ? "bg-signal"
    : role?.role === "worker" ? "bg-ok"
    : "bg-muted-foreground/50";
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground", className)}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
      <span className="truncate">{roleLabel(role)}</span>
    </span>
  );
}
