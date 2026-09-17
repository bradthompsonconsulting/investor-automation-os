export const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Twilio-Signature",
};

export function json(statusCode: number, body: unknown) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function formParams(event: any): Record<string, string> {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : String(event.body ?? "");
  return Object.fromEntries(new URLSearchParams(raw).entries());
}

export function externalRequestUrl(event: any, env = process.env): string {
  if (event.rawUrl) return String(event.rawUrl);
  const base = env.IAOS_VOICE_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!base) return "";
  const path = String(event.path ?? event.rawPath ?? "");
  const query = event.rawQuery ? `?${event.rawQuery}` : "";
  return `${base}${path}${query}`;
}

export function twilioSignature(event: any): string {
  return String(event.headers?.["x-twilio-signature"] ?? event.headers?.["X-Twilio-Signature"] ?? "");
}

export function safeJsonBody(event: any): Record<string, unknown> {
  try { return JSON.parse(String(event.body ?? "{}")); }
  catch { throw new Error("Invalid JSON body"); }
}

export function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}
