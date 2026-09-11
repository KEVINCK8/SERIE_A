import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const iconDir = path.join(rootDir, "assets", "image", "icon");
const outputFile = path.join(rootDir, "assets", "js", "icon-manifest.js");
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

const files = (await readdir(iconDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => imageExtensions.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "it", { numeric: true, sensitivity: "base" }));

const content = `// Generato automaticamente da scripts/generate-icon-manifest.mjs
// Aggiungi le icone in assets/image/icon e rigenera questo file.
export const ICON_FILES = ${JSON.stringify(files, null, 4)};
`;

await writeFile(outputFile, content, "utf8");

console.log(`Icone trovate: ${files.length}`);
