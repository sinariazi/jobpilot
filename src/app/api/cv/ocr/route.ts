import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const execFileAsync = promisify(execFile);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
const ALLOWED_LANGUAGES = new Set(["eng", "deu", "eng+deu"]);

export async function POST(request: Request) {
  let host: string;
  try {
    host = new URL(request.url).hostname;
  } catch {
    return Response.json({ error: "OCR requires Jobpilot to run on this laptop." }, { status: 403 });
  }
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(host)) {
    return Response.json({ error: "For privacy, scanned CV OCR is available only from localhost on this laptop." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "The scanned CV page is too large for OCR. Try a lower-resolution scan." }, { status: 413 });
  }

  let image: File;
  let language: string;
  try {
    const form = await request.formData();
    const candidate = form.get("page");
    const selectedLanguage = form.get("language");
    if (!(candidate instanceof File) || candidate.type !== "image/jpeg" || candidate.size === 0 || candidate.size > MAX_IMAGE_BYTES
      || typeof selectedLanguage !== "string" || !ALLOWED_LANGUAGES.has(selectedLanguage)) {
      return Response.json({ error: "Provide a JPEG page image under 8 MB and choose a supported OCR language." }, { status: 400 });
    }
    image = candidate;
    language = selectedLanguage;
  } catch {
    return Response.json({ error: "The OCR request must contain a JPEG page image and language." }, { status: 400 });
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), "jobpilot-ocr-"));
  const imagePath = join(workingDirectory, "page.jpg");
  try {
    await writeFile(imagePath, Buffer.from(await image.arrayBuffer()), { mode: 0o600 });
    const executable = process.env.TESSERACT_PATH || "tesseract";
    const { stdout } = await execFileAsync(executable, [imagePath, "stdout", "-l", language, "--psm", "6"], {
      timeout: 45_000,
      maxBuffer: 1_000_000,
      windowsHide: true,
    });
    return Response.json({ text: stdout }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    const details = `${failure.message ?? ""} ${failure.stderr ?? ""}`.toLocaleLowerCase();
    if (failure.code === "ENOENT") {
      return Response.json({ error: "Tesseract OCR is not installed or is not on PATH. Install Tesseract, then restart Jobpilot." }, { status: 503 });
    }
    if (details.includes("failed loading language") || details.includes("could not initialize tesseract")) {
      return Response.json({ error: "The selected OCR language data is not installed. Install the requested Tesseract language pack and restart Jobpilot." }, { status: 503 });
    }
    if (failure.killed) return Response.json({ error: "Local OCR took too long on this page. Try a clearer or lower-resolution scan." }, { status: 504 });
    return Response.json({ error: "Tesseract could not recognize this scanned page. Check the image quality and selected language." }, { status: 502 });
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}
