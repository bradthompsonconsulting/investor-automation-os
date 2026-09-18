'use strict';

// Systematic PDF-space coordinate derivation for INV-67 PDF population.
//
// Extracts pdfjs-dist text items per page (item.transform's e,f are already
// PDF user-space coordinates -- bottom-left origin, y-up -- directly usable
// by pdf-lib, no viewport transform applied). Every strategy below returns
// {x, y, width, height} in that same space, or throws with a clear reason
// if the page's actual content doesn't match what the caller expected --
// callers must catch and defer, never silently guess.
//
// Anchor-text matching reuses the SAME normalization
// test-inv67-template-placement-manifest.cjs uses for its own PDF-anchor
// portability fix (curly/straight quotes, collapsed whitespace) so this
// helper and that validator never disagree about what counts as "the same
// printed text."

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SOURCE_PDF_PATH = path.join(REPO_ROOT, 'docs', 'TREC Resale Home Contract.pdf');

function normalizeAnchorText(s) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsLibPromise;
}

const pageItemCache = new Map();
const pageDimCache = new Map();

async function getPageItems(pageNum) {
  if (pageItemCache.has(pageNum)) return pageItemCache.get(pageNum);
  const pdfjsLib = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(SOURCE_PDF_PATH));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  pageDimCache.set(pageNum, { width: viewport.width, height: viewport.height });
  const content = await page.getTextContent();
  const items = content.items
    .filter((it) => it.str !== undefined)
    .map((it, idx) => {
      const [, , , , e, f] = it.transform;
      return {
        idx,
        str: it.str,
        norm: normalizeAnchorText(it.str),
        x: e,
        y: f,
        width: it.width,
        height: it.height || Math.abs(it.transform[3]) || 10,
      };
    });
  pageItemCache.set(pageNum, items);
  return items;
}

async function getPageSize(pageNum) {
  await getPageItems(pageNum);
  return pageDimCache.get(pageNum);
}

/** Items sharing (approximately) the same baseline y, in x order -- a "line." */
function groupIntoLines(items, tolerance = 0.5) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    let line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

function findExactlyOne(items, predicate, description) {
  const matches = items.filter(predicate);
  if (matches.length === 0) throw new Error(`anchor not found: ${description}`);
  if (matches.length > 1) throw new Error(`anchor ambiguous (${matches.length} matches): ${description}`);
  return matches[0];
}

function isBlankSpace(item) {
  return item.str.trim() === '' && item.width > 4;
}

/** Some blanks are printed as literal underscore runs ("_____"), their own distinct text item, rather than whitespace. */
function isUnderscoreRun(item) {
  return /^_+$/.test(item.str.trim());
}

function isBlankLike(item) {
  return isBlankSpace(item) || isUnderscoreRun(item);
}

/**
 * Strategy E: the anchor is the LAST fixed item on its line (a sentence
 * wraps here). The blank is either (a) an underscore-run item that is
 * itself the first item of the next line down -- its own box is the
 * blank -- or (b), lacking that, the trailing margin-to-edge blank on the
 * anchor's OWN line (same as trailingLineBlank). Tries (a) first since an
 * underscore-run item's box is exact; falls back to (b) so a caller
 * doesn't need to know in advance which this page uses.
 */
function blankAfterWrappingAnchor(items, anchorPredicate, rightMarginX, description) {
  const lines = groupIntoLines(items);
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    const idx = line.items.findIndex(anchorPredicate);
    if (idx === -1) continue;
    const hasFollowingFixedText = line.items.slice(idx + 1).some((it) => it.str.trim() !== '' && !isBlankLike(it));
    if (hasFollowingFixedText) continue;
    const nextLine = lines[li + 1];
    if (nextLine && isUnderscoreRun(nextLine.items[0])) {
      const u = nextLine.items[0];
      return { x: u.x, y: u.y, width: u.width, height: u.height };
    }
    const anchor = line.items[idx];
    const startX = anchor.x + anchor.width + 2;
    const width = rightMarginX - startX;
    if (width <= 2) throw new Error(`blankAfterWrappingAnchor: non-positive width: ${description}`);
    return { x: startX, y: anchor.y, width, height: anchor.height };
  }
  throw new Error(`blankAfterWrappingAnchor: anchor not found as line-final item: ${description}`);
}

/**
 * Strategy A: a named anchor item is immediately followed (same line, next
 * item in x-order) by a wide blank space item -- that space item's own box
 * IS the fillable blank.
 */
function blankAfterAnchorOnLine(items, anchorPredicate, description) {
  const lines = groupIntoLines(items);
  for (const line of lines) {
    const idx = line.items.findIndex(anchorPredicate);
    if (idx === -1) continue;
    const next = line.items[idx + 1];
    if (next && isBlankLike(next)) {
      // Merge every consecutive blank-like item (space runs, underscore
      // runs, or a mix -- some TREC blanks embed a lone "_" character
      // between two space regions) into one span, so the returned box
      // covers the WHOLE fillable gap, not just its first fragment.
      let j = idx + 1;
      let endX = next.x + next.width;
      while (line.items[j + 1] && isBlankLike(line.items[j + 1])) {
        j += 1;
        endX = line.items[j].x + line.items[j].width;
      }
      return { x: next.x, y: next.y, width: endX - next.x, height: next.height, anchorItem: line.items[idx] };
    }
  }
  throw new Error(`blankAfterAnchorOnLine: no line has anchor followed by a blank space item: ${description}`);
}

