// Light or dark follows the system setting, live. The tokens in theme.css key off
// data-theme on <html>, so a manual choice can be added later without touching components.
export function followSystemTheme(): () => void {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.dataset.theme = mql.matches ? "dark" : "light";
  };
  apply();
  mql.addEventListener("change", apply);
  return () => mql.removeEventListener("change", apply);
}
