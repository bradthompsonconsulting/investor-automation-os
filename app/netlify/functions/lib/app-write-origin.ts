/** Exact browser Origin boundary; authentication remains a separate gate. */
export function requireAppWriteOrigin(event: any, env = process.env): void {
  const configured = env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
  function valid(value: unknown): value is string {
    if (typeof value !== "string" || !value) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value &&
        !url.username && !url.password && !value.includes("*");
    } catch { return false; }
  }
  if (!valid(configured)) throw new Error("Write origin is not configured");
  const entries = Object.entries(event.headers ?? {})
    .filter(([name]) => name.toLowerCase() === "origin");
  if (entries.length !== 1) throw new Error("One Origin is required");
  const origin = entries[0][1];
  if (!valid(origin) || origin !== configured) {
    throw new Error("Write origin refused");
  }
  const multi = Object.entries(event.multiValueHeaders ?? {})
    .filter(([name]) => name.toLowerCase() === "origin");
  if (multi.length > 1 || (multi.length === 1 &&
      (!Array.isArray(multi[0][1]) || multi[0][1].length !== 1 ||
       multi[0][1][0] !== origin))) {
    throw new Error("Ambiguous Origin");
  }
}
