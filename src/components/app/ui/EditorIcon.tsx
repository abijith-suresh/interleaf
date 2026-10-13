import { default as ArrowLeft } from "lucide-solid/icons/arrow-left";
import { default as ChevronDown } from "lucide-solid/icons/chevron-down";
import { default as ChevronLeft } from "lucide-solid/icons/chevron-left";
import { default as ChevronRight } from "lucide-solid/icons/chevron-right";
import { default as Copy } from "lucide-solid/icons/copy";
import { default as FileStack } from "lucide-solid/icons/file-stack";
import { default as FileText } from "lucide-solid/icons/file-text";
import { default as LayoutGrid } from "lucide-solid/icons/layout-grid";
import { default as ListChecks } from "lucide-solid/icons/list-checks";
import { default as Minus } from "lucide-solid/icons/minus";
import { default as Move } from "lucide-solid/icons/move";
import { default as Plus } from "lucide-solid/icons/plus";
import { default as RotateCw } from "lucide-solid/icons/rotate-cw";
import { default as SlidersHorizontal } from "lucide-solid/icons/sliders-horizontal";
import { default as SquareCheck } from "lucide-solid/icons/square-check";
import { default as SquarePen } from "lucide-solid/icons/square-pen";
import { default as Trash } from "lucide-solid/icons/trash";
import { default as TypeOutline } from "lucide-solid/icons/type-outline";
import { default as Undo2 } from "lucide-solid/icons/undo-2";
import { default as X } from "lucide-solid/icons/x";
import type { JSX } from "solid-js";
import { splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";

const editorIcons = {
  pages: LayoutGrid,
  document: FileText,
  add: TypeOutline,
  edit: SquarePen,
  forms: ListChecks,
  tools: SlidersHorizontal,
  close: X,
  plus: Plus,
  minus: Minus,
  previous: ChevronLeft,
  next: ChevronRight,
  "chevron-down": ChevronDown,
  rotate: RotateCw,
  copy: Copy,
  delete: Trash,
  restore: Undo2,
  files: FileStack,
  back: ArrowLeft,
  select: SquareCheck,
  move: Move,
};
export type EditorIconName = keyof typeof editorIcons;

type Props = Omit<JSX.SvgSVGAttributes<SVGSVGElement>, "name"> & {
  name: EditorIconName;
  size?: number;
};

export default function EditorIcon(props: Props) {
  const [local, rest] = splitProps(props, ["name", "size", "class"]);
  return (
    <Dynamic
      component={editorIcons[local.name]}
      {...rest}
      class={`editor-icon ${local.class ?? ""}`}
      size={local.size ?? 18}
      strokeWidth={1.75}
      aria-hidden="true"
    />
  );
}
