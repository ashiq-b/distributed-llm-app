import { fit, splitAdvice } from "./fit";

// The cases from roles.rs `guard_refuses_when_memory_insufficient`, so the two stay one rule.
test("fit matches the load guard", () => {
  expect(fit(1300, [{ name: "iPhone", free: 4095 }]).ok).toBe(true);
  expect(fit(1600, [{ name: "iPhone", free: 1200 }]).reason).toBe("not enough memory: need 1600 MB, have 1200 MB");
  expect(fit(1600, [{ name: "iPhone", free: 1200 }, { name: "Mac", free: 600 }]).ok).toBe(true);
  expect(fit(1600, [{ name: "a", free: 800 }, { name: "b", free: 500 }, { name: "c", free: 200 }]).reason)
    .toBe("not enough memory: need 1600 MB, have 1500 MB");
});

test("unknown free memory counts as 0", () => {
  const f = fit(1300, [{ name: "iPhone", free: null }, { name: "Mac", free: 1000 }]);
  expect(f.have).toBe(1000);
  expect(f.ok).toBe(false);
});

test("split advice: slower when it fits alone, needed when it doesn't", () => {
  const iphone = { name: "iPhone", free: 4095, self: true };
  const mac = { name: "Mac", free: 12123 };
  expect(splitAdvice(1300, [iphone])).toBeNull();
  expect(splitAdvice(1300, [iphone, mac])).toEqual({ kind: "fits_alone", free: 4095, need: 1300, workers: 1 });
  expect(splitAdvice(8000, [iphone, mac])?.kind).toBe("needs_split");
  expect(splitAdvice(1300, [{ ...iphone, free: null }, mac])).toBeNull();
});
