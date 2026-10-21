import { Effect } from "effect";
import { answerField } from "../../../src/controllers/editor-field-state";
import {
  copyOrganizationPages,
  emptyOrganizationHistory,
  recordOrganization,
  snapshotOrganization,
} from "../../../src/controllers/editor-history";
import { createPageStates } from "../../../src/controllers/editor-page-state";
import { textFieldFixture } from "../../../src/services/__tests__/pdf-field-fixtures";
import { PDFOperationsService } from "../../../src/services/pdf-operations-service";
import { inspectFilledPDF } from "./filled-fields";

export async function checkClearedFields() {
  const fixture = await textFieldFixture({ nullAttributes: false });
  const file = new File([new Uint8Array(fixture.bytes)], "same.pdf", { type: "application/pdf" });
  const service = new PDFOperationsService({ renderPage: () => Effect.void });
  let originalBytes: Uint8Array, clearedBytes: Uint8Array, undoBytes: Uint8Array;
  const original = createPageStates(file, 2);
  const before = snapshotOrganization(original, new Set(), original[0].id);
  const cleared = answerField(original, original[0].id, fixture.fieldRef, "");
  const after = snapshotOrganization(cleared, new Set(), cleared[0].id);
  const history = recordOrganization(emptyOrganizationHistory(), "Clear field", before, after);
  const restored = copyOrganizationPages(history.undo[0].before.pages);
  try {
    await Effect.runPromise(
      service.validateFieldAnswer(file, { fieldRef: fixture.fieldRef, value: "" }, [1, 2])
    );
    originalBytes = (await Effect.runPromise(service.buildPDF(original))).data;
    clearedBytes = (await Effect.runPromise(service.buildPDF(cleared))).data;
    undoBytes = (await Effect.runPromise(service.buildPDF(restored))).data;
  } finally {
    await Effect.runPromise(service.dispose());
  }
  return {
    fieldRef: fixture.fieldRef,
    widgets: fixture.widgetRefs,
    explicitEmpty: after.pages.map((page) => page.fieldAnswers?.[0]),
    noOverride: restored.every((page) => page.fieldAnswers === undefined),
    originalFile: restored.every((page) => page.sourceFile === file),
    originalGroup: restored.every((page) => page.fieldGroupId === original[0].fieldGroupId),
    original: await inspectFilledPDF(Array.from(originalBytes)),
    cleared: await inspectFilledPDF(Array.from(clearedBytes)),
    undo: await inspectFilledPDF(Array.from(undoBytes)),
    bytes: Array.from(clearedBytes),
  };
}
