import mammoth from "mammoth/mammoth.browser";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const MAX_TEXT_CHARACTERS = 200_000;

export type CvSuggestions = {
  roles: string;
  skills: string;
  notes: string[];
  sourceText?: string;
  pageCount?: number;
};

function sectionFor(line: string): "skills" | "experience" | "other" | null {
  const heading = line.toLocaleLowerCase().replace(/[:|]+$/g, "").replace(/[–—]/g, "-").trim();
  if (/^(technical\s+|professional\s+|core\s+)?skills(\s+(and|&)\s+competencies)?$|^(technologies|technical expertise|tools|toolbox|competencies)$/.test(heading)) return "skills";
  if (/^(professional\s+|work\s+|employment\s+)?experience$|^(career|employment) history$|^work history$/.test(heading)) return "experience";
  if (/^(education|certifications?|languages|projects?|summary|profile|contact|references|interests|awards|publications|volunteer experience)$/.test(heading)) return "other";
  return null;
}

export function extractCvSuggestionsFromText(text: string): CvSuggestions {
  const sections: Record<"skills" | "experience", string[]> = { skills: [], experience: [] };
  let active: "skills" | "experience" | null = null;
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const line = rawLine.replace(/\u0000/g, "").trim().replace(/^[•●▪◦*\-–—\s]+/, "").trim();
    if (!line) continue;
    const heading = sectionFor(line);
    if (heading) {
      active = heading === "other" ? null : heading;
      continue;
    }
    if (active) sections[active].push(line);
  }

  const skills = [...new Set(sections.skills
    .flatMap((line) => line.split(/[,;|•·]+/))
    .map((skill) => skill.replace(/^\s*(?:[-*•▪◦]+|\d+[.)])\s*/, "").trim())
    .filter((skill) => skill.length >= 2 && skill.length <= 80))].slice(0, 60);

  const datePattern = /\b(?:19|20)\d{2}\s*(?:[-–—/]\s*(?:(?:19|20)\d{2}|present|current|now|today))?\b/i;
  const roles = [...new Set(sections.experience
    .filter((line) => datePattern.test(line))
    .map((line) => line.replace(datePattern, "").replace(/\s*[-–—|,;:]+\s*$/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 120))].slice(0, 12);

  const notes: string[] = [];
  if (skills.length === 0) notes.push("No skills section was detected. You can still enter skills manually.");
  if (roles.length === 0) notes.push("No dated role titles were detected. Review the CV structure or enter target roles manually.");
  notes.push("Role suggestions are taken from past experience, not inferred job-search goals.");
  notes.push("Your CV address is not used as a preferred job location.");
  return { roles: roles.join("; "), skills: skills.join(", "), notes };
}

async function extractPdfText(file: File): Promise<{ text: string; pageCount: number }> {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("/pdf.worker.min.mjs", window.location.href).toString();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWorkerFetch: false,
  });
  const document = await loadingTask.promise;
  try {
    if (document.numPages > MAX_PDF_PAGES) throw new Error(`This PDF has ${document.numPages} pages. CVs over ${MAX_PDF_PAGES} pages are not supported.`);
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").filter(Boolean).join(" "));
    }
    return { text: pages.join("\n"), pageCount: document.numPages };
  } finally {
    await loadingTask.destroy();
  }
}

export async function parseCvFile(file: File): Promise<CvSuggestions> {
  if (file.size === 0) throw new Error("The selected file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose a CV smaller than 12 MB.");

  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  let text: string;
  let pageCount: number | undefined;
  if (extension === "pdf") {
    const result = await extractPdfText(file);
    text = result.text;
    pageCount = result.pageCount;
  } else if (extension === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    text = result.value;
  } else if (extension === "txt") {
    text = await file.text();
  } else {
    throw new Error("Choose a PDF, DOCX, or TXT CV. Older DOC files are not supported.");
  }

  const normalized = text.replace(/\u0000/g, "").slice(0, MAX_TEXT_CHARACTERS);
  if (normalized.trim().length < 40) {
    throw new Error("No readable text was found. Scanned or image-only PDFs need OCR, which is not implemented yet.");
  }
  const suggestions = extractCvSuggestionsFromText(normalized);
  return { ...suggestions, sourceText: normalized, ...(pageCount ? { pageCount } : {}) };
}
