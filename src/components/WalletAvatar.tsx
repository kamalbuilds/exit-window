// Deterministic avatar per wallet: two hues and an angle derived from the address, plus the
// cohort ring. Nansen has no profile pictures, so this is how a wallet stays recognisable across
// the chart bubbles, tables and legend.

function hash(address: string): number {
  let h = 2166136261;
  const s = address.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarColors(address: string): { a: string; b: string; angle: number } {
  const h = hash(address);
  const hueA = h % 360;
  const hueB = (hueA + 40 + ((h >> 9) % 120)) % 360;
  return { a: `hsl(${hueA} 70% 58%)`, b: `hsl(${hueB} 65% 38%)`, angle: (h >> 17) % 360 };
}

export function avatarBackground(address: string): string {
  const { a, b, angle } = avatarColors(address);
  return `linear-gradient(${angle}deg, ${a}, ${b})`;
}

/** Circular avatar; `ring` colours the border (lume for buys, late for sells, rule by default). */
export function WalletAvatar({
  address,
  size = 24,
  ring,
  title,
}: {
  address: string;
  size?: number;
  ring?: "lume" | "late" | "accent" | null;
  title?: string;
}) {
  const border = ring === "lume" ? "var(--color-lume)" : ring === "late" ? "var(--color-late)" : ring === "accent" ? "var(--color-accent)" : "var(--color-rule)";
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        background: avatarBackground(address),
        boxShadow: `0 0 0 2px ${border}`,
      }}
    />
  );
}
