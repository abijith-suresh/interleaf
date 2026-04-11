import { render } from "solid-js/web";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "./index.css";
import Features from "./pages/Features";

document.documentElement.setAttribute("data-theme", "light");

render(() => <Features />, document.getElementById("root") as HTMLElement);
