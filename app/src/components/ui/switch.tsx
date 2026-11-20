// A two-state switch as a real button (role="switch"), 44 px tall to tap.
import { cn } from "@/lib/utils";

export function Switch({
  checked, onChange, disabled, label, className,
}: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("group flex h-11 w-14 shrink-0 items-center justify-end disabled:cursor-not-allowed disabled:opacity-40", className)}
    >
      <span className={cn("relative h-[30px] w-[50px] rounded-full transition-colors", checked ? "bg-signal" : "bg-foreground/20")}>
        <span className={cn("absolute top-[3px] size-6 rounded-full bg-surface shadow-sm transition-transform duration-200",
          checked ? "translate-x-[23px]" : "translate-x-[3px]")} />
      </span>
    </button>
  );
}
