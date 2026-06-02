/**
 * Convert chapter HTML document to structured plain blocks and sentences.
 */

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "BLOCKQUOTE",
  "FIGCAPTION",
]);

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function nodeToBlocks(node, blocks) {
  if (!node) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const t = normalizeWhitespace(node.textContent);
    if (t) {
      const last = blocks[blocks.length - 1];
      if (last && last.type === "p") {
        last.text += (last.text.endsWith(" ") ? "" : " ") + t;
      } else {
        blocks.push({ type: "p", text: t });
      }
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "SVG") return;

  if (tag === "BR") {
    blocks.push({ type: "break" });
    return;
  }

  const headingMatch = /^H([1-6])$/.exec(tag);
  if (headingMatch) {
    const text = normalizeWhitespace(node.textContent);
    if (text) blocks.push({ type: "h", level: Number(headingMatch[1]), text });
    return;
  }

  if (tag === "P" || tag === "BLOCKQUOTE" || tag === "LI") {
    const text = normalizeWhitespace(node.textContent);
    if (text) blocks.push({ type: tag === "LI" ? "li" : "p", text });
    return;
  }

  if (BLOCK_TAGS.has(tag) && tag !== "DIV") {
    const text = normalizeWhitespace(node.textContent);
    if (text) blocks.push({ type: "p", text });
    return;
  }

  for (const child of node.childNodes) {
    nodeToBlocks(child, blocks);
  }
}

export function documentToBlocks(doc) {
  if (!doc) return [];

  const body =
    doc.body ||
    doc.getElementsByTagName?.("body")?.[0] ||
    doc.documentElement;

  if (!body) return [];

  const blocks = [];
  nodeToBlocks(body, blocks);
  return blocks;
}

export function blocksToHtml(blocks) {
  return blocks
    .map((b) => {
      if (b.type === "h") {
        return `<h${b.level}>${escapeHtml(b.text)}</h${b.level}>`;
      }
      if (b.type === "li") {
        return `<p class="list-item">• ${escapeHtml(b.text)}</p>`;
      }
      return `<p>${escapeHtml(b.text)}</p>`;
    })
    .join("\n");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Split text into sentences using Intl.Segmenter when available.
 */
export function splitSentences(text) {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed) return [];

  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    const result = [];
    for (const { segment } of segmenter.segment(trimmed)) {
      const s = normalizeWhitespace(segment);
      if (s) result.push(s);
    }
    if (result.length > 0) return result;
  }

  // Fallback: split on sentence-ending punctuation
  const parts = trimmed.split(/(?<=[.!?…])\s+(?=[A-Z"'“(])/u);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function blocksToSentences(blocks) {
  const sentences = [];
  const blockIndexBySentence = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (block.type === "h") {
      const s = block.text;
      sentences.push(s);
      blockIndexBySentence.push(bi);
      continue;
    }
    const parts = splitSentences(block.text);
    for (const p of parts) {
      sentences.push(p);
      blockIndexBySentence.push(bi);
    }
  }

  return { sentences, blockIndexBySentence };
}
