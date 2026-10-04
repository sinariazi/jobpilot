import mammoth from "mammoth/mammoth.browser";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const MAX_TEXT_CHARACTERS = 200_000;
const MAX_OCR_PAGES = 20;
const MAX_OCR_PIXELS = 12_000_000;

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

type CvSection = "skills" | "experience" | "other";
type SectionHeading = { section: CvSection; content: string };

const SECTION_ALIASES: Record<CvSection, string[]> = {
  skills: [
    "skills", "technical skills", "professional skills", "core skills", "key skills", "soft skills",
    "skills and competencies", "skills and tools", "technical skills and expertise", "technologies",
    "technology stack", "technical expertise", "expertise", "tools", "toolbox", "competencies",
    "core competencies", "key competencies", "technical competencies", "qualifications", "key qualifications",
    "kenntnisse", "fachkenntnisse", "technische kenntnisse", "it kenntnisse", "kenntnisse und fähigkeiten",
    "fähigkeiten", "stärken", "kompetenzen", "fachliche kompetenzen", "technische kompetenzen", "schlüsselqualifikationen",
    "technical proficiencies", "technical abilities", "compétences",
  ],
  experience: [
    "experience", "professional experience", "work experience", "employment experience", "relevant experience",
    "career history", "employment history", "work history", "career experience", "professional background",
    "career summary", "work and leadership experience", "berufserfahrung", "berufliche erfahrung",
    "beruflicher werdegang", "beruflicher werdegang und erfahrung", "berufliche laufbahn", "beruflicher hintergrund",
    "praxiserfahrung", "tätigkeitserfahrung", "berufliche stationen", "werdegang", "berufliche praxis",
    "expérience professionnelle", "parcours professionnel", "werkervaring",
  ],
  other: [
    "education", "academic background", "education and training", "certification", "certifications", "licenses",
    "languages", "language skills", "projects", "selected projects", "summary", "profile", "about me",
    "professional profile", "personal profile", "contact", "references", "interests", "awards", "publications",
    "volunteer experience", "ausbildung", "studium", "schulbildung", "zertifikate", "zertifizierungen",
    "sprachen", "projekte", "profil", "kurzprofil", "persönliches", "kontakt", "referenzen", "interessen",
    "auszeichnungen", "ehrenamt", "fortbildungen", "formation", "langues", "education et formation",
  ],
};

function normalizeHeading(value: string) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/ß/g, "ss").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const NORMALIZED_ALIASES = Object.entries(SECTION_ALIASES).flatMap(([section, aliases]) =>
  aliases.map((alias) => ({ section: section as CvSection, alias: normalizeHeading(alias) })),
).sort((a, b) => b.alias.length - a.alias.length);

function sectionHeading(line: string): SectionHeading | null {
  const cleaned = line.replace(/^[\s\d.)|:–—-]+/, "").replace(/[:|]+$/g, "").trim();
  const divider = cleaned.match(/^(.{2,70}?)\s*(?::|\||[–—])\s+(.+)$/);
  for (const variant of divider ? [divider[1].trim(), cleaned] : [cleaned]) {
    const found = NORMALIZED_ALIASES.find(({ alias }) => alias === normalizeHeading(variant));
    if (found) return { section: found.section, content: variant === cleaned ? "" : divider?.[2]?.trim() ?? "" };
  }
  return null;
}

