// Turns an uploaded file into plain text. Everything runs in the browser;
// the file never leaves this computer.

const MAX_WORDS = 1500;

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function median(numbers) {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Keep only the first maxWords words, cutting at a sentence end if possible
function limitWords(paragraphs, maxWords) {
  const out = [];
  let used = 0;
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (used + words.length <= maxWords) {
      out.push(para);
      used += words.length;
    } else {
      let part = words.slice(0, maxWords - used).join(" ");
      const lastStop = Math.max(
        part.lastIndexOf(". "), part.lastIndexOf("? "), part.lastIndexOf("! ")
      );
      if (lastStop > 0 && lastStop > part.length - 300) {
        part = part.slice(0, lastStop + 1);
      }
      if (part) out.push(part);
      return { text: out.join("\n\n"), trimmed: true };
    }
  }
  return { text: out.join("\n\n"), trimmed: false };
}

function finishExtraction(paragraphs, maxWords, moreAvailable) {
  const limited = limitWords(paragraphs, maxWords);
  return { text: limited.text, trimmed: limited.trimmed || moreAvailable };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// ---------- PDF ----------
async function extractPdfParagraphs(buffer, maxWords) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("The PDF reader files are missing from the lib folder.");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";

  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const paragraphs = [];
  let moreAvailable = false;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group the text pieces into lines by their vertical position
    const lines = [];
    let current = null;
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      const y = item.transform[5];
      if (current && Math.abs(current.y - y) < 2) {
        current.text += item.str;
      } else {
        current = { y: y, text: item.str };
        lines.push(current);
      }
    }
    const cleanLines = lines.filter((l) => l.text.trim() !== "");

    // A bigger-than-usual gap between lines means a new paragraph
    const gaps = [];
    for (let i = 1; i < cleanLines.length; i++) {
      gaps.push(Math.abs(cleanLines[i - 1].y - cleanLines[i].y));
    }
    const typical = median(gaps);

    let para = "";
    cleanLines.forEach((line, i) => {
      const t = line.text.replace(/\s+/g, " ").trim();
      const gap = i > 0 ? Math.abs(cleanLines[i - 1].y - line.y) : 0;
      if (para && typical > 0 && gap > typical * 1.5) {
        paragraphs.push(para);
        para = "";
      }
      if (para.endsWith("-") && /^[a-z]/.test(t)) {
        para = para.slice(0, -1) + t; // join a word split across two lines
      } else {
        para += (para ? " " : "") + t;
      }
    });
    if (para) paragraphs.push(para);

    // Stop early once we have enough words
    if (countWords(paragraphs.join(" ")) >= maxWords) {
      moreAvailable = p < pdf.numPages;
      break;
    }
  }
  return { paragraphs, moreAvailable };
}

// ---------- EPUB ----------
function resolveEpubPath(base, href) {
  const parts = (base + decodeURIComponent(href)).split("/");
  const out = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

async function extractEpubParagraphs(buffer, maxWords) {
  if (typeof JSZip === "undefined") {
    throw new Error("The EPUB reader file is missing from the lib folder.");
  }
  const zip = await JSZip.loadAsync(buffer);

  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("This does not look like a valid EPUB file.");

  const parser = new DOMParser();
  const container = parser.parseFromString(await containerFile.async("string"), "application/xml");
  const opfPath = container.querySelector("rootfile").getAttribute("full-path");
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error("This EPUB is missing its table of contents.");

  const opf = parser.parseFromString(await opfFile.async("string"), "application/xml");
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  // The manifest lists every file; the spine gives the reading order
  const manifest = {};
  opf.querySelectorAll("manifest > item").forEach((item) => {
    manifest[item.getAttribute("id")] = item.getAttribute("href");
  });
  const spine = [...opf.querySelectorAll("spine > itemref")].map((r) => r.getAttribute("idref"));

  const paragraphs = [];
  let words = 0;
  let moreAvailable = false;

  for (let c = 0; c < spine.length; c++) {
    const href = manifest[spine[c]];
    if (!href) continue;
    const chapterFile = zip.file(resolveEpubPath(base, href));
    if (!chapterFile) continue;

    const doc = parser.parseFromString(await chapterFile.async("string"), "text/html");
    const blocks = doc.body
      ? doc.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote")
      : [];

    blocks.forEach((el) => {
      // skip containers that hold other blocks, to avoid repeating text
      if (el.querySelector("p, li, blockquote, h1, h2, h3, h4, h5, h6")) return;
      const t = el.textContent.replace(/\s+/g, " ").trim();
      if (t) {
        paragraphs.push(t);
        words += countWords(t);
      }
    });

    if (words >= maxWords) {
      moreAvailable = c < spine.length - 1;
      break;
    }
  }
  return { paragraphs, moreAvailable };
}

// ---------- One entry point for every file type ----------
async function extractTextFromFile(file, maxWords) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const r = await extractPdfParagraphs(await readFileAsArrayBuffer(file), maxWords);
    return finishExtraction(r.paragraphs, maxWords, r.moreAvailable);
  }

  if (name.endsWith(".epub")) {
    const r = await extractEpubParagraphs(await readFileAsArrayBuffer(file), maxWords);
    return finishExtraction(r.paragraphs, maxWords, r.moreAvailable);
  }

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    const text = await readFileAsText(file);
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    return finishExtraction(paragraphs, maxWords, false);
  }

  throw new Error(
    "This version reads PDF, EPUB, .txt and .md files. For Word documents, copy the text and paste it above."
  );
}