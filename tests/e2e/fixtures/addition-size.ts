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

export async function expectMouseAdditionSize(page: Page, kind: "text" | "checkmark") {
  await page.setViewportSize({ width: 1280, height: 800 });
  await revealDocumentTools(page);
  await page
    .getByRole("button", { name: kind === "text" ? "Add text" : "Checkmark", exact: true })
    .click();
  await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
  const box = await page.locator(".editor-review-page").boundingBox();
  if (!box) throw new Error("Missing page");
  const place = () => page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.55);
  const text = page.getByLabel("Added text", { exact: true });
  const sizeInput = page.getByLabel(
    kind === "text" ? "Text size in points" : "Checkmark size in points"
  );
  const save = page.getByRole("button", { name: `Save ${kind}`, exact: true });
  const hit = page.getByRole("button", {
    name: kind === "text" ? "Edit added text: Size" : "Edit added checkmark",
    exact: true,
  });
  await place();
  if (kind === "text") {
    await expect(text).toBeFocused();
    await page.keyboard.type("Size");
  } else await expect(sizeInput).toBeFocused();
  await save.click();
  await expect(hit).toBeVisible();
  await expectDocumentReady(page);
  const defaultBox = await hit.boundingBox();
  if (!defaultBox) throw new Error("Missing default addition");

  // Cover both a newly placed draft and an edit of a saved addition.
  for (const saved of [false, true]) {
    if (saved) await hit.last().click();
    else {
      await page
        .getByRole("button", { name: kind === "text" ? "Add text" : "Checkmark", exact: true })
        .click();
      await place();
    }
    if (kind === "text" && !saved) await page.keyboard.type("Size");
    await sizeInput.click({ clickCount: 3 });
    await page.keyboard.type("32");
    await expect(sizeInput).toHaveValue("32");
    await expect(sizeInput).toBeFocused();
    if (kind === "text") {
      await text.click();
      await expect(text).toBeFocused();
    }
    const rotate = page.getByRole("button", { name: `Rotate ${kind} 90 degrees` });
    await rotate.click();
    await expect(rotate).toBeFocused();
    // Restore the orientation before comparing bounding boxes.
    for (let turn = 0; turn < 3; turn++) await rotate.click();
    await save.click();
    await expect(hit).toHaveCount(2);
    await expectDocumentReady(page);
    const enlarged = await hit.last().boundingBox();
    expect(enlarged?.width).toBeGreaterThan(defaultBox.width);
    expect(enlarged?.height).toBeGreaterThan(defaultBox.height);
  }
  await hit.last().click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(hit.last()).toBeFocused();
}
