import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import EditorIcon, { type EditorIconName } from "./EditorIcon";

type Props = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: EditorIconName;
  variant?: "secondary" | "plain" | "primary" | "danger";
};

export default function EditorButton(props: Props) {
  const [local, rest] = splitProps(props, [
    "icon",
    "variant",
    "class",
    "classList",
    "children",
    "type",
  ]);
  return (
    <button
      {...rest}
      type={local.type ?? "button"}
      class={`editor-button editor-button-${local.variant ?? "secondary"}${local.class ? ` ${local.class}` : ""}`}
      classList={local.classList}
    >
      <Show when={local.icon}>{(icon) => <EditorIcon name={icon()} />}</Show>
      {local.children}
    </button>
  );
}
