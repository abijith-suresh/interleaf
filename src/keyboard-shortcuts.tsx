import { render } from "solid-js/web";
import "@fontsource-variable/outfit";
import "@fontsource/newsreader/300.css";
import "@fontsource/newsreader/400.css";
import "./index.css";
import KeyboardShortcuts from "./pages/KeyboardShortcuts";
import { initializeTheme } from "@/stores/ui";

initializeTheme();

render(
  () => <KeyboardShortcuts />,
  document.getElementById("root") as HTMLElement,
);