type PdfTextItem = { str?: string; transform?: number[]; width?: number };
export type OcrLanguage = "eng" | "deu" | "eng+deu";

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
    // Require repeated whitespace aligned across text rows; one large gap may
    // simply be paragraph spacing in a single-column CV.
    const candidates = new Map<number, { gap: number; lines: Set<number> }>();
    for (const [lineIndex, line] of lines.entries()) {
      const row = line.items.map((item) => ({
        start: item.x,
        end: item.x + (items[item.index]?.width ?? item.text.length * 4),
      })).sort((a, b) => a.start - b.start);
      for (let index = 1; index < row.length; index += 1) {
        const gap = row[index].start - row[index - 1].end;
        const center = Math.round((row[index].start + row[index - 1].end) / 2);
        if (gap < Math.max(24, pageWidth * 0.045) || center < pageWidth * 0.2 || center > pageWidth * 0.8) continue;
        const evidence = candidates.get(center) ?? { gap: 0, lines: new Set<number>() };
        evidence.gap = Math.max(evidence.gap, gap);
        evidence.lines.add(lineIndex);
        candidates.set(center, evidence);
      }
    }
    const split = [...candidates.entries()]
      .filter(([center, evidence]) => {
        const leftLines = lines.filter((line) => line.items.some((item) => item.x < center)).length;
        const rightLines = lines.filter((line) => line.items.some((item) => item.x >= center)).length;
        return leftLines >= 3 && rightLines >= 3 && (evidence.lines.size >= 2 || evidence.gap >= pageWidth * 0.14);
      })
      .sort((a, b) => b[1].lines.size - a[1].lines.size || b[1].gap - a[1].gap)[0]?.[0];

    if (split !== undefined) {
      const orderedLines = [...lines].sort((a, b) => b.y - a.y);
      const output: string[] = [];
      let columnBlock: typeof lines = [];
      const renderRows = (rows: typeof lines) => rows.map((line) => line.items
        .sort((a, b) => a.x - b.x || a.index - b.index).map((item) => item.text).join(" "));
      const flushColumns = () => {
        if (columnBlock.length === 0) return;
        const itemsOnSide = (isLeft: boolean) => columnBlock.flatMap((line) => {
          const sideItems = line.items.filter((item) =>
            (item.x + (items[item.index]?.width ?? item.text.length * 4) / 2 < split) === isLeft,
          );
          return sideItems.length ? [{ ...line, items: sideItems }] : [];
        });
        const left = itemsOnSide(true);
        const right = itemsOnSide(false);
        output.push(...(left.length >= 3 && right.length >= 3
          ? [...renderRows(left), ...renderRows(right)]
          : renderRows(columnBlock)));
        columnBlock = [];
      };
      for (const line of orderedLines) {
        const spansGutter = line.items.some((item) =>
          item.x < split && item.x + (items[item.index]?.width ?? item.text.length * 4) > split,
        );
        if (spansGutter) {
          flushColumns();
          output.push(...renderRows([line]));
        } else columnBlock.push(line);
      }
      flushColumns();
      return output.join("\n");
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
    const heading = sectionHeading(line);
    if (heading) {
      active = heading.section === "other" ? null : heading.section;
      if (active && heading.content) sections[active].push(heading.content);
      continue;
    }
    if (active) sections[active].push(line);
  }

  const skills = [...new Set(sections.skills
    .flatMap((line) => line.split(/[,;|•·]+/))
    .map((skill) => skill.replace(/^\s*(?:[-*•▪◦]+|\d+[.)])\s*/, "").trim())
    .filter((skill) => skill.length >= 2 && skill.length <= 80))].slice(0, 60);

  const datePattern = /\b(?:19|20)\d{2}\s*(?:[-–—/]\s*(?:(?:19|20)\d{2}|present|current|now|today))?\b/i;
  const titlePattern = /\b(engineer|developer|architect|manager|consultant|analyst|designer|lead|director|officer|specialist|administrator|berater(?:in)?|entwickler(?:in)?|architekt(?:in)?|leiter(?:in)?|spezialist(?:in)?|projektmanager(?:in)?|produktmanager(?:in)?|geschäftsführer(?:in)?|ceo|cto|cio|vp|head of|product owner|scrum master)\b/i;
  const roles = [...new Set(sections.experience.flatMap((line, index) => {
    if (!datePattern.test(line)) return [];
    const inline = line.replace(datePattern, "").replace(/\b(?:from|since|bis|ab)\b/gi, " ").trim();
    const candidates = inline.split(/\s*(?:\||•|·|;|,|\bat\b|\s@\s)\s*/i)
      .map((part) => part.trim()).filter((part) => part.length >= 3 && part.length <= 120);
    const inlineRole = candidates.find((candidate) => titlePattern.test(candidate));
    if (inlineRole) return [inlineRole];
    if (candidates.length) return [candidates[0]];
    const preceding = sections.experience.slice(Math.max(0, index - 3), index).reverse();
    return [preceding.find((candidate) => titlePattern.test(candidate) && candidate.length <= 120)
      ?? preceding.find((candidate) => candidate.length >= 3 && candidate.length <= 100 && !/\b(?:gmbh|inc\.?|ltd\.?|llc|vienna|wien|berlin|zurich|zürich)\b/i.test(candidate))
      ?? ""].filter(Boolean);
  }).filter((line) => line.length >= 3 && line.length <= 120))].slice(0, 12);

  const notes: string[] = [];
  if (skills.length === 0) notes.push("No skills section was detected. You can still enter skills manually.");
  if (roles.length === 0) notes.push("No dated role titles were detected. Review the CV structure or enter target roles manually.");
  notes.push("Role suggestions are taken from past experience, not inferred job-search goals.");
  notes.push("Compare the extracted role and skill fields with your original CV before using them for job matching.");
  notes.push("Your CV address is not used as a preferred job location.");
  return { roles: roles.join("; "), skills: skills.join(", "), notes };
}

