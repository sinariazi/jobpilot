import mammoth from "mammoth/mammoth.browser";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const MAX_TEXT_CHARACTERS = 200_000;

export type CvSuggestions = {
  roles: string;
  skills: string;
  notes: string[];
  analysis?: {
    summary: string;
    seniority: string;
    domains: string[];
    highlights: string[];
  };
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

type PdfTextItem = { str?: string; transform?: number[]; width?: number };

export function joinPdfTextItems(items: PdfTextItem[], pageWidth?: number) {
  const positioned = items.flatMap((item, index) => typeof item.str === "string" && item.str.trim()
    ? [{ text: item.str.trim(), x: item.transform?.[4] ?? index, y: item.transform?.[5] ?? 0, index }]
    : []);
  if (!positioned.some((item) => item.y !== 0)) return positioned.map((item) => item.text).join(" ");

  const ordered = [...positioned].sort((a, b) => b.y - a.y || a.x - b.x || a.index - b.index);
  const lines: Array<{ y: number; items: typeof ordered }> = [];
  for (const item of ordered) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  if (pageWidth && pageWidth > 0) {
    const starts = positioned.map((item) => item.x).sort((a, b) => a - b);
    let split: number | null = null;
    let widestGap = pageWidth * 0.2;
    for (let index = 1; index < starts.length; index += 1) {
      const gap = starts[index] - starts[index - 1];
      const candidate = (starts[index] + starts[index - 1]) / 2;
      if (gap > widestGap && candidate > pageWidth * 0.25 && candidate < pageWidth * 0.75) {
        const left = positioned.filter((item) => item.x < candidate);
        const right = positioned.filter((item) => item.x >= candidate);
        const hasLeftText = left.some((item) => (items[item.index]?.width ?? item.text.length * 4) > pageWidth * 0.12);
        const hasRightText = right.some((item) => (items[item.index]?.width ?? item.text.length * 4) > pageWidth * 0.12);
        if (left.length >= 3 && right.length >= 3 && hasLeftText && hasRightText) {
          split = candidate;
          widestGap = gap;
        }
      }
    }
    if (split !== null) {
      const renderColumn = (columnItems: typeof positioned) => {
        const columnLines: Array<{ y: number; items: typeof positioned }> = [];
        for (const item of [...columnItems].sort((a, b) => b.y - a.y || a.x - b.x || a.index - b.index)) {
          const line = columnLines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
          if (line) line.items.push(item);
          else columnLines.push({ y: item.y, items: [item] });
        }
        return columnLines.map((line) => line.items.sort((a, b) => a.x - b.x || a.index - b.index).map((item) => item.text).join(" "));
      };
      const leftLines = renderColumn(positioned.filter((item) => item.x < split));
      const rightLines = renderColumn(positioned.filter((item) => item.x >= split));
      return [...leftLines, ...rightLines].join("\n");
    }
  }

  return lines.map((line) => line.items.sort((a, b) => a.x - b.x || a.index - b.index).map((item) => item.text).join(" ")).join("\n");
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
  const roles = [...new Set(sections.experience.flatMap((line, index) => {
    if (!datePattern.test(line)) return [];
    const inlineRole = line.replace(datePattern, "").replace(/\s*[-–—|,;:]+\s*$/, "").trim();
    if (inlineRole.length >= 3) return [inlineRole];
    const precedingLine = sections.experience[index - 1]?.trim() ?? "";
    return precedingLine.length >= 3 && precedingLine.length <= 120 ? [precedingLine] : [];
  }).filter((line) => line.length >= 3 && line.length <= 120))].slice(0, 12);

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
      pages.push(joinPdfTextItems(content.items.flatMap((item) => "str" in item ? [{ str: item.str, transform: item.transform, width: item.width }] : []), Math.abs(page.view[2] - page.view[0])));
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
