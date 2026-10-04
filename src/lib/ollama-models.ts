/**
 * Resolve saved/environment model preferences against tags installed in Ollama.
 * Ollama does not expose a capability registry for System One, so the fallback
 * only suggests tags explicitly named for decision/System One use.
 */
export function resolveOllamaModelPreferences(
  installedModels: string[],
  configuredChatModel?: string,
  configuredDecisionModel?: string,
) {
  const decisionSuggestion = installedModels.find((name) => /(?:decision|system[-_ ]?one|jev|tev\d*)/i.test(name));
  const preferredDecisionModel = configuredDecisionModel && installedModels.includes(configuredDecisionModel)
    ? configuredDecisionModel
    : decisionSuggestion;
  const preferredModel = configuredChatModel && installedModels.includes(configuredChatModel)
    ? configuredChatModel
    : installedModels.find((name) => name !== preferredDecisionModel);
  return {
    ...(preferredModel ? { preferredModel } : {}),
    ...(preferredDecisionModel ? { preferredDecisionModel } : {}),
  };
}
