'use strict';

// The systematic manifest-row -> PDF-coordinate derivation, built for the
// INV-67 PDF-population expansion (PHASE A). Converts every deterministic
// (Class: Ready) row it can locate unambiguously via
// inv67-pdf-anchor-helper.cjs's strategies, using text actually derived from
// the real contract-projection model (inv67-projection-fixture.cjs) rather
// than hand-typed synthetic strings. Anything ambiguous, embedded-underscore,
// or otherwise not cleanly one of the helper's strategies is DEFERRED with a
// stated reason -- never guessed.
//
// The six ordinals PR #75 already proved (1, 8, 10, 19, 54, 63) are
// re-verified here (same coordinates, re-derived the same way where they
// fit a named strategy) rather than re-hand-typed, so this file is the
// single source for all converted placements going forward.

const { loadManifestRows } = require('./inv67-manifest-parser.cjs');
const {
  getPageItems,
  findExactlyOne,
  blankAfterAnchorOnLine,
  blankAfterDollarSign,
  trailingLineBlank,
  blankBeforeAnchorOnLine,
  blankAfterWrappingAnchor,
  checkboxBeforeLabel,
  checkboxMarkBox,
  blankWithinMergedRun,
} = require('./inv67-pdf-anchor-helper.cjs');

const RIGHT_MARGIN = 576; // consistent body-text right margin observed across every inspected page

function textField(x, y, width, height, opts) {
  // Default height matches this document's own observed ~9.96-11pt body
  // line height when a derivation strategy's source box didn't carry its
  // own measured height (or the caller only needed x/y/width). Only used
  // for the bounds/overlap validations -- rendering itself uses the
  // baseline y directly and never reads this field.
  return { x, y, width, height: height === undefined ? 9 : height, font: 'Helvetica', fontSize: 9, align: 'left', ...opts };
}
function checkField(box) {
  return { x: box.x, y: box.y, width: box.width, height: box.height, font: 'Helvetica-Bold', fontSize: 10, align: 'center' };
}

