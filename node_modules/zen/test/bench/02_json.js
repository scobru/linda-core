/**
 * test/bench/02_json.js — Benchmark JSON parsing in the zen message pipeline.
 *
 * JSON is ZEN's highest-volume operation — every peer message is JSON.
 * Mark added YSON (Yielding JSON) precisely because JSON.parse blocks the CPU.
 *
 * Candidates for WASM:
 *   - JSON.parse (simd-json / simdjson approach in WASM)
 *   - JSON.stringify
 *
 * We need to know the current baseline before proposing WASM.
 * Also tests YSON (lib/yson.js) which does async chunk parsing.
 *
 * Run:
 *   node --experimental-vm-modules test/bench/02_json.js
 */

import { suite, bench, run } from "./harness.js";

// ── Payloads ──────────────────────────────────────────────────────────────────
// Typical ZEN graph node: one soul, a few keys, state metadata
const SMALL_NODE = JSON.stringify({
  "#": "abc123",
  ".": "name",
  ":": "Alice",
  ">": 1713360000000,
});

// A batch of 10 graph updates — typical peer message
const BATCH_10 = JSON.stringify(
  Array.from({ length: 10 }, (_, i) => ({
    "#": `msg${i}`,
    put: { [`soul${i}`]: { _: { "#": `soul${i}`, ">": { name: 1713360000000 } }, name: `value${i}` } },
  })),
);

// A large graph: 100 nodes, 10 keys each
const LARGE_GRAPH = JSON.stringify(
  Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      `soul${i}`,
      {
        _: { "#": `soul${i}`, ">": Object.fromEntries(Array.from({ length: 10 }, (_, j) => [`k${j}`, 1713360000000])) },
        ...Object.fromEntries(Array.from({ length: 10 }, (_, j) => [`k${j}`, `value_${i}_${j}`])),
      },
    ]),
  ),
);

console.log(`Payloads: small=${SMALL_NODE.length}B  batch=${BATCH_10.length}B  large=${LARGE_GRAPH.length}B`);

// ── Native JSON (synchronous) ─────────────────────────────────────────────────
suite("JSON.parse (native sync)", () => {
  bench("small node (~60B)", () => JSON.parse(SMALL_NODE));
  bench("batch 10 msgs (~600B)", () => JSON.parse(BATCH_10));
  bench("large graph (~15KB)", () => JSON.parse(LARGE_GRAPH));
});

suite("JSON.stringify (native sync)", () => {
  const small = JSON.parse(SMALL_NODE);
  const large = JSON.parse(LARGE_GRAPH);
  bench("small node", () => JSON.stringify(small));
  bench("large graph (~15KB)", () => JSON.stringify(large));
});

// ── ZEN's async JSON wrapper (shim.js) ───────────────────────────────────────
import "../../src/shim.js"; // installs JSON.parseAsync
import shimMod from "../../src/shim.js";
const shim = shimMod;

suite("JSON.parseAsync (ZEN shim, via Promise)", () => {
  bench("small node (~60B)", () =>
    new Promise((res, rej) => JSON.parseAsync(SMALL_NODE, (e, v) => e ? rej(e) : res(v))),
  );
  bench("batch 10 msgs (~600B)", () =>
    new Promise((res, rej) => JSON.parseAsync(BATCH_10, (e, v) => e ? rej(e) : res(v))),
  );
  bench("large graph (~15KB)", () =>
    new Promise((res, rej) => JSON.parseAsync(LARGE_GRAPH, (e, v) => e ? rej(e) : res(v))),
  );
});

// ── YSON (lib/yson.js) — chunk async JSON parser ─────────────────────────────
// YSON is a CPU-yielding JSON parser that processes in chunks via setTimeout.turn
// Used via radisk when reading from storage.
import "../../lib/yson.js"; // installs JSON.parseAsync override

suite("YSON.parseAsync (lib/yson.js chunk parser)", () => {
  bench("small node (~60B)", () =>
    new Promise((res, rej) => JSON.parseAsync(SMALL_NODE, (e, v) => e ? rej(e) : res(v))),
  );
  bench("batch 10 msgs (~600B)", () =>
    new Promise((res, rej) => JSON.parseAsync(BATCH_10, (e, v) => e ? rej(e) : res(v))),
  );
  bench("large graph (~15KB)", () =>
    new Promise((res, rej) => JSON.parseAsync(LARGE_GRAPH, (e, v) => e ? rej(e) : res(v))),
  );
});

await run({ warmup: 200, iters: 1000 });
