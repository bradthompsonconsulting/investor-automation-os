// ── Phone formatting (§5.1 phone display) ───────────────────────────────────────
// DISPLAY ONLY. The raw stored E.164 value is never mutated — this is a pure
// render-time transform. A value matching +1 followed by EXACTLY 10 digits renders
// as area-prefix-line (214-914-6151, country code dropped); anything else — wrong
// length, non-US, malformed, empty — returns the input unchanged. Search reads the
// raw value, not this output (§5.1 search-unaffected invariant).
export function formatPhone(raw: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}
