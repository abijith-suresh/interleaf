import { render } from "solid-js/web";
import "@fontsource-variable/outfit";
import "@fontsource/newsreader/300.css";
import "@fontsource/newsreader/400.css";
import "./index.css";
import Features from "./pages/Features";
import { initializeTheme } from "@/stores/ui";

initializeTheme();

render(() => <Features />, document.getElementById("root") as HTMLElement);
