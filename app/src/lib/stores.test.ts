import { useChat, useDevice, useModels, useNotice, usePeers, useRole } from "./stores";

test("stores start empty (no seeded devices/models)", () => {
  expect(useDevice.getState().info).toBeNull();
  expect(useRole.getState().role).toBeNull();
  expect(usePeers.getState().peers).toEqual([]);
  expect(usePeers.getState().chosen).toEqual([]);
  expect(useModels.getState().models).toEqual([]);
  expect(useModels.getState().progress).toEqual({});
  expect(useChat.getState().history).toEqual([]);
  expect(useChat.getState().streaming).toBe("");
  expect(useChat.getState().summary).toBeNull();
  expect(useNotice.getState().error).toBeNull();
});
