import React from "react";
import ReactDOM from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./index.css";
import { Theme } from "@astryxdesign/core/theme";
import { themes, defaultThemeSlug } from "./astryx-themes";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Theme theme={themes[defaultThemeSlug]} mode="dark">
      <App />
    </Theme>
  </React.StrictMode>
);
