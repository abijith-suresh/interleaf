import { expect, type Page } from "@playwright/test";
import { expectDocumentReady } from "./editor";
import { revealDocumentTools } from "./toolbar";

export async function expectTypedAdditionSize(page: Page, kind: "text" | "checkmark") {
  await revealDocumentTools(page);
  await page
    .getByRole("button", { name: kind === "text" ? "Add text" : "Checkmark", exact: true })
    .click();
  await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
  const box = await page.locator(".editor-review-page").boundingBox();
  if (!box) throw new Error("Missing page");
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.55);
  if (kind === "text") await page.getByLabel("Added text", { exact: true }).fill("Size");
  const size = page.getByLabel(
    kind === "text" ? "Text size in points" : "Checkmark size in points"
  );
  const draft = page.getByRole("button", { name: `Drag ${kind} to move it` });
  const defaultSize = await draft.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize)
  );
  const save = page.getByRole("button", { name: `Save ${kind}`, exact: true });
  const hit = page.getByRole("button", {
    name: kind === "text" ? "Edit added text: Size" : "Edit added checkmark",
    exact: true,
  });
  // Real keystrokes expose intermediate values that fill() skips.
  await size.click();
  await size.press("ControlOrMeta+a");
  await size.pressSequentially("32");
  await expect(size).toHaveValue("32");
  await size.press("ControlOrMeta+a");
  await size.pressSequentially("3e1");
  await expect(size).toHaveValue("3e1");
  await size.press("ControlOrMeta+a");
  await size.pressSequentially("32");
  await save.click();
  await expect(hit).toBeVisible();
  await expectDocumentReady(page);
  expect(
    await hit.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
  ).toBeGreaterThan(defaultSize);
  await hit.click();
  await size.press("ControlOrMeta+a");
  await size.press("Backspace");
  await expect(size).toHaveValue("");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("position and size must be finite numbers");
  await expect(size).toHaveValue("");
  await size.pressSequentially("4");
  await expect(size).toHaveValue("4");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("Choose a size from");
  await expect(size).toHaveValue("4");
  await size.pressSequentially("0");
  await expect(size).toHaveValue("40");
  await size.press("ArrowUp");
  await expect(size).toHaveValue("41");
  await size.press("ArrowDown");
  await expect(size).toHaveValue("40");
  await save.click();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(size).toHaveValue("40");
  await size.press("Escape");
  await page.getByTestId("editor-undo-button").click();
  await hit.click();
  await expect(size).toHaveValue("32");
  await size.press("Escape");
  await page.getByTestId("editor-redo-button").click();
  await hit.click();
  await expect(size).toHaveValue("40");
}
