/**
 * Storage correction (plan v6 §5) -- the modern-runtime REQUEST ADAPTER.
 *
 * The five endpoints become `export default async (req: Request, context) =>
 * Response` (no `config.path`, so they stay at /.netlify/functions/<name>), and
 * `connectLambda` is gone. `legacyEventFrom(req)` builds the event the UNCHANGED
 * auth, origin and scope helpers already accept; equivalence means the same
 * allow/refuse decision, status and body as those helpers on a hand-built
 * Lambda event (the oracle).
 *
 * Tightenings never change the ORDER of refusals: a request this adapter
 * distrusts (a repeated query name, a non-identity Content-Encoding, a wrong
 * Content-Type on a session endpoint, invalid UTF-8 or a BOM, an oversize body)
 * is marked `isBase64Encoded: true` with a body that cannot parse, so each
 * endpoint's OWN parse step refuses it exactly where it refuses today --
 * after method, authentication and origin.
 *
 * Recorded limitation: the Fetch `Request` normalizes the method token (a raw
 * lowercase `post` arrives as `POST`); the raw method is not observable here.
 */
export type LegacyEvent = {
  httpMethod: string;
  headers: Record<string, string>;
  multiValueHeaders: Record<string, string[]>;
  queryStringParameters: Record<string, string>;
  body: string | null;
  isBase64Encoded: boolean;
  /** Why the adapter distrusted the request (tests only; never logged). */
  tightened?: string;
};
export type LambdaResult = { statusCode: number; headers?: Record<string, string>; body: string };

/** Netlify's synchronous request-body limit (pinned in a test row). */
export const PLATFORM_BODY_LIMIT_BYTES = 6 * 1024 * 1024;
const POISON = "\u0000";

export async function legacyEventFrom(req: Request, opts: { requireJson: boolean; maxBytes?: number }): Promise<LegacyEvent> {
  const headers: Record<string, string> = {};
  const multiValueHeaders: Record<string, string[]> = {};
  req.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; multiValueHeaders[name.toLowerCase()] = [value]; });
  const url = new URL(req.url);
  const queryStringParameters: Record<string, string> = {};
  let tightened: string | undefined;
  const seen = new Set<string>();
  for (const [k, v] of url.searchParams) {
    if (seen.has(k)) tightened = "repeated_query";
    seen.add(k);
    queryStringParameters[k] = v;
  }
  const encoding = (headers["content-encoding"] ?? "identity").trim().toLowerCase();
  if (encoding !== "identity") tightened = tightened ?? "content_encoding";
  const max = opts.maxBytes ?? PLATFORM_BODY_LIMIT_BYTES;
  const declared = Number(headers["content-length"]);
  let body: string | null = null;
  if (Number.isFinite(declared) && declared > max) { tightened = tightened ?? "too_large"; }
  else if (req.body !== null && req.method !== "GET" && req.method !== "HEAD") {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > max) tightened = tightened ?? "too_large";
    else if (bytes.byteLength > 0) {
      try { body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { tightened = tightened ?? "invalid_utf8"; }
      if (body !== null && body.charCodeAt(0) === 0xfeff) tightened = tightened ?? "bom";
    }
  }
  if (opts.requireJson && req.method === "POST") {
    const ct = (headers["content-type"] ?? "").trim();
    if (!/^application\/json(\s*;\s*charset=utf-8)?$/i.test(ct)) tightened = tightened ?? "content_type";
  }
  if (tightened) return { httpMethod: req.method, headers, multiValueHeaders, queryStringParameters, body: POISON, isBase64Encoded: true, tightened };
  return { httpMethod: req.method, headers, multiValueHeaders, queryStringParameters, body, isBase64Encoded: false };
}

/** Converts the unchanged handler result. A 204 has no body and no headers (byte-identical). */
export function toResponse(r: LambdaResult, extraHeaders?: Record<string, string>): Response {
  if (r.statusCode === 204) return new Response(null, { status: 204 });
  const h = new Headers();
  for (const [k, v] of Object.entries(r.headers ?? {})) h.set(k, v);
  for (const [k, v] of Object.entries(extraHeaders ?? {})) h.set(k, v);
  return new Response(r.body, { status: r.statusCode, headers: h });
}
export const json = (statusCode: number, data: unknown): LambdaResult => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });

/** The client's echoed activation id (session endpoints). */
export const ACTIVATION_HEADER = "x-iaos-activation";
export function echoedActivation(event: LegacyEvent): { activationId: string | null } {
  const v = event.headers[ACTIVATION_HEADER];
  return { activationId: typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null };
}
