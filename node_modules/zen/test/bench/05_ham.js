/**
 * test/bench/05_ham.js — Benchmark the HAM CRDT conflict resolution.
 *
 * HAM (Hypothetical Amnesia Machine) is called on EVERY key in EVERY put message.
 * It decides which value wins in concurrent writes using state timestamps.
 *
 * From root.js:
 *   ham(val, key, soul, state, msg)
 *   - Reads state timestamp from graph (state_is)
 *   - Compares state vs was (known state)
 *   - Calls state_ify to merge into graph
 *
 * Also tested here:
 *   - State() — generates monotonic timestamps (called per-key in every put)
 *   - State.ify() — merges a key+value+state into a node object
 *   - State.is()  — reads the state timestamp for a key
 *
 * WASM candidacy:
 *   - State() is trivially fast JS math — no WASM benefit.
 *   - State.ify / State.is are property accesses — no WASM benefit.
 *   - HAM comparison is pure arithmetic (<, ===, >) — tiny, no benefit.
 *   - The REAL cost in put() is Object.keys(put) on large graph objects.
 *     A WASM-side key iteration could help but only with full schema change.
 *
 * Run:
 *   node --experimental-vm-modules test/bench/05_ham.js
 */

import { suite, bench, run } from "./harness.js";
import "../../src/shim.js";
import StateFn from "../../src/state.js";

const State = StateFn.default ?? StateFn;

// ── State() — monotonic clock ─────────────────────────────────────────────────
suite("State() monotonic clock", () => {
  bench("State() call", () => State());
  bench("State.is(node, key)", () => {
    const node = { _: { ">": { name: 1713360000000 } } };
    return State.is(node, "name");
  });
  bench("State.ify(node, key, s, v)", () => {
    const node = {};
    return State.ify(node, "name", State(), "Alice", "~soul~");
  });
});

// ── HAM comparison logic (extracted from root.js) ────────────────────────────
// This runs for EVERY key in EVERY put message. Measure the core comparison.
suite("HAM comparison (core logic)", () => {
  const state = 1713360000000;
  const was = state - 1;
  const now = state + 1;

  bench("state > now (future — defer)", () => {
    // Simulates the setTimeout branch in ham()
    const future = state > now;
    return future;
  });

  bench("state < was (old — skip)", () => {
    const old = state < was;
    return old;
  });

  bench("state === was (same — check val)", () => {
    const same = state === was;
    return same;
  });

  bench("state_ify (merge winner into graph)", () => {
    const graph = {};
    // Simulates what state_ify does: Object property write + metadata update
    const soul = "test~soul";
    const key = "name";
    const val = "Alice";
    if (!graph[soul]) graph[soul] = { _: { "#": soul, ">": {} } };
    graph[soul]._[">"][key] = state;
    graph[soul][key] = val;
  });
});

// ── Object.keys on put data (actual bottleneck in put()) ──────────────────────
// put() calls Object.keys(put) to iterate all souls in a message.
// With large batches this is non-trivial.
suite("Object.keys on put payloads", () => {
  const small = Object.fromEntries(Array.from({ length: 1 }, (_, i) => [`soul${i}`, {}]));
  const medium = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`soul${i}`, {}]));
  const large = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`soul${i}`, {}]));

  bench("Object.keys (1 soul)", () => Object.keys(small));
  bench("Object.keys (10 souls)", () => Object.keys(medium));
  bench("Object.keys (100 souls)", () => Object.keys(large));

  // Also measure Map.keys() as a V8-optimized alternative
  const mapMedium = new Map(Array.from({ length: 10 }, (_, i) => [`soul${i}`, {}]));
  bench("Map.keys() iter 10 (comparison)", () => [...mapMedium.keys()]);
});

// ── Full put pipeline cost estimate ──────────────────────────────────────────
// How much does a typical put() cost at the pure-JS level?
// (excludes storage I/O, only the in-memory HAM + merge step)
import ZEN from "../../zen.js";

const zen = new ZEN({ peers: [], localStorage: false, radisk: false });

suite("ZEN put() end-to-end (in-memory only)", () => {
  let n = 0;
  bench("put 1 key into graph", () =>
    new Promise((res) => {
      zen.get(`bench~node~${n}`).get("val").put(`v${n++}`, res);
    }),
  );
});

await run({ warmup: 100, iters: 500 });
