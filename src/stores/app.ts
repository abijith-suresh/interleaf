import { createSignal } from "solid-js";

const [theme, setTheme] = createSignal<"light" | "dark">("light");

export function useTheme() {
  return [theme, setTheme] as const;
}
