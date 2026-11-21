import { describe, expect, it } from "vitest";
import { applyInsets, initInsets, keyboardHeight } from "./insets";

describe("insets", () => {
  it("sets the four sides in CSS pixels", () => {
    const el = document.createElement("div");
    applyInsets("24,0,48,0", el);
    expect(el.style.getPropertyValue("--inset-top")).toBe("24px");
    expect(el.style.getPropertyValue("--inset-bottom")).toBe("48px");
    expect(el.style.getPropertyValue("--inset-left")).toBe("0px");
  });

  it("ignores anything malformed", () => {
    const el = document.createElement("div");
    applyInsets("24,0,48", el);
    applyInsets("a,b,c,d", el);
    applyInsets("-1,0,0,0", el);
    expect(el.style.getPropertyValue("--inset-top")).toBe("");
  });

  it("reads the Android app's insets at startup and takes later changes", () => {
    window.DistllmInsets = { get: () => "30,0,20,0" };
    initInsets();
    expect(document.documentElement.style.getPropertyValue("--inset-top")).toBe("30px");
    window.__distllmInsets?.("30,0,20,0,310"); // keyboard open
    expect(document.documentElement.style.getPropertyValue("--inset-bottom")).toBe("20px");
    expect(document.documentElement.style.getPropertyValue("--inset-keyboard")).toBe("310px");
    expect(keyboardHeight()).toBe(310);
    delete window.DistllmInsets;
  });
});
