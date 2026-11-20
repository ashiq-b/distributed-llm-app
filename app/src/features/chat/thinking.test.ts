import { splitThinking } from "./thinking";

test("reasoning and answer are told apart as they stream", () => {
  expect(splitThinking("Paris.")).toEqual({ thinking: null, answer: "Paris.", stillThinking: false });
  expect(splitThinking("<think>\nThe user asks")).toEqual({ thinking: "The user asks", answer: "", stillThinking: true });
  expect(splitThinking("<think>\nEasy.\n</think>\n\nParis.")).toEqual({ thinking: "Easy.", answer: "Paris.", stillThinking: false });
});
