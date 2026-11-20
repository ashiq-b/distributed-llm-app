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

export const MIN_STRANDS = 16;
export const MAX_STRANDS = 96;

export const strandCount = (weight: number) =>
  Math.round(MIN_STRANDS + Math.min(1, Math.max(0, weight)) * (MAX_STRANDS - MIN_STRANDS));

/** The canopy: an elliptical dome over a trunk that rises from the bottom centre. */
export function canopy(w: number, h: number) {
  return { cx: w / 2, cy: h * 0.7, rx: w * 0.44, ry: h * 0.46 };
}

/** Widest angle from straight up, either side, that the canopy opens to. */
const SPAN = (78 * Math.PI) / 180;

/** Each node's slice of the canopy, as [centre angle, width], 0 = straight up. */
function sectors(n: number): [number, number][] {
  if (n <= 1) return [[0, SPAN * 2]];
  const width = (2 * SPAN) / n;
  return Array.from({ length: n }, (_, i) => [-SPAN + width * (i + 0.5), width]);
}

/** Where a node's label sits: just past the rim of its slice of the canopy. */
export function anchors(n: number, w: number, h: number): Point[] {
  const c = canopy(w, h);
  return sectors(n).map(([a]) => ({
    x: Math.min(w - 8, Math.max(8, c.cx + c.rx * 1.04 * Math.sin(a))),
    y: Math.max(8, c.cy - c.ry * 1.04 * Math.cos(a)),
  }));
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
  const c = canopy(w, h);
  const slices = sectors(nodes.length);
  const trunkTop = c.cy + h * 0.06;
  const strands: Strand[] = [];
  nodes.forEach((node, i) => {
    const r = random(hash(node.id));
    const [mid, width] = slices[i];
    for (let k = 0, n = strandCount(node.weight); k < n; k++) {
      const a = mid + (r() - 0.5) * width * 0.96;
      const reach = 0.55 + Math.sqrt(r()) * 0.45;          // most tips near the rim
      const end = {
        x: Math.min(w - 2, Math.max(2, c.cx + c.rx * reach * Math.sin(a))),
        y: Math.max(2, c.cy - c.ry * reach * Math.cos(a)),
      };
      const lift = 0.35 + r() * 0.35;                       // how high the fibre stays in the trunk
      strands.push({
        node: i,
        p0: { x: c.cx + (r() - 0.5) * w * 0.05, y: h + 2 },
        p1: { x: c.cx + (r() - 0.5) * w * 0.03, y: trunkTop - (trunkTop - end.y) * lift * 0.5 },
        p2: { x: c.cx + (end.x - c.cx) * (0.35 + r() * 0.3), y: end.y + (trunkTop - end.y) * (0.25 + r() * 0.25) },
        p3: end,
        tone: 0.2 + r() * 0.8,
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
