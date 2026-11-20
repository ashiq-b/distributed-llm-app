import React from "react";
import ReactDOM from "react-dom/client";
import Crashed from "./app/Crashed";
import Shell from "./app/Shell";
import { initTheme } from "./app/theme";
import { connectStores } from "./lib/stores";
import "./app/theme.css";

initTheme();
connectStores();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Crashed>
      <Shell />
    </Crashed>
  </React.StrictMode>,
);
