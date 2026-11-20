// Where the mesh's strands run. Pure functions, so layout is testable without a canvas.

export interface MeshNode {
  id: string;
  label: string;
  /** Second line under the label (free memory, layers…). */
  detail?: string;
  /** 0..1, relative to the other nodes: more strands for more memory or more layers. */
  weight: number;
  /** This device: drawn in the accent colour. */
  self?: boolean;
}

export interface Point { x: number; y: number }

export interface Strand {
  node: number;
  p0: Point; p1: Point; p2: Point; p3: Point;
  /** 0..1: how bright this strand is drawn at rest. */
  tone: number;
}

export const MIN_STRANDS = 8;
export const MAX_STRANDS = 40;

export const strandCount = (weight: number) =>
  Math.round(MIN_STRANDS + Math.min(1, Math.max(0, weight)) * (MAX_STRANDS - MIN_STRANDS));

/** Node anchors on a shallow arc: middle ones highest, outer ones lower, like a canopy. */
export function anchors(n: number, w: number, h: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const spread = n === 1 ? 0 : Math.min(0.76, 0.3 + n * 0.12);
    return {
      x: w * (0.5 + (u - 0.5) * spread),
      y: h * 0.34 + Math.abs(u - 0.5) * 2 * h * 0.2,
    };
  });
}

/** Seeded so a node's strands keep their shape across renders. */
function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function layoutStrands(nodes: MeshNode[], w: number, h: number): Strand[] {
  const tops = anchors(nodes.length, w, h);
  const base: Point = { x: w / 2, y: h + 4 };
  // Each node's strands open into a canopy under it: wide when few nodes share the view.
  const fan = Math.min(w * 0.9, w * (0.62 / Math.max(1, nodes.length) + 0.12));
  const strands: Strand[] = [];
  nodes.forEach((node, i) => {
    const r = random(hash(node.id));
    const top = tops[i];
    for (let k = 0, n = strandCount(node.weight); k < n; k++) {
      const off = (r() - 0.5) * fan;
      const reach = Math.abs(off) / (fan / 2);           // 0 under the node, 1 at the canopy's edge
      const end = {
        x: Math.min(w - 4, Math.max(4, top.x + off)),
        y: top.y + 14 + reach * reach * h * 0.22 + r() * h * 0.05,
      };
      strands.push({
        node: i,
        p0: { x: base.x + (r() - 0.5) * w * 0.035, y: base.y },
        p1: { x: base.x + (r() - 0.5) * w * 0.05, y: h * (0.5 + r() * 0.15) },
        p2: { x: end.x - off * (0.25 + r() * 0.3), y: end.y + (h - end.y) * (0.12 + r() * 0.2) },
        p3: end,
        tone: 0.25 + r() * 0.75,
      });
    }
  });
  return strands;
}

export function at(s: Strand, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y,
  };
}