async function recognizePdfPage(page: pdfjs.PDFPageProxy, pageNumber: number, language: OcrLanguage) {
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(window.location.hostname)) {
    throw new Error("Scanned CV OCR is available only from localhost so page images stay on this laptop.");
  }
  const baseViewport = page.getViewport({ scale: 1.8 });
  const pixels = baseViewport.width * baseViewport.height;
  const scale = pixels > MAX_OCR_PIXELS ? 1.8 * Math.sqrt(MAX_OCR_PIXELS / pixels) : 1.8;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare this PDF page for local OCR.");
  try {
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode this PDF page for local OCR.")), "image/jpeg", 0.86));
    const body = new FormData();
    body.append("page", image, `cv-page-${pageNumber}.jpg`);
    body.append("language", language);
    const response = await fetch("/api/cv/ocr", { method: "POST", body, cache: "no-store" });
    const result = await response.json() as { text?: string; error?: string };
    if (!response.ok || typeof result.text !== "string") throw new Error(result.error ?? "Local OCR could not read this CV page.");
    return result.text;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function extractPdfText(file: File, language: OcrLanguage, onProgress?: (message: string) => void): Promise<{ text: string; pageCount: number }> {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("/pdf.worker.min.mjs", window.location.href).toString();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWorkerFetch: false,
  });
  const document = await loadingTask.promise;
  try {
    if (document.numPages > MAX_PDF_PAGES) throw new Error(`This PDF has ${document.numPages} pages. CVs over ${MAX_PDF_PAGES} pages are not supported.`);
    const pages: string[] = [];
    let ocrPages = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = joinPdfTextItems(content.items.flatMap((item) => "str" in item ? [{ str: item.str, transform: item.transform, width: item.width }] : []), Math.abs(page.view[2] - page.view[0]));
      if (pageText.trim().length < 40) {
        ocrPages += 1;
        if (ocrPages > MAX_OCR_PAGES) throw new Error(`This CV has more than ${MAX_OCR_PAGES} scanned pages. Local OCR is limited to ${MAX_OCR_PAGES} pages per CV.`);
        onProgress?.(`Running local OCR on scanned page ${pageNumber} of ${document.numPages}…`);
        pages.push(await recognizePdfPage(page, pageNumber, language));
      } else pages.push(pageText);
    }
    return { text: pages.join("\n"), pageCount: document.numPages };
  } finally {
    await loadingTask.destroy();
  }
}

export async function parseCvFile(file: File, options: { ocrLanguage?: OcrLanguage; onProgress?: (message: string) => void } = {}): Promise<CvSuggestions> {
  if (file.size === 0) throw new Error("The selected file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose a CV smaller than 12 MB.");

  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  let text: string;
  let pageCount: number | undefined;
  if (extension === "pdf") {
    const result = await extractPdfText(file, options.ocrLanguage ?? "eng", options.onProgress);
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
    throw new Error("No readable text was found. This PDF may be empty or too faint for local OCR; check the scan quality and try again.");
  }
  const suggestions = extractCvSuggestionsFromText(normalized);
  return { ...suggestions, sourceText: normalized, ...(pageCount ? { pageCount } : {}) };
}