/**
 * Strategy B: locate a "$" glyph matching a context predicate (to
 * disambiguate when a page has multiple "$" signs); the blank is the
 * region immediately right of it, up to either the next non-blank item on
 * that line or a caller-supplied max width.
 */
function blankAfterDollarSign(items, contextPredicate, maxWidth, description) {
  const dollarItems = items.filter((it) => it.str === '$');
  const candidates = dollarItems.filter((d) => contextPredicate(d, items));
  if (candidates.length === 0) throw new Error(`blankAfterDollarSign: no "$" matched context: ${description}`);
  if (candidates.length > 1) throw new Error(`blankAfterDollarSign: ambiguous "$" (${candidates.length}): ${description}`);
  const dollar = candidates[0];
  const sameLine = items.filter((it) => Math.abs(it.y - dollar.y) <= 0.5 && it.x > dollar.x + dollar.width - 0.5);
  sameLine.sort((a, b) => a.x - b.x);
  const startX = dollar.x + dollar.width + 1;
  const nextFixed = sameLine.find((it) => it.x >= startX && it.str.trim() !== '');
  const endX = nextFixed ? nextFixed.x - 2 : startX + maxWidth;
  const width = Math.min(maxWidth, endX - startX);
  if (width <= 2) throw new Error(`blankAfterDollarSign: computed non-positive width: ${description}`);
  return { x: startX, y: dollar.y, width, height: dollar.height };
}

/**
 * Strategy C: anchor item is the LAST fixed item on its line; the blank
 * runs from the anchor's right edge to a caller-supplied right margin.
 */
function trailingLineBlank(items, anchorPredicate, rightMarginX, description) {
  const lines = groupIntoLines(items);
  for (const line of lines) {
    const idx = line.items.findIndex(anchorPredicate);
    if (idx === -1) continue;
    const anchor = line.items[idx];
    const hasFollowingFixedText = line.items.slice(idx + 1).some((it) => it.str.trim() !== '' && !isBlankLike(it));
    if (hasFollowingFixedText) continue;
    const startX = anchor.x + anchor.width + 2;
    const width = rightMarginX - startX;
    if (width <= 2) throw new Error(`trailingLineBlank: non-positive width: ${description}`);
    return { x: startX, y: anchor.y, width, height: anchor.height };
  }
  throw new Error(`trailingLineBlank: anchor not found as line-final item: ${description}`);
}

/**
 * Strategy G: the blank is the LEFT portion of a line, running from a
 * caller-supplied left margin to an anchor item that is NOT first on its
 * own line (e.g. the page-11 broker-firm-name blank preceding "(Broker
 * Firm) represents Seller only as Seller's agent."). Mirrors
 * `trailingLineBlank`'s logic in the opposite direction.
 */
function blankBeforeAnchorOnLine(items, anchorPredicate, leftMarginX, description) {
  const lines = groupIntoLines(items);
  for (const line of lines) {
    const idx = line.items.findIndex(anchorPredicate);
    if (idx === -1) continue;
    const anchor = line.items[idx];
    const width = anchor.x - 2 - leftMarginX;
    if (width <= 2) throw new Error(`blankBeforeAnchorOnLine: non-positive width: ${description}`);
    return { x: leftMarginX, y: anchor.y, width, height: anchor.height };
  }
  throw new Error(`blankBeforeAnchorOnLine: anchor not found: ${description}`);
}

/**
 * Strategy D: locate a checkbox glyph ("q" in this form's symbol font --
 * confirmed against PR #75's proven ordinal 54 placement) immediately
 * preceding specific label text on the same line, then return the exact
 * centered mark box PR #75 hand-derived and visually verified (cap-height
 * baseline, not the raw glyph baseline).
 */
function checkboxBeforeLabel(items, labelPredicate, description, occurrence = 0) {
  const lines = groupIntoLines(items);
  const matches = [];
  for (const line of lines) {
    for (let i = 0; i < line.items.length; i += 1) {
      if (line.items[i].str !== 'q') continue;
      const rest = line.items.slice(i + 1).filter((it) => it.str.trim() !== '');
      if (labelPredicate(rest, line.items, i)) {
        matches.push(line.items[i]);
      }
    }
  }
  if (matches.length === 0) throw new Error(`checkboxBeforeLabel: no "q" glyph matched label: ${description}`);
  if (occurrence >= matches.length) {
    throw new Error(`checkboxBeforeLabel: requested occurrence ${occurrence} but only ${matches.length} found: ${description}`);
  }
  const q = matches[occurrence];
  return checkboxMarkBox(q);
}

