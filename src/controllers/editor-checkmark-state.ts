import type { AddedCheckmark } from "../types/interfaces";

export function copyAddedCheckmarks(
  marks: readonly AddedCheckmark[] | undefined
): AddedCheckmark[] | undefined {
  return marks?.map(({ id, x, y, size, rotation }) => ({ id, x, y, size, rotation }));
}

export function equalAddedCheckmarks(
  left: readonly AddedCheckmark[] = [],
  right: readonly AddedCheckmark[] = []
): boolean {
  return (
    left.length === right.length &&
    left.every((mark, index) => {
      const next = right[index];
      return (
        mark.id === next.id &&
        mark.x === next.x &&
        mark.y === next.y &&
        mark.size === next.size &&
        mark.rotation === next.rotation
      );
    })
  );
}
