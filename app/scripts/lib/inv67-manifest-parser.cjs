'use strict';

// Parses docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md's own markdown table.
// Mirrors test-inv67-template-placement-manifest.cjs's extractRows() exactly
// (same column indices, same CRLF-safe line handling) so both scripts agree
// on what the manifest says -- this is not a second, independently-drifting
// parser.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md');

function normalizeLine(line) {
  return line.replace(/\r$/, '');
}

function parseRow(rawLine) {
  const line = normalizeLine(rawLine);
  const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function extractRows(src) {
  const rowLines = src.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(normalizeLine(l)));
  const rows = rowLines.map(parseRow);
  rows.forEach((r, i) => {
    if (r.length !== 19) throw new Error(`row ${i} (ordinal ${r[0]}) has ${r.length} cells, expected 19`);
  });
  const strip = (s) => s.replace(/`/g, '');
  const parsed = rows.map((r) => ({
    ordinal: Number(r[0]),
    page: r[1],
    para: r[2],
    destination: r[3],
    key: strip(r[4]),
    sourceFact: r[5],
    ghlDisplayName: r[6],
    id: strip(r[7]),
    fieldKey: strip(r[8]),
    mergeTag: strip(r[9]),
    type: r[10],
    valueShape: r[11],
    placements: r[12],
    formattingRule: r[13],
    guidance: r[14],
    applicability: r[15],
    duplicateNote: r[16],
    cls: r[17],
    validationNote: r[18],
  }));
  return { rowLines, rows, parsed };
}

function loadManifestRows() {
  const src = fs.readFileSync(MANIFEST_PATH, 'utf8');
  return extractRows(src).parsed;
}

module.exports = { MANIFEST_PATH, normalizeLine, parseRow, extractRows, loadManifestRows };
