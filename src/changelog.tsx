import { render } from "solid-js/web";
import "@fontsource-variable/outfit";
import "@fontsource/newsreader/300.css";
import "@fontsource/newsreader/400.css";
import "./index.css";
import Changelog from "./pages/Changelog";
import { initializeTheme } from "@/stores/ui";

initializeTheme();

render(() => <Changelog />, document.getElementById("root") as HTMLElement);
