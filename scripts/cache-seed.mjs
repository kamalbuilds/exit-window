#!/usr/bin/env node
// Copies the on-disk Nansen cache (.cache/nansen, populated by real network calls made during
// `npm run dev`) into data/nansen-seed - a committed, read-only fallback so a fresh clone or a
// cold Vercel deploy has cached responses for public onchain data before it ever spends a
// Nansen credit. Never run against anything but real responses: this script only copies files
// nansen.ts itself already wrote, it never fabricates cache entries.
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const SRC = path.join(process.cwd(), ".cache", "nansen");
const DEST = path.join(process.cwd(), "data", "nansen-seed");

async function main() {
  await mkdir(DEST, { recursive: true });
  let files;
  try {
    files = await readdir(SRC);
  } catch {
    console.log(`No disk cache at ${SRC} yet - run the app against a real NANSEN_API_KEY first.`);
    return;
  }
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  for (const f of jsonFiles) {
    await cp(path.join(SRC, f), path.join(DEST, f));
  }
  console.log(`Seeded ${jsonFiles.length} cache entr${jsonFiles.length === 1 ? "y" : "ies"} into ${DEST}`);
}

main();
