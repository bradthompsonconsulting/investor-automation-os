import { createHash } from "node:crypto";
/** SHA-256 hex. The one digest used by every ownership key. */
export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
/** Canonical JSON (sorted keys) for digests of structured records. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value as object).sort().filter((k) => (value as any)[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical((value as any)[k])).join(",") + "}";
}
