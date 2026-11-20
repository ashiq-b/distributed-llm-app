import { MAX_STRANDS, MIN_STRANDS, anchors, layoutStrands, strandCount } from "./geometry";

test("strands follow each node's real weight", () => {
  expect(strandCount(0)).toBe(MIN_STRANDS);
  expect(strandCount(1)).toBe(MAX_STRANDS);
  const strands = layoutStrands(
    [{ id: "mac", label: "Mac", weight: 1 }, { id: "iphone", label: "iPhone", weight: 0 }],
    390, 300,
  );
  expect(strands.filter((s) => s.node === 0)).toHaveLength(MAX_STRANDS);
  expect(strands.filter((s) => s.node === 1)).toHaveLength(MIN_STRANDS);
});

test("the same devices always draw the same mesh", () => {
  const nodes = [{ id: "a", label: "A", weight: 0.5 }];
  expect(layoutStrands(nodes, 300, 200)).toEqual(layoutStrands(nodes, 300, 200));
});

test("node anchors stay inside the view", () => {
  for (const n of [1, 2, 3, 6]) {
    for (const p of anchors(n, 375, 260)) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(375);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(260);
    }
  }
});

test("every strand ends inside the view", () => {
  const nodes = ["a", "b", "c", "d"].map((id, i) => ({ id, label: id, weight: i / 3 }));
  for (const s of layoutStrands(nodes, 375, 240)) {
    expect(s.p3.x).toBeGreaterThanOrEqual(0);
    expect(s.p3.x).toBeLessThanOrEqual(375);
    expect(s.p3.y).toBeGreaterThanOrEqual(0);
    expect(s.p3.y).toBeLessThanOrEqual(240);
  }
});
