import { X } from "lucide-react";
import { useNotice } from "@/lib/stores";

/** The last error, in plain words, until dismissed. */
export default function Notice() {
  const { error, clear } = useNotice();
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <p className="min-w-0 flex-1 break-words">{error}</p>
      <button onClick={clear} aria-label="Dismiss" className="-m-2 rounded-md p-2 hover:bg-destructive/10">
        <X className="size-4" />
      </button>
    </div>
  );
}
