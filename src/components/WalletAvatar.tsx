// Character avatar per wallet (DiceBear "adventurer", seeded by the address): Nansen has no
// profile pictures, so each wallet gets a stable, recognisable face across chart bubbles, tables
// and legends. Generated locally; no request leaves the browser.
import { createAvatar } from "@dicebear/core";
import * as adventurer from "@dicebear/adventurer";

const BACKGROUNDS = ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf", "c7f0d8", "f9e6a6"];
const cache = new Map<string, string>();

/** data: URI of the wallet's avatar SVG. */
export function avatarUri(address: string): string {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const uri = createAvatar(adventurer, { seed: key, size: 64, backgroundColor: BACKGROUNDS }).toDataUri();
  cache.set(key, uri);
  return uri;
}

/** CSS background for places that paint the avatar themselves (chart bubbles). */
export function avatarBackground(address: string): string {
  return `url("${avatarUri(address)}") center / cover no-repeat`;
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
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUri(address)}
      alt={title ?? ""}
      title={title}
      width={size}
      height={size}
      className="inline-block rounded-full shrink-0 bg-bezel"
      style={{ width: size, height: size, boxShadow: `0 0 0 2px ${border}` }}
    />
  );
}
