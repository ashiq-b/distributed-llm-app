// A two-state switch as a real button (role="switch"), 44 px tall to tap.
// The thumb is pinned with left/top so the button's centred text can't move it.
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
      className={cn(
        "group flex h-11 w-[60px] shrink-0 touch-manipulation select-none items-center justify-end text-left",
        "disabled:cursor-not-allowed disabled:opacity-40 [-webkit-tap-highlight-color:transparent]",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative block h-[31px] w-[51px] shrink-0 rounded-full border transition-colors duration-200",
          checked ? "border-signal bg-signal" : "border-foreground/15 bg-foreground/10",
        )}
      >
        <span
          className={cn(
            "absolute left-[2px] top-[2px] block size-[25px] rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-out",
            "group-active:scale-95",
            checked ? "translate-x-[20px] bg-white" : "translate-x-0 bg-raised",
          )}
        />
      </span>
    </button>
  );
}