/**
 * Given a "q" checkbox glyph item, returns the centered mark box using the
 * exact correction PR #75 derived for ordinal 54 (baseline raised by
 * cap-height/2 above the glyph's own baseline so a Helvetica-Bold "X"
 * visually centers inside the printed box rather than sitting
 * bottom-right of it).
 */
function checkboxMarkBox(q) {
  // The "q" glyph's own reported height (~13pt, this form's Wingdings-style
  // checkbox cell) overstates the actual ink footprint of a drawn
  // Helvetica-Bold "X" mark (cap-height ~7.2pt at 10pt). Using the raw
  // glyph height here made adjacent checkboxes on this document's ~13pt
  // line pitch register as "overlapping" even though their real ink never
  // touches -- return a box matching the mark's own rendered size instead,
  // which is what the overlap validation should actually reason about.
  const markHeight = 10;
  return { x: q.x, y: q.y + 2.65, width: q.width, height: markHeight };
}

let measurementFontsPromise = null;
async function getMeasurementFonts() {
  if (!measurementFontsPromise) {
    measurementFontsPromise = (async () => {
      const doc = await PDFDocument.create();
      const times = await doc.embedFont(StandardFonts.TimesRoman);
      const helvetica = await doc.embedFont(StandardFonts.Helvetica);
      return { times, helvetica };
    })();
  }
  return measurementFontsPromise;
}

/**
 * Strategy F: a blank rendered as underscores embedded WITHIN a single
 * merged pdfjs text item (e.g. `"may terminate the contract within _____"`),
 * not as its own adjacent item -- none of strategies A-E apply, since there
 * is no separate blank-like item to find. `disableCombineTextItems: true`
 * does not split these; the underscores are genuinely part of one
 * content-stream text-showing operation.
 *
 * Estimates the underscore run's real position by computing what FRACTION
 * of the full string's width the text before/through the run occupies,
 * using standard font metrics as a proxy for the source PDF's actual
 * (unknown) font, then applying that fraction to the item's REAL
 * pdfjs-measured width. Cross-validates against two structurally different
 * fonts (Times-Roman and Helvetica) and REFUSES (throws, forcing a defer)
 * if they disagree by more than a small tolerance -- close agreement
 * between two very different font shapes is the actual evidence that the
 * proportional estimate is trustworthy for this particular string, not a
 * coincidence of one font's specific metrics.
 *
 * This is an ESTIMATE, not an exact measurement -- every placement using
 * this strategy MUST still be visually confirmed via a rendered screenshot
 * before being accepted, exactly like a Visual-judgment row.
 */
async function blankWithinMergedRun(item, underscoreRunPattern, description, opts) {
  const pattern = underscoreRunPattern || /_{3,}/;
  const match = item.str.match(pattern);
  if (!match) throw new Error(`blankWithinMergedRun: no underscore run matching ${pattern} in "${item.str}": ${description}`);
  const prefix = item.str.slice(0, match.index);
  const throughRun = item.str.slice(0, match.index + match[0].length);
  const full = item.str;

  const { times, helvetica } = await getMeasurementFonts();
  const fontSize = item.height; // this document's item.height already carries the real glyph size (see getPageItems)
  const ratios = [times, helvetica].map((font) => {
    const wFull = font.widthOfTextAtSize(full, fontSize);
    const wStart = font.widthOfTextAtSize(prefix, fontSize);
    const wEnd = font.widthOfTextAtSize(throughRun, fontSize);
    return { start: wStart / wFull, end: wEnd / wFull };
  });
  const startDelta = Math.abs(ratios[0].start - ratios[1].start);
  const endDelta = Math.abs(ratios[0].end - ratios[1].end);
  const tolerance = (opts && opts.tolerance) || 0.04;
  if (startDelta > tolerance || endDelta > tolerance) {
    throw new Error(
      `blankWithinMergedRun: Times-Roman/Helvetica estimates disagree too much to trust (start Δ${startDelta.toFixed(3)}, end Δ${endDelta.toFixed(3)}, tolerance ${tolerance}): ${description}`
    );
  }
  const startRatio = (ratios[0].start + ratios[1].start) / 2;
  const endRatio = (ratios[0].end + ratios[1].end) / 2;
  const pad = (opts && opts.pad) !== undefined ? opts.pad : 1.5;
  const rawStartX = item.x + startRatio * item.width;
  const rawEndX = item.x + endRatio * item.width;
  const width = rawEndX - rawStartX - 2 * pad;
  if (width <= 2) throw new Error(`blankWithinMergedRun: estimated width non-positive after padding: ${description}`);
  return { x: rawStartX + pad, y: item.y, width, height: item.height, estimated: true };
}

module.exports = {
  normalizeAnchorText,
  getPageItems,
  getPageSize,
  groupIntoLines,
  findExactlyOne,
  isBlankSpace,
  blankAfterAnchorOnLine,
  blankAfterDollarSign,
  trailingLineBlank,
  blankBeforeAnchorOnLine,
  blankAfterWrappingAnchor,
  isUnderscoreRun,
  isBlankLike,
  checkboxBeforeLabel,
  checkboxMarkBox,
  blankWithinMergedRun,
};
