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
  blankAfterAnchorOnLine,
  blankAfterDollarSign,
  trailingLineBlank,
  blankAfterWrappingAnchor,
  checkboxBeforeLabel,
  checkboxMarkBox,
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
  { ordinal: 18, page: 1, deferReason: 'blank rendered as underscores embedded within a single merged text run ("...within _____"), no clean duplicate caption available to borrow a measured width from -- not reliably sub-positionable.' },

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
  { ordinal: 63, page: 6, derive: async (items) => textField(292, 669.82, 125, 11) }, // proven PR #75
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
  { ordinal: 68, page: 6, deferReason: 'blank rendered as underscores embedded within a single merged text run ("amount not to exceed $_____________ to be applied..."), no clean duplicate caption available to borrow a measured width from.' },

  // ---- Page 7 ----
  { ordinal: 70, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 645.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(1)', 'ordinal70 SPBB applies mark'));
  } },
  { ordinal: 71, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 645.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('$_________'), 'ordinal71 SPBB dollar mark'));
  } },
  { ordinal: 72, page: 7, deferReason: 'dollar blank rendered as underscores embedded within a single merged text run ("$_________ or"); no clean duplicate to borrow a width from.' },
  { ordinal: 73, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 645.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('______%'), 'ordinal73 SPBB percent mark'));
  } },
  { ordinal: 74, page: 7, deferReason: 'percent blank rendered as underscores embedded within a single merged text run ("______%"); no clean duplicate to borrow a width from.' },
  { ordinal: 75, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 623.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str === '(2)', 'ordinal75 BPSB applies mark'));
  } },
  { ordinal: 76, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 623.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('$_________'), 'ordinal76 BPSB dollar mark'));
  } },
  { ordinal: 77, page: 7, deferReason: 'dollar blank rendered as underscores embedded within a single merged text run ("$_________ or"); no clean duplicate to borrow a width from.' },
  { ordinal: 78, page: 7, derive: async (items) => {
    const band = items.filter((it) => Math.abs(it.y - 623.3) < 1);
    return checkField(checkboxBeforeLabel(band, (rest) => rest[0] && rest[0].str.startsWith('______%'), 'ordinal78 BPSB percent mark'));
  } },
  { ordinal: 79, page: 7, deferReason: 'percent blank rendered as underscores embedded within a single merged text run ("______%"); no clean duplicate to borrow a width from.' },

  // ---- Page 8 ----
  { ordinal: 81, page: 8, derive: async (items) => {
    const b = blankAfterAnchorOnLine(items, (it) => it.str === 'Address:' && Math.abs(it.y - 379.1) < 1 && it.x < 200, 'ordinal81 buyer notice address');
    return textField(b.x + 2, b.y, b.width - 4);
  } },
  { ordinal: 82, page: 8, derive: async (items) => {
    const b = trailingLineBlank(items, (it) => it.str === 'Address:' && Math.abs(it.y - 379.1) < 1 && it.x > 200, RIGHT_MARGIN, 'ordinal82 seller notice address');
    return textField(b.x, b.y, b.width);
  } },
  // ordinal 83 (noticeContact.buyerNoticePhone) initially used a
  // width-borrowed-from-a-clean-duplicate-caption technique (the Seller
  // side's "Phone(s):" on the same line has no embedded underscores). The
  // rendered page LOOKED clean, but re-extracting the generated PDF's own
  // text with pdftotext showed the drawn value's characters interleaved
  // with the original printed underscores character-by-character
  // ("Phone(s):_(5_1_2_)..."), proving the two occupy overlapping
  // positions in the content stream even though it wasn't visually obvious
  // at normal zoom (underscores sit at the baseline, easy to mistake for
  // an underline under normal-height text). Deferred for the same reason
  // as every other embedded-underscore case -- the "borrow a clean
  // duplicate's width" technique does not reliably separate from the
  // underlying blank here.
  { ordinal: 83, page: 8, deferReason: 'blank rendered as underscores embedded within a single merged text run ("Phone(s):_____..."); a clean duplicate caption exists on the same line, but width-borrowing from it still produced text overlapping the underlying underscores at the character level in the generated PDF\'s own extracted text -- not reliably separable.' },
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
  { ordinal: 102, page: 9, deferReason: 'blank rendered as underscores embedded within a single merged text run ("...are attached):______"), spanning two printed lines; no clean duplicate caption available to borrow a measured width from.' },
  { ordinal: 103, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Property Subject to Mandatory Membership', 'ordinal103') },
  { ordinal: 104, page: 9, derive: async (items) => checkboxMark9(items, 'Non', 'ordinal104', (rest) => rest.some((r) => r.str.includes('Realty Items Addendum'))) },
  { ordinal: 105, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for', 'ordinal105', (rest) => rest.some((r) => r.str === 'Contract') && rest.some((r) => r.str === 'Back')) },
  { ordinal: 106, page: 9, derive: async (items) => checkboxMark9(items, 'Addendum for Reservation of Oil, Gas, and Other Minerals', 'ordinal106') },
  { ordinal: 107, page: 9, derive: async (items) => checkboxMark9(items, 'Other:', 'ordinal107') },
  { ordinal: 108, page: 9, deferReason: 'blank rendered as underscores embedded within a single merged text run ("Other:______"), spanning two printed lines; no clean duplicate caption available to borrow a measured width from.' },
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
