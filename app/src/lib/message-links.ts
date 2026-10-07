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
 *   [label](https://...)   labeled link -> "label (host)"
 *   [https://...]          bracketed URL -> "Open link (host)"
 *   <https://...>          angle-bracketed URL -> "Open link (host)"
 *   https://...            bare URL -> "Open link (host)"
 *
 * THE REAL HOST IS ALWAYS VISIBLE (Spock review, 2026-10-07). Inbound email
 * is sender-controlled, so a label is never shown alone: it always carries
 * the destination's actual host, and a label that itself looks like a URL
 * or domain is dropped for "Open link (host)" -- "[https://chase.com]
 * (https://evil.example/x)" can never read as chase.com.
 *
 * Parentheses: a URL may contain balanced parentheses, one level deep
 * ("https://a.com/b_(c)"), in every shape; an unbalanced trailing ")" is
 * treated as surrounding text.
 *
 * Only http: and https: URLs become links. Anything else stays text,
 * character for character, and joining every segment's source text
 * reproduces the body exactly.
 */

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; href: string; label: string; source: string };

/** One URL character run, allowing one level of balanced parentheses. */
const URL_BODY = String.raw`(?:[^\s()<>\[\]]|\([^\s()<>\[\]]*\))+`;

const LINK_PATTERN = new RegExp(
  String.raw`\[([^\[\]\n]{1,200})\]\((https?:\/\/${URL_BODY})\)` +
  String.raw`|\[(https?:\/\/${URL_BODY})\]` +
  String.raw`|<(https?:\/\/${URL_BODY})>` +
  String.raw`|(https?:\/\/[^\s<>\[\]]+)`,
  "gi",
);

/** Trailing sentence punctuation a bare URL should not swallow. */
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

/**
 * A label that reads as a URL or a domain ("https://x", "www.x",
 * "chase.com", "chase.com/login"). Such a label is never shown, because it
 * could name a destination other than the real one.
 */
const URL_LIKE_LABEL = /:\/\/|^www\.|^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[\/?#]\S*)?$/i;

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

function hostOf(href: string): string {
  return new URL(href).hostname.replace(/^www\./i, "");
}

/** Human-readable label for a URL that carries no label of its own. */
export function linkLabel(href: string): string {
  return `Open link (${hostOf(href)})`;
}

/**
 * The visible text for a sender-supplied label: the label plus the real
 * host, or "Open link (host)" when the label is empty or looks like a URL
 * or domain.
 */
export function labeledLinkText(label: string, href: string): string {
  const text = label.trim();
  if (!text || URL_LIKE_LABEL.test(text)) return linkLabel(href);
  return `${text} (${hostOf(href)})`;
}

/** Splits a bare URL from trailing punctuation and unbalanced ")" that belong to the sentence. */
function trimBareUrl(raw: string): { url: string; trailing: string } {
  let url = raw;
  let trailing = "";
  for (;;) {
    const punct = url.match(TRAILING_PUNCTUATION);
    if (punct) {
      trailing = punct[0] + trailing;
      url = url.slice(0, url.length - punct[0].length);
      continue;
    }
    const opens = (url.match(/\(/g) ?? []).length;
    const closes = (url.match(/\)/g) ?? []).length;
    if (url.endsWith(")") && closes > opens) {
      trailing = ")" + trailing;
      url = url.slice(0, -1);
      continue;
    }
    return { url, trailing };
  }
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
      label = match[1];
    } else if (match[3] !== undefined) {
      raw = match[3];
    } else if (match[4] !== undefined) {
      raw = match[4];
    } else {
      ({ url: raw, trailing } = trimBareUrl(match[5]));
      source = raw;
    }

    const href = raw ? safeHttpHref(raw) : null;
    if (href) {
      flushText();
      segments.push({ kind: "link", href, label: label === null ? linkLabel(href) : labeledLinkText(label, href), source });
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
