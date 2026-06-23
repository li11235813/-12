import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

const app = express();
const PORT = Number(process.env.PORT || 4318);
const WORKDIR = path.resolve();
const PUBLIC_DIR = path.join(WORKDIR, "public");
const DATA_DIR = path.join(WORKDIR, "data");
const MANIFEST_PATH = path.join(DATA_DIR, "library.json");
const ONLINE_MANIFEST_PATH = path.join(DATA_DIR, "library-online.json");
const EPUB_CACHE_DIR = path.join(DATA_DIR, "epub-html");

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/library", async (_req, res) => {
  try {
    const manifest = await loadManifest();
    res.json(manifest);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/books/:id/file", async (req, res) => {
  try {
    const { book, manifest } = await findBook(req.params.id);
    const filePath = book.publicPath
      ? path.join(PUBLIC_DIR, decodeURIComponent(book.publicPath.replace(/^\/books\//, "books/")))
      : path.join(manifest.libraryRoot, book.relativePath);
    res.sendFile(filePath);
  } catch (error) {
    res.status(404).json({ error: String(error) });
  }
});

app.get("/api/books/:id/text", async (req, res) => {
  try {
    const { book, manifest } = await findBook(req.params.id);
    const filePath = book.publicPath
      ? path.join(PUBLIC_DIR, decodeURIComponent(book.publicPath.replace(/^\/books\//, "books/")))
      : path.join(manifest.libraryRoot, book.relativePath);

    if (book.ext === "pdf") {
      const textPath = path.join(DATA_DIR, "pdf-text", `${book.id}.txt`);
      const text = await fs.readFile(textPath, "utf8");
      res.type("text/plain; charset=utf-8").send(text);
      return;
    }

    if (book.ext === "txt") {
      const buffer = await fs.readFile(filePath);
      res.type("text/plain; charset=utf-8").send(buffer.toString("utf8"));
      return;
    }

    res.status(400).json({ error: "This book type does not expose text mode." });
  } catch (error) {
    res.status(404).json({ error: String(error) });
  }
});

app.get("/api/books/:id/epub-html", async (req, res) => {
  try {
    const { book, manifest } = await findBook(req.params.id);
    if (book.ext !== "epub") {
      res.status(400).json({ error: "Only epub supports html fallback." });
      return;
    }

    const filePath = book.publicPath
      ? path.join(PUBLIC_DIR, decodeURIComponent(book.publicPath.replace(/^\/books\//, "books/")))
      : path.join(manifest.libraryRoot, book.relativePath);
    const payload = await buildEpubHtmlFallback(book.id, filePath);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Reading site running at http://localhost:${PORT}`);
});

async function loadManifest() {
  try {
    const rawOnline = await fs.readFile(ONLINE_MANIFEST_PATH, "utf8");
    return JSON.parse(rawOnline);
  } catch {}

  const raw = await fs.readFile(MANIFEST_PATH, "utf8");
  return JSON.parse(raw);
}

async function findBook(id) {
  const manifest = await loadManifest();
  const book = manifest.books.find((item) => item.id === id);
  if (!book) throw new Error(`Book not found: ${id}`);
  return { book, manifest };
}

async function buildEpubHtmlFallback(bookId, filePath) {
  await fs.mkdir(EPUB_CACHE_DIR, { recursive: true });
  const cachePath = path.join(EPUB_CACHE_DIR, `${bookId}.json`);

  try {
    const cached = await fs.readFile(cachePath, "utf8");
    return JSON.parse(cached);
  } catch {}

  const zip = new AdmZip(filePath);
  const containerEntry = zip.getEntry("META-INF/container.xml");
  if (!containerEntry) throw new Error("EPUB container.xml not found");

  const containerXml = zip.readAsText(containerEntry, "utf8");
  const container = xmlParser.parse(containerXml);
  const opfRelativePath = container?.container?.rootfiles?.rootfile?.['full-path'] || container?.container?.rootfiles?.rootfile?.[0]?.['full-path'];
  if (!opfRelativePath) throw new Error("OPF path not found in container.xml");

  const opfEntry = zip.getEntry(opfRelativePath);
  if (!opfEntry) throw new Error(`OPF file not found: ${opfRelativePath}`);

  const opfXml = zip.readAsText(opfEntry, "utf8");
  const opf = xmlParser.parse(opfXml);
  const pkg = opf.package;
  const manifestItems = toArray(pkg.manifest?.item || []);
  const spineItems = toArray(pkg.spine?.itemref || []);
  const metadata = pkg.metadata || {};
  const title = firstText(metadata.title) || path.basename(filePath, path.extname(filePath));
  const opfDir = path.posix.dirname(opfRelativePath.replace(/\\/g, "/"));

  const manifestMap = new Map(manifestItems.map((item) => [item.id, item]));
  const chapters = [];
  let fullText = "";

  for (const itemref of spineItems) {
    const item = manifestMap.get(itemref.idref);
    if (!item?.href) continue;
    const chapterPath = normalizeZipPath(path.posix.join(opfDir, item.href));
    const chapterEntry = zip.getEntry(chapterPath);
    if (!chapterEntry) continue;
    const rawHtml = zip.readAsText(chapterEntry, "utf8");
    const bodyHtml = extractBodyHtml(rawHtml);
    const text = htmlToPlainText(bodyHtml);
    const chapterTitle = extractHeading(bodyHtml) || `章节 ${chapters.length + 1}`;
    chapters.push({ title: chapterTitle, html: bodyHtml, text });
    fullText += `\n\n${chapterTitle}\n\n${text}`;
  }

  const payload = {
    title,
    chapters,
    fullText: fullText.trim(),
  };

  await fs.writeFile(cachePath, JSON.stringify(payload), "utf8");
  return payload;
}

function normalizeZipPath(value) {
  return value.replace(/^\.\//, "").replace(/\\/g, "/");
}

function toArray(value) {
  return Array.isArray(value) ? value : [value];
}

function firstText(value) {
  if (Array.isArray(value)) return firstText(value[0]);
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value) return value["#text"];
  return "";
}

function extractBodyHtml(rawHtml) {
  const match = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? sanitizeHtml(match[1]) : sanitizeHtml(rawHtml);
}

function sanitizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+=("[^"]*"|'[^']*')/gi, "")
    .replace(/\s(src|href)=("(?!https?:|data:|#)[^"]*"|'(?!https?:|data:|#)[^']*')/gi, "");
}

function htmlToPlainText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHeading(html) {
  const match = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  return match ? htmlToPlainText(match[1]) : "";
}
