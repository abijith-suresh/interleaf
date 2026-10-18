import ArrowLeft from "lucide-solid/icons/arrow-left";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Download from "lucide-solid/icons/download";
import FileStack from "lucide-solid/icons/file-stack";
import FileText from "lucide-solid/icons/file-text";
import Maximize from "lucide-solid/icons/maximize";
import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import RotateCw from "lucide-solid/icons/rotate-cw";
import SquarePen from "lucide-solid/icons/square-pen";
import Trash from "lucide-solid/icons/trash";
import X from "lucide-solid/icons/x";
import { Dynamic } from "solid-js/web";

const editorIcons = {
  back: ArrowLeft,
  "chevron-down": ChevronDown,
  previous: ChevronLeft,
  next: ChevronRight,
  open: Download,
  document: FileText,
  files: FileStack,
  review: Maximize,
  plus: Plus,
  minus: Minus,
  restore: RotateCcw,
  rotate: RotateCw,
  "page-actions": SquarePen,
  delete: Trash,
  close: X,
};
export type EditorIconName = keyof typeof editorIcons;

export default function EditorIcon(props: { name: EditorIconName }) {
  return (
    <Dynamic
      component={editorIcons[props.name]}
      class="editor-icon"
      size={18}
      strokeWidth={1.75}
      aria-hidden="true"
    />
  );
}
