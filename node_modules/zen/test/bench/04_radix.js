/**
 * test/bench/04_radix.js — Benchmark the Radix tree (lib/radix.js).
 *
 * The Radix tree is the in-memory storage layer underneath Radisk.
 * It is used in:
 *   - radisk.js: in-memory cache before disk flush
 *   - Storage adapters: range queries with Radix.map()
 *
 * Operations to measure:
 *   - Insert (write to radix)
 *   - Lookup (read by exact key)
 *   - Prefix scan (Radix.map with start/end bounds)
 *
 * WASM candidacy:
 *   - The Radix tree is a pointer-heavy JS object tree. WASM can't help here
 *     without a full rewrite into a flat WASM memory layout (like an arena
 *     allocated trie). That's a large project.
 *   - More practical: a WASM flat key-value store (hash map with linear probing)
 *     for the hot path of exact-key lookups could help.
 *   - Measure first to know if radix is actually the bottleneck.
 *
 * Run:
 *   node --experimental-vm-modules test/bench/04_radix.js
 */

import { suite, bench, run } from "./harness.js";
import RadixFn from "../../lib/radix.js";

const Radix = RadixFn.default ?? RadixFn;

// ── Pre-populate radix with N keys ───────────────────────────────────────────
const N = 1000;
const rad = Radix();
const keys = Array.from({ length: N }, (_, i) => `user/${String(i).padStart(6, "0")}/name`);
keys.forEach((k, i) => rad(k, `value_${i}`));

// ── Insert ────────────────────────────────────────────────────────────────────
let insertCounter = N;
suite("Radix insert", () => {
  bench("insert 1 key (deep path)", () => {
    rad(`user/${insertCounter++}/profile/name`, "Alice");
  });
  bench("insert 1 key (shallow key)", () => {
    rad(`k${insertCounter++}`, "v");
  });
});

// ── Exact lookup ─────────────────────────────────────────────────────────────
suite("Radix exact lookup", () => {
  bench("lookup existing (middle)", () => rad("user/000500/name"));
  bench("lookup first key", () => rad("user/000000/name"));
  bench("lookup missing key", () => rad("user/999999/missing"));
});

// ── Prefix scan (Radix.map) ───────────────────────────────────────────────────
suite("Radix.map prefix scan", () => {
  let count;
  bench("scan 10 results (narrow range)", () => {
    count = 0;
    Radix.map(rad, () => { count++; }, { start: "user/000000", end: "user/000009" });
  });
  bench("scan 100 results (medium range)", () => {
    count = 0;
    Radix.map(rad, () => { count++; }, { start: "user/000000", end: "user/000099" });
  });
  bench("scan all 1000 results", () => {
    count = 0;
    Radix.map(rad, () => { count++; });
  });
});

// ── Native Map comparison (flat, no prefix support) ──────────────────────────
const nativeMap = new Map(keys.map((k, i) => [k, `value_${i}`]));
let nativeCounter = N;

suite("Map<string,string> comparison baseline", () => {
  bench("set 1 key", () => { nativeMap.set(`k${nativeCounter++}`, "v"); });
  bench("get existing", () => nativeMap.get("user/000500/name"));
  bench("get missing", () => nativeMap.get("user/999999/missing"));
});

await run({ warmup: 300, iters: 2000 });
