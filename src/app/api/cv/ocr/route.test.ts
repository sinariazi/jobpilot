import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function ocrRequest(language = "eng") {
  const form = new FormData();
  form.append("page", new Blob(["jpeg bytes"], { type: "image/jpeg" }), "page.jpg");
  form.append("language", language);
  return new Request("http://localhost/api/cv/ocr", { method: "POST", body: form });
}

describe("local scanned-CV OCR API", () => {
  it("runs Tesseract locally and returns recognized text", async () => {
    execFileMock.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout: "Recognized CV text", stderr: "" });
    });
    const response = await POST(ocrRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Recognized CV text" });
    expect(execFileMock.mock.calls[0]?.[0]).toBe("tesseract");
    expect(execFileMock.mock.calls[0]?.[1]).toContain("eng");
  });

  it("rejects unsupported language codes before starting OCR", async () => {
    const response = await POST(ocrRequest("fr;touch /tmp/file"));
    expect(response.status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("refuses scanned-page uploads sent to a non-local host", async () => {
    const request = new Request("https://jobpilot.example/api/cv/ocr", { method: "POST", body: new FormData() });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
