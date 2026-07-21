/**
 * test/bench/03_dup.js — Benchmark the deduplication layer (src/dup.js).
 *
 * Dup.check() + Dup.track() are called on EVERY message received:
 *   - incoming from network: hear.one() calls dup_check(id)
 *   - universe() calls dup.check(tmp) then dup.track(tmp)
 *   - ham() calls root.dup.track(id)
 *
 * Under load this is thousands of string→object hash-map lookups per second.
 *
 * The data structure is: dup.s = {} (plain Object, keyed by message ID string)
 *
 * WASM candidacy:
 *   - String.hash (DJB2) called in Dup for hash-based dedup lookup
 *   - A flat WASM hash-set (open-address, robin-hood) could be 3-5x faster
 *     than V8 object property lookups on random-looking keys.
 *   - But: the JS GC overhead from creating {was: timestamp} per-entry may
 *     dominate. Measure first.
 *
 * Run:
 *   node --experimental-vm-modules test/bench/03_dup.js
 */

import { suite, bench, run } from "./harness.js";
import "../../src/shim.js";
import DupFn from "../../src/dup.js";

const Dup = DupFn.default ?? DupFn;
const dup = Dup();

// ── Pre-populate with N existing entries ─────────────────────────────────────
const PRE = 500;
for (let i = 0; i < PRE; i++) dup.track(`existing_${i}`);

// Fresh IDs that will be seen for first time
let counter = PRE;
function freshId() { return `id_${counter++}`; }

suite("Dup (current JS plain-object map)", () => {
  bench("check existing (hit)", () => dup.check("existing_1"));
  bench("check missing (miss)", () => {
    const id = freshId();
    return dup.check(id);
  });
  bench("track new id", () => {
    const id = freshId();
    dup.track(id);
  });
  bench("check + track (full pipeline per msg)", () => {
    const id = freshId();
    if (!dup.check(id)) dup.track(id);
  });
});

// ── Baseline: plain Map instead of Object ────────────────────────────────────
// V8 optimises Map<string,T> better than Object for dynamic string keys
const map = new Map();
for (let i = 0; i < PRE; i++) map.set(`existing_${i}`, { was: Date.now() });

suite("Map<string,obj> (V8 Map baseline)", () => {
  bench("has existing (hit)", () => map.has("existing_1"));
  bench("has missing (miss)", () => map.has(freshId()));
  bench("set new", () => { const id = freshId(); map.set(id, { was: Date.now() }); });
  bench("has + set (full pipeline)", () => {
    const id = freshId();
    if (!map.has(id)) map.set(id, { was: Date.now() });
  });
});

// ── Baseline: Set<string> (no timestamp overhead, cheapest possible) ─────────
const set = new Set();
for (let i = 0; i < PRE; i++) set.add(`existing_${i}`);

suite("Set<string> (minimal hit/miss)", () => {
  bench("has existing", () => set.has("existing_1"));
  bench("has missing", () => set.has(freshId()));
  bench("add new", () => { set.add(freshId()); });
  bench("has + add (full pipeline)", () => {
    const id = freshId();
    if (!set.has(id)) set.add(id);
  });
});

// ── String.hash DJB2 (called internally by shim.js) ─────────────────────────
suite("String.hash DJB2 (sync overhead)", () => {
  bench("9-char random-ish ID", () => String.hash("aBcDeFgHi"));
  bench("24-char soul key", () => String.hash("aBcDeFgHiJkLmNoPqRsTuVwX"));
});

await run({ warmup: 500, iters: 5000 });
