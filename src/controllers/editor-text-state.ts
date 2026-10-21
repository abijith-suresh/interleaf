import type { AddedText } from "../types/interfaces";

export function copyAddedTexts(texts: readonly AddedText[] | undefined): AddedText[] | undefined {
  return texts?.map((text) => ({
    id: text.id,
    text: text.text,
    x: text.x,
    y: text.y,
    fontSize: text.fontSize,
    rotation: text.rotation,
  }));
}

export function equalAddedTexts(
  left: readonly AddedText[] = [],
  right: readonly AddedText[] = []
): boolean {
  return (
    left.length === right.length &&
    left.every((text, index) => {
      const next = right[index];
      return (
        text.id === next.id &&
        text.text === next.text &&
        text.x === next.x &&
        text.y === next.y &&
        text.fontSize === next.fontSize &&
        text.rotation === next.rotation
      );
    })
  );
}
