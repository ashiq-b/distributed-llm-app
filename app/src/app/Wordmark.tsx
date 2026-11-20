/** A lens of level bands, the top ones in the accent: one model's layers, split across devices. */
export default function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="24" height="22" viewBox="0 0 24 22" aria-hidden className="shrink-0">
        <rect x="5" y="0" width="14" height="3" rx="1.5" className="fill-signal" />
        <rect x="1.5" y="4.75" width="21" height="3" rx="1.5" className="fill-signal" />
        <rect x="0" y="9.5" width="24" height="3" rx="1.5" className="fill-foreground" />
        <rect x="1.5" y="14.25" width="21" height="3" rx="1.5" className="fill-foreground" />
        <rect x="5" y="19" width="14" height="3" rx="1.5" className="fill-foreground" />
      </svg>
      <span className="text-[1.0625rem] font-semibold tracking-tight">distllm</span>
    </span>
  );
}
