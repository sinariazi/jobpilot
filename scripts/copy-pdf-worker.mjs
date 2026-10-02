import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
const destination = new URL("../public/pdf.worker.min.mjs", import.meta.url);

await copyFile(fileURLToPath(source), fileURLToPath(destination));
