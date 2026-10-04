import { describe, expect, it } from "vitest";
import { resolveOllamaModelPreferences } from "./ollama-models";

describe("Ollama model suggestions", () => {
  it("suggests an installed decision model and a separate chat model", () => {
    expect(resolveOllamaModelPreferences(["qwen3.5:4b", "tev1:0.8b"])).toEqual({
      preferredModel: "qwen3.5:4b",
      preferredDecisionModel: "tev1:0.8b",
    });
  });

  it("honors configured installed models", () => {
    expect(resolveOllamaModelPreferences(["chat:latest", "system-one:small"], "chat:latest", "system-one:small")).toEqual({
      preferredModel: "chat:latest",
      preferredDecisionModel: "system-one:small",
    });
  });

  it("does not guess a decision model from unrelated model tags", () => {
    expect(resolveOllamaModelPreferences(["llama:latest"])).toEqual({ preferredModel: "llama:latest" });
  });
});
