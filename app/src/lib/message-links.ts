/**
 * Message links -- B15-23 (INV-132), Walkthrough 2: "Email Expand worked,
 * but document URLs displayed as raw bracketed text: render usable labeled
 * links."
 *
 * Pure. No I/O, no React, no GHL. Splits a message body that is ALREADY
 * plain text into text and link segments; the page renders text segments as
 * React text (escaped) and link segments as anchors. Nothing here produces
 * HTML, so no markup in a body can reach the DOM as markup.
 *
 * Recognised shapes (the exact wire shape of GHL's document emails was not
 * captured, so each plain-text link convention is handled):
 *
 *   [label](https://...)   labeled link -> its own label
 *   [https://...]          bracketed URL -> "Open link (host)"
 *   <https://...>          angle-bracketed URL -> "Open link (host)"
 *   https://...            bare URL -> "Open link (host)"
 *
 * Only http: and https: URLs become links. Anything else stays text,
 * character for character, and joining every segment's source text
 * reproduces the body exactly.
 */

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; href: string; label: string; source: string };

const LINK_PATTERN =
  /\[([^\[\]\n]{1,200})\]\((https?:\/\/[^\s()<>]+)\)|\[(https?:\/\/[^\s\[\]<>]+)\]|<(https?:\/\/[^\s<>]+)>|(https?:\/\/[^\s<>\[\]]+)/gi;

/** Trailing sentence punctuation a bare URL should not swallow. */
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

/** The URL's canonical href when it is http(s) with a host, else null. */
export function safeHttpHref(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.href;
}

/** Human-readable label for a URL that carries no label of its own. */
export function linkLabel(href: string): string {
  const host = new URL(href).hostname.replace(/^www\./i, "");
  return `Open link (${host})`;
}

export function splitMessageLinks(body: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let text = "";
  const flushText = () => {
    if (text) segments.push({ kind: "text", text });
    text = "";
  };

  let last = 0;
  for (const match of body.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    text += body.slice(last, start);
    let source = match[0];
    let trailing = "";
    let raw: string;
    let label: string | null = null;

    if (match[2] !== undefined) {
      raw = match[2];
      label = match[1].trim() || null;
    } else if (match[3] !== undefined) {
      raw = match[3];
    } else if (match[4] !== undefined) {
      raw = match[4];
    } else {
      raw = match[5];
      trailing = (raw.match(TRAILING_PUNCTUATION) ?? [""])[0];
      // A closing parenthesis ends the URL only when the URL opened none.
      if (!trailing && raw.endsWith(")") && !raw.includes("(")) trailing = ")";
      raw = raw.slice(0, raw.length - trailing.length);
      source = raw;
    }

    const href = safeHttpHref(raw);
    if (href) {
      flushText();
      segments.push({ kind: "link", href, label: label ?? linkLabel(href), source });
      text += trailing;
    } else {
      text += match[0];
    }
    last = start + match[0].length;
  }
  text += body.slice(last);
  flushText();
  return segments;
}
