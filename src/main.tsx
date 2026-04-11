import { render } from "solid-js/web";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "./index.css";
import App from "./App";

document.documentElement.setAttribute("data-theme", "light");

render(
  () => <App />,
  document.getElementById("root") as HTMLElement
);
