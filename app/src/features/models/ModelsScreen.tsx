// The models this app can run: download once on each device, then load from here or Chat.
import { useModels, useRole } from "@/lib/stores";
import ModelCard from "./ModelCard";
import { useShares } from "./useShares";

export default function ModelsScreen() {
  const models = useModels((s) => s.models);
  const role = useRole((s) => s.role);
  const { shares, workers } = useShares();
  const onDevice = models.filter((m) => m.status.state === "ready").length;

  return (
    <div>
      <h1 className="font-serif text-4xl font-medium tracking-tight">Models</h1>
      <p className="mt-1 text-pretty text-sm text-muted-foreground">
        {models.length ? `${onDevice} of ${models.length} on this device. ` : ""}
        Download a model once on each device. Workers serve layers from their own copy, so loading sends almost nothing over Wi‑Fi.
      </p>
      {models.length === 0 ? (
        <p className="mt-5 text-muted-foreground">Reading the model list…</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {models.map((m) => <ModelCard key={m.id} m={m} role={role} shares={shares} workers={workers} />)}
        </ul>
      )}
    </div>
  );
}
