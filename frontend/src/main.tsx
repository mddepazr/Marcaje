import React from "react";
import ReactDOM from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./index.css";
import { Theme } from "@astryxdesign/core/theme";
import { themes, defaultThemeSlug } from "./astryx-themes";
import { ThemeModeProvider, useThemeMode } from "./context/ThemeContext";
import App from "./App";

function RootWithTheme() {
  const { themeMode } = useThemeMode();
  return (
    <Theme theme={themes[defaultThemeSlug]} mode={themeMode}>
      <App />
    </Theme>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <RootWithTheme />
    </ThemeModeProvider>
  </React.StrictMode>
);
