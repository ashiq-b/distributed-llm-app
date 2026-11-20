// Add a device by address when discovery can't see it (some routers block multicast).
// The app checks the address accepts connections before listing it.
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addManualPeer } from "@/lib/tauri";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function AddPeerDialog() {
  const [open, setOpen] = useState(false);
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await addManualPeer(addr.trim());
      setAddr("");
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Plus aria-hidden />Add by address</Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] rounded-2xl bg-surface">
        <DialogHeader className="text-left">
          <DialogTitle className="font-serif text-2xl font-medium">Add a device</DialogTitle>
          <DialogDescription>
            For a device on this Wi‑Fi that isn't listed. Find its address on that device, under This device.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <label htmlFor="addr" className="text-sm font-medium">Address</label>
          <Input id="addr" className="h-11 rounded-[10px] bg-raised text-base desk:h-10"
            placeholder="192.168.1.4 or 192.168.1.4:50052" inputMode="decimal" autoComplete="off" autoCapitalize="off"
            aria-invalid={error ? true : undefined} aria-describedby={error ? "addr-error" : undefined}
            value={addr} onChange={(e) => setAddr(e.target.value)} />
          {error && <p id="addr-error" role="alert" className="text-pretty text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !addr.trim()}>
            {busy ? "Checking the address…" : "Add device"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
