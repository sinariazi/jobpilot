import { describe, expect, it } from "vitest";
import { descriptionText } from "./greenhouse";

describe("Greenhouse description formatting", () => {
  it("keeps paragraph and list structure while decoding entities", () => {
    const text = descriptionText("<p>Build &amp; ship.</p><ul><li>React</li><li>TypeScript</li></ul>");
    expect(text).toContain("Build & ship.");
    expect(text).toContain("React\nTypeScript");
    expect(text.split("\n").length).toBeGreaterThan(1);
  });
});
