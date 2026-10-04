(function attachJobpilotPrefill(root, makeApi) {
  const api = makeApi();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JobpilotPrefill = api;
})(globalThis, function createJobpilotPrefill() {
  const atsHosts = [
    ["greenhouse", /(^|\.)((boards|job-boards)\.greenhouse\.io|grnh\.se)$/i],
    ["lever", /(^|\.)jobs\.lever\.co$/i],
    ["ashby", /(^|\.)jobs\.ashbyhq\.com$/i],
    ["workday", /(^|\.)myworkdayjobs\.com$/i],
    ["smartrecruiters", /(^|\.)jobs\.smartrecruiters\.com$/i],
    ["workable", /(^|\.)(apply\.workable\.com|jobs\.workable\.com)$/i],
  ];

  function detectPlatform(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:") return null;
      return atsHosts.find(([, matcher]) => matcher.test(url.hostname))?.[0] ?? null;
    } catch {
      return null;
    }
  }

  function metadataFor(element) {
    const document = element.ownerDocument ?? globalThis.document;
    const labels = element.labels ? [...element.labels].map((label) => label.textContent ?? []) : [];
    const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => document?.getElementById(id)?.textContent ?? "");
    return [
      element.getAttribute("autocomplete"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("aria-label"),
      ...labelledBy,
      ...labels,
      element.getAttribute("placeholder"),
    ].filter(Boolean).join(" ").toLocaleLowerCase();
  }

  function classifyField(element, profile) {
    const metadata = typeof element === "string" ? element.toLocaleLowerCase() : metadataFor(element);
    const tag = typeof element === "string" ? "input" : element.tagName?.toLocaleLowerCase();
    const type = typeof element === "string" ? "text" : (element.type ?? "text").toLocaleLowerCase();
    if (tag === "textarea" && /\b(cover letter|motivation letter|motivational letter|anschreiben)\b/.test(metadata) && profile.coverLetter) return "coverLetter";
    if (/\b(first[\s_-]?name|given[\s_-]?name|forename|vorname)\b/.test(metadata)) return "firstName";
    if (/\b(last[\s_-]?name|family[\s_-]?name|surname|nachname|familienname)\b/.test(metadata)) return "lastName";
    const explicitlyFullName = /\b(full[\s_-]?name|your name|candidate name)\b/.test(metadata);
    const genericNameField = typeof element === "string"
      ? metadata.trim() === "name"
      : ["autocomplete", "name", "id", "aria-label"].some((attribute) =>
        element.getAttribute(attribute)?.trim().toLocaleLowerCase() === "name")
        || (element.labels ? [...element.labels].some((label) => label.textContent?.trim().toLocaleLowerCase() === "name") : false);
    if (explicitlyFullName || genericNameField) return "name";
    if (/\b(email|e[\s-]?mail|email address|mail address)\b/.test(metadata) && (type === "email" || type === "text")) return "email";
    if (/\b(phone|telephone|tel|mobile|phone number|telefon|telefonnummer|mobilnummer)\b/.test(metadata) && ["tel", "text"].includes(type)) return "phone";
    if (/\blinked[\s-]?in\b/.test(metadata) && ["url", "text"].includes(type)) return "linkedin";
    if (/\b(portfolio|website|personal site|webseite|homepage)\b/.test(metadata) && ["url", "text"].includes(type)) return "portfolio";
    if (/\b(work authorization|work authorisation|right to work|work eligibility|arbeitsberechtigung|arbeitsbewilligung)\b/.test(metadata) && ["text", "url"].includes(type)) return "workAuthorization";
    return null;
  }

  function valueForField(field, profile) {
    if (field === "firstName") return (profile.name ?? "").trim().split(/\s+/)[0] ?? "";
    if (field === "lastName") return (profile.name ?? "").trim().split(/\s+/).slice(1).join(" ");
    return typeof profile[field] === "string" ? profile[field].trim() : "";
  }

  function setNativeValue(element, value) {
    let prototype = Object.getPrototypeOf(element);
    let setter;
    while (prototype && !setter) {
      setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      prototype = Object.getPrototypeOf(prototype);
    }
    if (setter) setter.call(element, value);
    else element.value = value;
    const EventConstructor = element.ownerDocument?.defaultView?.Event ?? globalThis.Event;
    if (EventConstructor) {
      element.dispatchEvent(new EventConstructor("input", { bubbles: true }));
      element.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    }
  }

  function fillEmptyFields(document, profile) {
    const filled = new Set();
    let count = 0;
    for (const element of document.querySelectorAll("input, textarea")) {
      const tag = element.tagName?.toLocaleLowerCase();
      const type = (element.type ?? "text").toLocaleLowerCase();
      if ((tag !== "input" && tag !== "textarea")
        || element.disabled || element.readOnly || element.getAttribute("aria-disabled") === "true"
        || (tag === "input" && !["text", "email", "tel", "url"].includes(type))
        || typeof element.value !== "string" || element.value.trim()) continue;
      const field = classifyField(element, profile);
      if (!field) continue;
      const value = valueForField(field, profile);
      if (!value) continue;
      setNativeValue(element, value);
      filled.add(field);
      count += 1;
    }
    return { count, fields: [...filled] };
  }

  return { detectPlatform, classifyField, fillEmptyFields };
});
