import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { APPLICATION_EXTENSION_ORIGIN } from "../../src/lib/application-extension";

type PrefillApi = {
  detectPlatform(url: string): string | null;
  classifyField(metadata: string | { tagName: string; type: string; labels: unknown[]; ownerDocument: { getElementById(id: string): null }; getAttribute(name: string): string | null }, profile: Record<string, string>): string | null;
  fillEmptyFields(document: { querySelectorAll(selector: string): Iterable<unknown> }, profile: Record<string, string>): { count: number; fields: string[] };
};
// The same plain JavaScript module is loaded by Chrome/Edge as a content script
// and by Vitest here, so tests exercise the actual extension's field matcher.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const prefill = require("./prefill.js") as PrefillApi;

describe("Chromium Jobpilot extension", () => {
  it.each([
    ["https://boards.greenhouse.io/example/jobs/1", "greenhouse"],
    ["https://jobs.lever.co/example/role", "lever"],
    ["https://jobs.ashbyhq.com/example/role", "ashby"],
    ["https://tenant.myworkdayjobs.com/careers", "workday"],
    ["https://jobs.smartrecruiters.com/example/role", "smartrecruiters"],
    ["https://apply.workable.com/example/j/1", "workable"],
  ])("detects supported ATS forms at %s", (url, platform) => {
    expect(prefill.detectPlatform(url)).toBe(platform);
  });

  it("does not activate on other sites or insecure URLs", () => {
    expect(prefill.detectPlatform("https://example.com/apply")).toBeNull();
    expect(prefill.detectPlatform("http://jobs.ashbyhq.com/example/role")).toBeNull();
  });

  it("maps only recognized identity, contact, eligibility, and letter fields", () => {
    const profile = { name: "Sina Riazi", email: "sina@example.test", phone: "+431234", linkedin: "https://linkedin.example/sina", portfolio: "https://sina.example", workAuthorization: "Eligible in Austria", coverLetter: "Dear team" };
    expect(prefill.classifyField("first_name First name", profile)).toBe("firstName");
    expect(prefill.classifyField("familyName Last name", profile)).toBe("lastName");
    expect(prefill.classifyField("Name", profile)).toBe("name");
    expect(prefill.classifyField("company_name Company name", profile)).toBeNull();
    expect(prefill.classifyField("name Company name", profile)).toBeNull();
    expect(prefill.classifyField("autocomplete email Email address", profile)).toBe("email");
    expect(prefill.classifyField("mobile phone number", profile)).toBe("phone");
    expect(prefill.classifyField("LinkedIn profile URL", profile)).toBe("linkedin");
    expect(prefill.classifyField("personal website", profile)).toBe("portfolio");
    expect(prefill.classifyField("right to work", profile)).toBe("workAuthorization");
    const coverLetterField = { tagName: "TEXTAREA", type: "textarea", labels: [], ownerDocument: { getElementById: () => null }, getAttribute: (name: string) => name === "aria-label" ? "Cover letter" : null };
    expect(prefill.classifyField(coverLetterField, profile)).toBe("coverLetter");
    expect(prefill.classifyField("Why do you want to work here?", profile)).toBeNull();
    expect(prefill.classifyField("password", profile)).toBeNull();
  });

  it("fills only recognized empty text fields and leaves existing/custom/sensitive fields untouched", () => {
    const makeField = (tagName: string, type: string, name: string, label: string, value = "") => {
      const events: string[] = [];
      const attributes: Record<string, string> = { name, "aria-label": label };
      return {
        tagName: tagName.toLocaleUpperCase(), type, value, events,
        disabled: false, readOnly: false,
        labels: [{ textContent: label }],
        ownerDocument: { getElementById: () => null, defaultView: { Event } },
        getAttribute: (attribute: string) => attributes[attribute] ?? null,
        dispatchEvent: (event: Event) => { events.push(event.type); return true; },
      };
    };
    const fields = [
      makeField("input", "text", "first_name", "First name"),
      makeField("input", "text", "last_name", "Last name"),
      makeField("input", "email", "email", "Email", "already@filled.test"),
      makeField("input", "password", "password", "Password"),
      makeField("input", "checkbox", "consent", "Consent"),
      makeField("textarea", "textarea", "cover_letter", "Cover letter"),
      makeField("textarea", "textarea", "why_us", "Why do you want to work here?"),
    ];
    const document = { querySelectorAll: () => fields } as unknown as Parameters<PrefillApi["fillEmptyFields"]>[0];
    const result = prefill.fillEmptyFields(document, {
      name: "Sina Riazi", email: "sina@example.test", coverLetter: "Dear team",
    });

    expect(result).toEqual({ count: 3, fields: ["firstName", "lastName", "coverLetter"] });
    expect(fields.map((field) => field.value)).toEqual(["Sina", "Riazi", "already@filled.test", "", "", "Dear team", ""]);
    expect(fields[0]?.events).toEqual(["input", "change"]);
  });

  it("keeps the browser extension origin synchronized with its pinned manifest key", async () => {
    const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8")) as { key: string };
    const publicKey = Buffer.from(manifest.key, "base64");
    const id = [...createHash("sha256").update(publicKey).digest().subarray(0, 16)]
      .map((byte) => [byte >> 4, byte & 15].map((nibble) => String.fromCharCode(97 + nibble)).join(""))
      .join("");
    expect(APPLICATION_EXTENSION_ORIGIN).toBe(`chrome-extension://${id}`);
  });
});
