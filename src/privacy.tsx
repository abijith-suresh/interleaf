import { render } from "solid-js/web";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "./index.css";
import Privacy from "./pages/Privacy";

document.documentElement.setAttribute("data-theme", "light");

render(() => <Privacy />, document.getElementById("root") as HTMLElement);
