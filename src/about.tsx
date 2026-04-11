import { render } from "solid-js/web";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "./index.css";
import About from "./pages/About";

document.documentElement.setAttribute("data-theme", "light");

render(() => <About />, document.getElementById("root") as HTMLElement);
