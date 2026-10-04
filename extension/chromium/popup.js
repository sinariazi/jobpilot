const button = document.querySelector("#fill");
const platformLine = document.querySelector("#platform");
const statusLine = document.querySelector("#status");
let activeTab;

function showError(message) {
  statusLine.textContent = message;
}

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  activeTab = tab;
  const platform = tab?.url ? globalThis.JobpilotPrefill.detectPlatform(tab.url) : null;
  if (!platform) {
    platformLine.textContent = "Open a supported employer application form first.";
    return;
  }
  platformLine.textContent = `Detected ${platform}.`;
  button.disabled = false;
}

button.addEventListener("click", async () => {
  button.disabled = true;
  statusLine.textContent = "Reading the saved profile from Jobpilot on this computer…";
  try {
    const endpoint = new URL("http://127.0.0.1:3000/api/application/prefill");
    endpoint.searchParams.set("postingUrl", activeTab.url);
    const response = await fetch(endpoint, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Jobpilot could not prepare your local application details.");
    const result = await chrome.tabs.sendMessage(activeTab.id, { type: "JOBPILOT_FILL_EMPTY_FIELDS", candidate: payload.candidate });
    if (!result?.ok) throw new Error(result?.error ?? "Could not reach the form. Reload the employer page and try again.");
    statusLine.textContent = result.count
      ? `Filled ${result.count} empty field${result.count === 1 ? "" : "s"}: ${result.fields.join(", ")}. Review the values before continuing.`
      : "No recognized empty fields were found. Nothing was changed.";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fill the form.";
    showError(message.includes("Failed to fetch")
      ? "Could not reach local Jobpilot. Start it at http://localhost:3000, then try again."
      : message);
  } finally {
    button.disabled = false;
  }
});

void initialize().catch(() => showError("Could not inspect this browser tab."));
