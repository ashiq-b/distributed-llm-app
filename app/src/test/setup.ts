import "@testing-library/jest-dom/vitest";

// jsdom has no layout: report a window width that tests can set with setWidth().
let width = 390;
export function setWidth(px: number) {
  width = px;
  window.dispatchEvent(new Event("resize"));
}

function matches(query: string) {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => {
    const handlers = new Set<() => void>();
    const mql = {
      get matches() { return matches(query); },
      media: query,
      onchange: null,
      addEventListener: (_: string, h: () => void) => { handlers.add(h); window.addEventListener("resize", h); },
      removeEventListener: (_: string, h: () => void) => { handlers.delete(h); window.removeEventListener("resize", h); },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
    return mql;
  },
});
