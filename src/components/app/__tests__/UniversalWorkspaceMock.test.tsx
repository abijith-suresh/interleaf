import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import UniversalWorkspaceMock from "../UniversalWorkspaceMock";

describe("UniversalWorkspaceMock", () => {
  it("shows a mixed working set and updates the selected page", () => {
    const { getByRole } = render(() => <UniversalWorkspaceMock />);
    const page = getByRole("button", {
      name: "Select page 3, Dashboard from screenshots",
    });

    expect(getByRole("heading", { name: "Untitled workspace" })).toBeInTheDocument();
    expect(page).toHaveAttribute("aria-pressed", "true");

    const otherPage = getByRole("button", {
      name: "Select page 1, Cover from project-brief.pdf",
    });
    otherPage.click();

    expect(otherPage).toHaveAttribute("aria-pressed", "true");
    expect(getByRole("status")).toHaveTextContent("Cover selected");
  });
});
