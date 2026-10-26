import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import EditorIcon, { type EditorIconName } from "./EditorIcon";

export type EditorButtonVariant = "plain" | "secondary" | "primary" | "danger";
type Props = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: EditorButtonVariant;
  icon?: EditorIconName;
  iconOnly?: boolean;
};

export default function EditorButton(props: Props) {
  const [local, rest] = splitProps(props, [
    "variant",
    "icon",
    "iconOnly",
    "class",
    "children",
    "type",
  ]);
  return (
    <button
      {...rest}
      type={local.type ?? "button"}
      class={`editor-button editor-button-${local.variant ?? "secondary"}${local.iconOnly ? " editor-button-icon" : ""}${local.class ? ` ${local.class}` : ""}`}
    >
      <Show when={local.icon}>{(icon) => <EditorIcon name={icon()} />}</Show>
      {local.children}
    </button>
  );
}
