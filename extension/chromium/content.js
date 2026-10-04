chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "JOBPILOT_FILL_EMPTY_FIELDS") return false;
  const platform = globalThis.JobpilotPrefill?.detectPlatform(window.location.href);
  if (!platform || !message.candidate || typeof message.candidate !== "object") {
    sendResponse({ ok: false, error: "This page is not a supported ATS form." });
    return false;
  }
  const result = globalThis.JobpilotPrefill.fillEmptyFields(document, message.candidate);
  sendResponse({ ok: true, platform, ...result });
  return false;
});
