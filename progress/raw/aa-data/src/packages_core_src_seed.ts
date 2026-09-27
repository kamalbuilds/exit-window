/** A seed is a short label; anything else is squeezed to [A-Za-z0-9_-] and 32 chars so it survives a URL. No Node imports here. */
export function normalizeSeed(seed: string | undefined | null): string {
  const s = (seed ?? "")
    .toString()
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 32);
  return s || "";
}