// Each entry: { ordinal, page, deferReason } OR { ordinal, page, derive: async (items) => geometry }
// `page` is 1-indexed, matching the manifest.
const ROW_DERIVATIONS = [
  // ---- Page 1 ----
  { ordinal: 1, page: 1, derive: async (items) => textField(282, 689.86, 280, 11) }, // proven PR #75
  { ordinal: 2, page: 1, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === '(Seller) and', 'ordinal2 buyer blank');
    return textField(b.x + 2, b.y, b.width - 30, b.height); // leave room for "(Buyer)." caption
  } },
  { ordinal: 3, page: 1, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'LAND: Lot', 'ordinal3 lot blank');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 4, page: 1, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Block', 'ordinal4 block blank');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 5, page: 1, derive: async (items) => {
    const b = blankAfterWrappingAnchor(items, (it) => it.str === ',' && it.y > 610 && it.y < 622, RIGHT_MARGIN, 'ordinal5 addition wraps after LAND line comma');
    return textField(b.x + 2, b.y, Math.min(b.width - 4, 400));
  } },
  { ordinal: 6, page: 1, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Addition, City of', 'ordinal6 city blank');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 7, page: 1, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === ', County of', 'ordinal7 county blank');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 8, page: 1, derive: async (items) => textField(165, 595.3, 400, 9) }, // proven PR #75 (height trimmed from 11 to 9 now that ordinal 6 sits on the line directly above at a 10.68pt pitch -- x/y/width/rendering unchanged, only the validation bounding height)
  { ordinal: 9, page: 1, derive: async (items) => {
    // Whole next line after the wrapping EXCLUSIONS caption, bounded by its own trailing period.
    const period = items.find((it) => it.str === '.' && Math.abs(it.y - 370.6) < 1);
    if (!period) throw new Error('ordinal9: exclusions trailing period not found near y=370.6');
    return textField(74.4, period.y, period.x - 2 - 74.4);
  } },
  { ordinal: 10, page: 1, derive: async (items) => textField(459, 318.41, 110, 11) }, // proven PR #75
  { ordinal: 11, page: 1, derive: async (items) => {
    const d = blankAfterDollarSign(items, (dollar) => Math.abs(dollar.y - 268.97) < 1, 110, 'ordinal11 financing sum $');
    return textField(d.x, d.y, d.width, d.height);
  } },
  { ordinal: 12, page: 1, derive: async (items) => {
    const d = blankAfterDollarSign(items, (dollar) => Math.abs(dollar.y - 257.57) < 1, 110, 'ordinal12 sales price 3C $');
    return textField(d.x, d.y, d.width, d.height);
  } },
  { ordinal: 13, page: 1, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 195.0) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'A.', 'ordinal13 residential leases mark'));
  } },
  { ordinal: 14, page: 1, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 169.8) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'B.', 'ordinal14 fixture leases mark'));
  } },
  { ordinal: 15, page: 1, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 134.1) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'C.', 'ordinal15 NRL applies mark'));
  } },
  { ordinal: 16, page: 1, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 98.2) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest.some((r) => r.str.startsWith('(1) Seller has delivered')), 'ordinal16 NRL delivered mark'));
  } },
  { ordinal: 17, page: 1, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 83.8) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest.some((r) => r.str === '(2)'), 'ordinal17 NRL not-delivered mark'));
  } },
  { ordinal: 18, page: 1, derive: async (items) => {
    // PHASE B: blank is underscores embedded within one merged text item
    // (no separate blank item exists) -- Strategy F (proportional
    // font-metric estimation, cross-validated against two structurally
    // different standard fonts) rather than an adjacent-item strategy.
    const item = findExactlyOne(items, (it) => it.str.includes('may terminate the contract within'), 'ordinal18 NRL terminate-within-days item');
    const b = await blankWithinMergedRun(item, /_{3,}/, 'ordinal18 terminate-within-days blank');
    return textField(b.x, b.y, b.width, b.height, { estimated: true });
  } },

  // ---- Page 2 ----
  { ordinal: 19, page: 2, derive: async (items) => textField(129, 750.6, 325, 9, { fontSize: 7.5 }) }, // proven PR #75
  { ordinal: 20, page: 2, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'must deliver to', 'ordinal20 escrow agent name');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 21, page: 2, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'at' && Math.abs(it.y - 706.8) < 1, RIGHT_MARGIN, 'ordinal21 escrow address after "at"');
    return textField(b.x, b.y, b.width);
  } },
  { ordinal: 22, page: 2, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === '(address): $' && Math.abs(it.y - 696.1) < 1, 'ordinal22 earnest money $');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 23, page: 2, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'as earnest money and $' && Math.abs(it.y - 696.1) < 1, RIGHT_MARGIN, 'ordinal23 option fee $');
    return textField(b.x, b.y, b.width);
  } },
  { ordinal: 24, page: 2, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Buyer shall deliver additional earnest money of $', 'ordinal24 additional earnest money $');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 25, page: 2, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'to Escrow Agent within' && Math.abs(it.y - 664.1) < 1, RIGHT_MARGIN, 'ordinal25 additional earnest money days');
    return textField(b.x, b.y, Math.min(b.width, 60));
  } },
  { ordinal: 26, page: 2, derive: async (items) => {
    const band = items.filter((it) => it.y > 495 && it.y < 500);
    const u = band.find((it) => /^_+$/.test(it.str.trim()));
    if (!u) throw new Error('ordinal26: option period days underscore run not found');
    return textField(u.x, u.y, u.width);
  } },
  { ordinal: 27, page: 2, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 344.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'Seller', 'ordinal27 title expense seller mark'));
  } },
  { ordinal: 28, page: 2, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 344.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'Buyer', 'ordinal28 title expense buyer mark', 0));
  } },
  { ordinal: 29, page: 2, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'by' && Math.abs(it.y - 334.1) < 1, 'ordinal29 title company name');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 30, page: 2, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 170.1) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest.some((r) => r.str.startsWith('(i) will not')), 'ordinal30 shortage not-amended mark'));
  } },
  { ordinal: 31, page: 2, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 159.9) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest.some((r) => r.str.startsWith('(ii) will be amended')), 'ordinal31 shortage amended mark'));
  } },
  { ordinal: 32, page: 2, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 159.9) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'Buyer', 'ordinal32 shortage amended buyer mark'));
  } },
  { ordinal: 33, page: 2, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 159.9) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'Seller.', 'ordinal33 shortage amended seller mark'));
  } },

  // ---- Page 3 ----
  { ordinal: 34, page: 3, derive: async (items) => {
    // PHASE B: repeated address-header duplicate (Visual-judgment class --
    // shares a tight line with the printed "Page N of 12" text). Derived
    // fresh per page via blankAfterAnchorOnLine, which already merges the
    // ACTUAL blank run and stops before the page-number text -- not copied
    // from ordinal 19's page-2 coordinates. Visually confirmed via rendered
    // screenshot before being accepted (see PR description / commit notes).
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal34 page3 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },
  { ordinal: 35, page: 3, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 707.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(1)', 'ordinal35 survey opt1 mark'));
  } },
  { ordinal: 36, page: 3, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Within' && Math.abs(it.y - 707.3) < 1, 'ordinal36 survey opt1 seller-furnish days');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 37, page: 3, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 638.6) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === "Seller's", 'ordinal37 survey opt1 expense seller mark'));
  } },
  { ordinal: 38, page: 3, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 638.6) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith("Buyer's expense"), 'ordinal38 survey opt1 expense buyer mark'));
  } },
  { ordinal: 39, page: 3, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 628.9) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(2)', 'ordinal39 survey opt2 mark'));
  } },
  { ordinal: 40, page: 3, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Within' && Math.abs(it.y - 628.9) < 1, 'ordinal40 survey opt2 buyer-obtain days');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 41, page: 3, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 579.0) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(3)', 'ordinal41 survey opt3 mark'));
  } },
  { ordinal: 42, page: 3, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Within' && Math.abs(it.y - 579.0) < 1, 'ordinal42 survey opt3 seller-furnish days');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 43, page: 3, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'activity:', 'ordinal43 objections text');
    return textField(b.x + 2, b.y, Math.min(b.width - 4, 400));
  } },
  { ordinal: 44, page: 3, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str.endsWith('or (ii)') && Math.abs(it.y - 514.5) < 1, 'ordinal44 objections days');
    return textField(b.x + 2, b.y, Math.min(b.width - 4, 40));
  } },
  { ordinal: 45, page: 3, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 314.6) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'is', 'ordinal45 poa is-subject mark'));
  } },
  { ordinal: 46, page: 3, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 314.6) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'is not subject', 'ordinal46 poa is-not-subject mark'));
  } },

  // ---- Page 4 ----
  { ordinal: 47, page: 4, derive: async (items) => {
    // PHASE B: repeated address-header duplicate, same technique as ordinal 34.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal47 page4 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },
  { ordinal: 48, page: 4, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 213.8) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(1)', 'ordinal48 SDN received mark'));
  } },
  { ordinal: 49, page: 4, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 203.5) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(2)', 'ordinal49 SDN not-received mark'));
  } },
  { ordinal: 50, page: 4, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Within' && Math.abs(it.y - 203.5) < 1, 'ordinal50 SDN deliver-within days');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 51, page: 4, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 133.6) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(3)', 'ordinal51 SDN not-required mark'));
  } },

  // ---- Page 5 ----
  { ordinal: 52, page: 5, derive: async (items) => {
    // PHASE B: repeated address-header duplicate, same technique as ordinal 34.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal52 page5 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },
  { ordinal: 53, page: 5, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 720.12) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(1)', 'ordinal53 as-is plain mark'));
  } },
  { ordinal: 54, page: 5, derive: async (items) => checkField({ x: 58.2, y: 712.0, width: 11.55, height: 10 }) }, // proven PR #75 (height trimmed to match the mark's own ink footprint, same convention as checkboxMarkBox -- x/y/width unchanged from the proven placement)
  { ordinal: 55, page: 5, derive: async (items) => {
    // Genuinely empty gap (no item at all) below the wrapping caption --
    // inferred from this page's own consistent ~11.1pt line pitch (checked
    // against three adjacent, directly-observed line deltas on this same
    // page: 720.12->709.06->697.9).
    const caption = items.find((it) => it.str === 'following specific repairs and treatments:');
    if (!caption) throw new Error('ordinal55: repairs caption not found');
    return textField(caption.x, caption.y - 11.1, 400);
  } },
  { ordinal: 56, page: 5, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str.endsWith('$') && Math.abs(it.y - 398.4) < 1, 'ordinal56 service contract cap $');
    return textField(b.x + 2, b.y, Math.min(b.width - 4, 90));
  } },
  { ordinal: 57, page: 5, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 290.1) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('(1) Buyer has received'), 'ordinal57 water received mark'));
  } },
  { ordinal: 58, page: 5, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 276.5) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(2)', 'ordinal58 water not-received mark'));
  } },
  { ordinal: 59, page: 5, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Within' && Math.abs(it.y - 276.5) < 1, 'ordinal59 water deliver-within days');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 60, page: 5, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 202.5) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('(3) Seller is not required'), 'ordinal60 water exempt mark'));
  } },
  { ordinal: 61, page: 5, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'water supply company (PWC):', 'ordinal61 water source text');
    return textField(b.x + 2, b.y, Math.min(b.width - 4, 260));
  } },

  // ---- Page 6 ----
  { ordinal: 62, page: 6, derive: async (items) => {
    // PHASE B: repeated address-header duplicate, same technique as ordinal 34.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal62 page6 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },
  { ordinal: 63, page: 6, derive: async (items) => textField(292, 669.82, 125, 11) }, // proven PR #75
  { ordinal: 64, page: 6, derive: async (items) => {
    // PHASE B: Visual-judgment (narrowest, highest-risk of the four ¶9A
    // sub-blanks -- immediately adjacent to the printed "20" and the comma
    // that follows). Strategy A applies cleanly (a real, separate blank
    // space item immediately follows the ", 20" anchor) -- the risk here is
    // purely spatial tightness, not ambiguous text structure, so this needs
    // careful visual confirmation at zoom, not a different derivation
    // strategy.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === ', 20', 'ordinal64 closing date year-suffix blank');
    return textField(b.x + 1, b.y, b.width - 2, b.height);
  } },
  { ordinal: 65, page: 6, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 449.23) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'upon closing and funding', 'ordinal65 possession upon-closing mark'));
  } },
  { ordinal: 66, page: 6, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 449.23) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === 'according', 'ordinal66 possession leaseback mark'));
  } },
  { ordinal: 67, page: 6, derive: async (items) => {
    const period = items.find((it) => it.str === '.' && Math.abs(it.y - 216.29) < 1);
    if (!period) throw new Error('ordinal67: special provisions trailing period not found near y=216.29');
    return textField(59.9, period.y, Math.min(period.x - 2 - 59.9, 480));
  } },
  { ordinal: 68, page: 6, derive: async (items) => {
    // PHASE B: Strategy F, same as ordinal 18.
    const item = findExactlyOne(items, (it) => it.str.includes('amount not to exceed $'), 'ordinal68 seller credit cap item');
    const b = await blankWithinMergedRun(item, /_{3,}/, 'ordinal68 seller credit cap blank');
    return textField(b.x, b.y, b.width, b.height, { estimated: true });
  } },

  // ---- Page 7 ----
  { ordinal: 69, page: 7, derive: async (items) => {
    // PHASE B: repeated address-header duplicate, same technique as ordinal 34.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal69 page7 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },
  { ordinal: 70, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 645.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(1)', 'ordinal70 SPBB applies mark'));
  } },
  { ordinal: 71, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 645.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('$_________'), 'ordinal71 SPBB dollar mark'));
  } },
  { ordinal: 72, page: 7, derive: async (items) => {
    // PHASE B: Strategy F. Two "$_________ or" items exist on this page (SPBB
    // y~645.34, BPSB y~623.26 -- ordinal 77); disambiguate by y.
    const item = findExactlyOne(items, (it) => it.str.startsWith('$_________') && Math.abs(it.y - 645.34) < 1, 'ordinal72 SPBB dollar item');
    const b = await blankWithinMergedRun(item, /_{3,}/, 'ordinal72 SPBB dollar blank');
    return textField(b.x, b.y, b.width, b.height, { estimated: true });
  } },
  { ordinal: 73, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 645.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('______%'), 'ordinal73 SPBB percent mark'));
  } },
  { ordinal: 74, page: 7, derive: async (items) => {
    // PHASE B: Strategy F. Underscore run starts at index 0 (no prefix text) --
    // startRatio resolves to ~0, which is correct: the blank starts at the item's own x.
    const item = findExactlyOne(items, (it) => it.str.startsWith('______%') && Math.abs(it.y - 645.34) < 1, 'ordinal74 SPBB percent item');
    const b = await blankWithinMergedRun(item, /_{3,}/, 'ordinal74 SPBB percent blank');
    return textField(b.x, b.y, b.width, b.height, { estimated: true });
  } },
  { ordinal: 75, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 623.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(2)', 'ordinal75 BPSB applies mark'));
  } },
  { ordinal: 76, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 623.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('$_________'), 'ordinal76 BPSB dollar mark'));
  } },
  { ordinal: 77, page: 7, derive: async (items) => {
    // PHASE B: Strategy F. BPSB row (second occurrence, y~623.26).
    const item = findExactlyOne(items, (it) => it.str.startsWith('$_________') && Math.abs(it.y - 623.26) < 1, 'ordinal77 BPSB dollar item');
    const b = await blankWithinMergedRun(item, /_{3,}/, 'ordinal77 BPSB dollar blank');
    return textField(b.x, b.y, b.width, b.height, { estimated: true });
  } },
  { ordinal: 78, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 623.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('______%'), 'ordinal78 BPSB percent mark'));
  } },
  { ordinal: 79, page: 7, derive: async (items) => {
    // PHASE B: Strategy F. BPSB row (second occurrence, y~623.26).
    const item = findExactlyOne(items, (it) => it.str.startsWith('______%') && Math.abs(it.y - 623.26) < 1, 'ordinal79 BPSB percent item');
    const b = await blankWithinMergedRun(item, /_{3,}/, 'ordinal79 BPSB percent blank');
    return textField(b.x, b.y, b.width, b.height, { estimated: true });
  } },

  // ---- Page 8 ----
  { ordinal: 80, page: 8, derive: async (items) => {
    // PHASE B: repeated address-header duplicate, same technique as ordinal 34.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal80 page8 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },
  { ordinal: 81, page: 8, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Address:' && Math.abs(it.y - 379.1) < 1 && it.x < 200, 'ordinal81 buyer notice address');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 82, page: 8, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Address:' && Math.abs(it.y - 379.1) < 1 && it.x > 200, RIGHT_MARGIN, 'ordinal82 seller notice address');
    return textField(b.x, b.y, b.width);
  } },
  // ordinal 83 (noticeContact.buyerNoticePhone): PHASE A's
  // width-borrowed-from-a-clean-duplicate-caption technique produced
  // character-level overlap with the underlying underscores (see git
  // history for the full account). PHASE B: Strategy F instead --
  // measures the buyer-side item's OWN string directly rather than
  // borrowing a width from the seller-side item, avoiding that failure
  // mode entirely.
  { ordinal: 83, page: 8, derive: async (items) => {
    const item = findExactlyOne(items, (it) => it.str.startsWith('Phone(s):_'), 'ordinal83 buyer notice phone item');
    const b = await blankWithinMergedRun(item, /_{3,}/, 'ordinal83 buyer notice phone blank');
    return textField(b.x, b.y, b.width, b.height, { estimated: true });
  } },
  { ordinal: 84, page: 8, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Phone(s):' && Math.abs(it.y - 310.3) < 1 && it.x > 200, RIGHT_MARGIN, 'ordinal84 seller notice phone');
    return textField(b.x, b.y, b.width);
  } },
  { ordinal: 85, page: 8, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Email(s):' && Math.abs(it.y - 241.5) < 1 && it.x < 200, 'ordinal85 buyer notice email');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 86, page: 8, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Email(s):' && Math.abs(it.y - 241.5) < 1 && it.x > 200, RIGHT_MARGIN, 'ordinal86 seller notice email');
    return textField(b.x, b.y, b.width);
  } },

  // ---- Page 9 (paragraph 22 checklist) ----
  { ordinal: 87, page: 9, derive: async (items) => {
    // PHASE B: repeated address-header duplicate, same technique as ordinal 34.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal87 page9 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },
  { ordinal: 88, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Sale of Other Property by Buyer', 'ordinal88') },
  { ordinal: 89, page: 9, derive: async (items) => checkboxMark9(items, "Addendum Concerning Right to Terminate Due to Lender", 'ordinal89') },
  { ordinal: 90, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Section 1031 Exchange', 'ordinal90') },
  { ordinal: 91, page: 9, derive: async (items) => checkboxMark9(items, 'Short Sale Addendum', 'ordinal91') },
  { ordinal: 92, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum Regarding Residential Leases', 'ordinal92') },
  { ordinal: 93, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum Regarding Fixture Leases', 'ordinal93') },
  { ordinal: 94, page: 9, derive: async (items) => checkboxMark9(items, "Seller", 'ordinal94', (rest) => rest.some((r) => r.str.includes("s Temporary Residential Lease")) && items.some((it) => Math.abs(it.y - rest[0].y) < 0.5 && it.str === 'Seller')) },
  { ordinal: 95, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Authorizing Hydrostatic Testing', 'ordinal95') },
  { ordinal: 96, page: 9, derive: async (items) => checkboxMark9(items, 'Environmental Assessment, Threatened or Endangered Species', 'ordinal96') },
  { ordinal: 97, page: 9, derive: async (items) => checkboxMark9(items, "Addendum for Seller", 'ordinal97', (rest) => rest.some((r) => r.str.includes('Disclosure of Information on Lead'))) },
  { ordinal: 98, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Property in a Propane Gas System Service Area', 'ordinal98') },
  { ordinal: 99, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Property Located Seaward of the Gulf Intracoastal Waterway', 'ordinal99') },
  { ordinal: 100, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Coastal Area Property', 'ordinal100') },
  { ordinal: 101, page: 9, derive: async (items) => checkboxMark9(items, 'The following utility, water, drainage, public improvement', 'ordinal101') },
  { ordinal: 102, page: 9, derive: async (items) => {
    // PHASE B: Strategy F. (Confirmed via pdfjs this is ONE item on one
    // printed line, not actually spanning two lines as Phase A's prose
    // description implied -- the wrapping was in the manifest's own
    // narrative text, not the PDF content stream.)
    const item = findExactlyOne(items, (it) => it.str.includes('have been given or are attached):'), 'ordinal102 district notices item');
    const b = await blankWithinMergedRun(item, /_{3,}/, 'ordinal102 district notices blank');
    return textField(b.x, b.y, Math.min(b.width, 400), b.height, { estimated: true });
  } },
  { ordinal: 103, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Property Subject to Mandatory Membership', 'ordinal103') },
  { ordinal: 104, page: 9, derive: async (items) => checkboxMark9(items, 'Non', 'ordinal104', (rest) => rest.some((r) => r.str.includes('Realty Items Addendum'))) },
  { ordinal: 105, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for', 'ordinal105', (rest) => rest.some((r) => r.str === 'Contract') && rest.some((r) => r.str === 'Back')) },
  { ordinal: 106, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Reservation of Oil, Gas, and Other Minerals', 'ordinal106') },
  { ordinal: 107, page: 9, derive: async (items) => checkboxMark9(items, 'Other:', 'ordinal107') },
  { ordinal: 108, page: 9, derive: async (items) => {
    // PHASE B: Strategy F. (Same correction as ordinal 102 -- one item, one line.)
    const item = findExactlyOne(items, (it) => it.str.startsWith('Other:_'), 'ordinal108 other addenda text item');
    const b = await blankWithinMergedRun(item, /_{3,}/, 'ordinal108 other addenda text blank');
    return textField(b.x, b.y, Math.min(b.width, 400), b.height, { estimated: true });
  } },

  // ---- Page 10 ----
  { ordinal: 109, page: 10, derive: async (items) => {
    // PHASE B: repeated address-header duplicate, same technique as ordinal 34.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal109 page10 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },

  // ---- Page 11 ----
  { ordinal: 110, page: 11, derive: async (items) => {
    // PHASE B: repeated address-header duplicate, same technique as ordinal 34.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal110 page11 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },
  // Ordinals 111-132: the 22-key page-11 broker-text block. Investigated
  // fresh via pdfjs (no one had looked at this page before Phase B) --
  // structurally regular: two mirrored cards (Seller's agent, Buyer's
  // agent), each an identical 11-field layout at a fixed line pitch, left
  // margin 64.46pt. A third box below ("Intermediary") uses a DIFFERENT
  // left margin (65.3/78.86) and is explicitly out of this manifest's
  // 22-key scope (V1 excludes intermediary arrangements -- see
  // contract-broker-arrangement-model.ts) -- never touched here.
  { ordinal: 111, page: 11, derive: async (items) => {
    // Strategy G: this blank PRECEDES its anchor ("(Broker Firm) represents Seller...").
    const b = blankBeforeAnchorOnLine(items, (it) => it.str === '(Broker Firm)' && Math.abs(it.y - 641.02) < 1, 64.46, 'ordinal111 seller broker firm name blank');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 112, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Address:' && Math.abs(it.y - 626.62) < 1, RIGHT_MARGIN, 'ordinal112 seller broker address');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 113, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Broker Firm License No.:' && Math.abs(it.y - 612.1) < 1, RIGHT_MARGIN, 'ordinal113 seller broker firm license no');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 114, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 's Name:' && Math.abs(it.y - 597.7) < 1, RIGHT_MARGIN, 'ordinal114 seller broker associate name');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 115, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Team Name:' && Math.abs(it.y - 583.18) < 1, RIGHT_MARGIN, 'ordinal115 seller broker team name');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 116, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 's Email:' && Math.abs(it.y - 568.78) < 1, RIGHT_MARGIN, 'ordinal116 seller broker associate email');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 117, page: 11, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 's Phone No.:' && Math.abs(it.y - 554.38) < 1, 'ordinal117 seller broker associate phone');
    return textField(b.x + 2, b.y, b.width - 4, b.height);
  } },
  { ordinal: 118, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 's License No.:' && Math.abs(it.y - 554.38) < 1, RIGHT_MARGIN, 'ordinal118 seller broker associate license no');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 119, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Licensed Supervisor of Associate:' && Math.abs(it.y - 539.83) < 1, RIGHT_MARGIN, 'ordinal119 seller broker supervisor name');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 120, page: 11, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Phone No. of Licensed Supervisor:' && Math.abs(it.y - 525.43) < 1, 'ordinal120 seller broker supervisor phone');
    return textField(b.x + 2, b.y, b.width - 4, b.height);
  } },
  { ordinal: 121, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'License No.:' && Math.abs(it.y - 525.43) < 1, RIGHT_MARGIN, 'ordinal121 seller broker supervisor license no');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 122, page: 11, derive: async (items) => {
    const b = blankBeforeAnchorOnLine(items, (it) => it.str === '(Broker Firm)' && Math.abs(it.y - 496.51) < 1, 64.46, 'ordinal122 buyer broker firm name blank');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 123, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Address:' && Math.abs(it.y - 482.11) < 1, RIGHT_MARGIN, 'ordinal123 buyer broker address');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 124, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Broker Firm License No.:' && Math.abs(it.y - 467.71) < 1, RIGHT_MARGIN, 'ordinal124 buyer broker firm license no');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 125, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 's Name:' && Math.abs(it.y - 453.19) < 1, RIGHT_MARGIN, 'ordinal125 buyer broker associate name');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 126, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Team Name:' && Math.abs(it.y - 438.79) < 1, RIGHT_MARGIN, 'ordinal126 buyer broker team name');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 127, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 's Email:' && Math.abs(it.y - 424.39) < 1, RIGHT_MARGIN, 'ordinal127 buyer broker associate email');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 128, page: 11, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 's Phone No.:' && Math.abs(it.y - 409.87) < 1, 'ordinal128 buyer broker associate phone');
    return textField(b.x + 2, b.y, b.width - 4, b.height);
  } },
  { ordinal: 129, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Licensed Supervisor of Associate:' && Math.abs(it.y - 395.47) < 1, RIGHT_MARGIN, 'ordinal129 buyer broker supervisor name');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 130, page: 11, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Phone No. of Licensed Supervisor:' && Math.abs(it.y - 381.07) < 1, 'ordinal130 buyer broker supervisor phone');
    return textField(b.x + 2, b.y, b.width - 4, b.height);
  } },
  { ordinal: 131, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 's License No.:' && Math.abs(it.y - 409.87) < 1, RIGHT_MARGIN, 'ordinal131 buyer broker associate license no');
    return textField(b.x, b.y, b.width, b.height);
  } },
  { ordinal: 132, page: 11, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'License No.:' && Math.abs(it.y - 381.07) < 1, RIGHT_MARGIN, 'ordinal132 buyer broker supervisor license no');
    return textField(b.x, b.y, b.width, b.height);
  } },

  // ---- Page 12 ----
  { ordinal: 133, page: 12, derive: async (items) => {
    // PHASE B: repeated address-header duplicate, same technique as ordinal 34.
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Contract Concerning', 'ordinal133 page12 header address');
    return textField(b.x + 2, b.y, b.width - 4, 9, { fontSize: 7.5 });
  } },
];

/** Shared page-9 checkbox helper: "q" glyph immediately preceding a label substring, unique on the page. */
function checkboxMark9(items, labelSubstring, description, customPredicate) {
  const predicate = customPredicate || ((rest) => rest[0] && rest[0].str.includes(labelSubstring));
  return checkField(checkboxBeforeLabel(items, predicate, description));
}

async function buildFieldPlan(entriesByKey) {
  const manifestRows = loadManifestRows();
  const byOrdinal = new Map(manifestRows.map((r) => [r.ordinal, r]));
  const converted = [];
  const deferred = [];
  const pageItemsCache = new Map();

  for (const rowDef of ROW_DERIVATIONS) {
    const manifestRow = byOrdinal.get(rowDef.ordinal);
    if (!manifestRow) throw new Error(`ROW_DERIVATIONS references unknown ordinal ${rowDef.ordinal}`);

    if (rowDef.deferReason) {
      deferred.push({ ordinal: rowDef.ordinal, key: manifestRow.key, reason: rowDef.deferReason });
      continue;
    }

    const text = entriesByKey.get(manifestRow.key);
    if (text === undefined) {
      deferred.push({ ordinal: rowDef.ordinal, key: manifestRow.key, reason: `no projection-plan entry for key "${manifestRow.key}"` });
      continue;
    }
    if (text === '') {
      // A legitimately empty disposition (checkbox not selected, optional
      // text not applicable) -- still geometrically valid to place (drawing
      // an empty string draws nothing), so this counts as CONVERTED, not
      // deferred: the placement mechanism is proven even though this
      // particular synthetic scenario has nothing to show.
    }

    if (!pageItemsCache.has(rowDef.page)) {
      pageItemsCache.set(rowDef.page, await getPageItems(rowDef.page));
    }
    const items = pageItemsCache.get(rowDef.page);

    try {
      const geometry = await rowDef.derive(items);
      converted.push({
        ordinal: rowDef.ordinal,
        fieldKey: manifestRow.key,
        page: rowDef.page,
        destination: manifestRow.destination,
        duplicateOfOrdinal: manifestRow.duplicateNote && /ordinal (\d+)/i.test(manifestRow.duplicateNote)
          ? Number(manifestRow.duplicateNote.match(/ordinal (\d+)/i)[1])
          : undefined,
        value: text,
        ...geometry,
      });
    } catch (err) {
      deferred.push({ ordinal: rowDef.ordinal, key: manifestRow.key, reason: err.message });
    }
  }

  return { converted, deferred, manifestRows };
}

module.exports = { buildFieldPlan, ROW_DERIVATIONS };
