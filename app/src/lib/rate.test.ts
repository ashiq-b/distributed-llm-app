import { addToken, tokensPerSecond } from "./rate";

test("speed is measured from real token arrival times only", () => {
  expect(tokensPerSecond(null)).toBeNull();
  let live = addToken(null, 1000);
  expect(tokensPerSecond(live)).toBeNull(); // one token says nothing about speed
  for (let i = 1; i <= 10; i++) live = addToken(live, 1000 + i * 100);
  expect(live.tokens).toBe(11);
  expect(tokensPerSecond(live)).toBeCloseTo(10);
});
