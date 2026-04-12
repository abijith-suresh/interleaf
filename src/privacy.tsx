import { render } from "solid-js/web";
import "@fontsource-variable/outfit";
import "@fontsource/newsreader/300.css";
import "@fontsource/newsreader/400.css";
import "./index.css";
import Privacy from "./pages/Privacy";
import { initializeTheme } from "@/stores/ui";

initializeTheme();

render(() => <Privacy />, document.getElementById("root") as HTMLElement);
