// This device plus the workers picked in Devices: the devices a load here would use.
import { useShallow } from "zustand/react/shallow";
import { chosenPeers, useDevice, usePeers } from "@/lib/stores";
import type { Share } from "./fit";

export function useShares(): { shares: Share[]; workers: string[] } {
  const info = useDevice((s) => s.info);
  const peers = usePeers((s) => s.peers);
  const workers = usePeers(useShallow(chosenPeers));
  const shares: Share[] = [
    { name: info?.name ?? "This device", free: info?.free_mem_mb ?? null, self: true },
    ...peers.filter((p) => workers.includes(p.id)).map((p) => ({ name: p.name, free: p.free_mem_mb })),
  ];
  return { shares, workers };
}
