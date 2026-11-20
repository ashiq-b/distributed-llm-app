import { emitPulse, onPulse, type Pulse } from "./pulse";

test("pulses reach listeners until they stop listening", () => {
  const got: Pulse[] = [];
  const stop = onPulse((p) => got.push(p));
  emitPulse({ kind: "token" });
  stop();
  emitPulse({ kind: "token" });
  expect(got).toEqual([{ kind: "token" }]);
});
