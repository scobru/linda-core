/**
 * test/bench/harness.js — minimal micro-benchmark harness.
 *
 * Design goals:
 *  - Zero external dependencies.
 *  - Warm JIT before measuring (configurable).
 *  - Report ops/sec and μs/op.
 *  - Support async benchmarks natively.
 *  - Group related benches into suites.
 *  - Output parseable JSON at the end for scripted comparisons.
 *
 * Usage:
 *   import { suite, bench, run } from "./harness.js";
 *
 *   suite("Hash", () => {
 *     bench("sha256 4B", async () => { await sha256("test"); });
 *     bench("sha256 1KB", async () => { await sha256(KB); });
 *   });
 *
 *   await run({ warmup: 500, iters: 2000 });
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

let currentSuite = "(global)";
const registry = []; // { suite, name, fn }

export function suite(name, fn) {
  const prev = currentSuite;
  currentSuite = name;
  fn();
  currentSuite = prev;
}

export function bench(name, fn) {
  registry.push({ suite: currentSuite, name, fn });
}

function fmt(n, decimals = 2) {
  if (n >= 1e9) return (n / 1e9).toFixed(decimals) + "G";
  if (n >= 1e6) return (n / 1e6).toFixed(decimals) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(decimals) + "K";
  return n.toFixed(decimals);
}

async function measure(fn, iters) {
  const start = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  const elapsed = performance.now() - start; // ms
  const usPerOp = (elapsed * 1000) / iters;
  const opsPerSec = iters / (elapsed / 1000);
  return { elapsed, usPerOp, opsPerSec, iters };
}

export async function run(opts = {}) {
  const warmup = opts.warmup ?? 200;
  const iters = opts.iters ?? 1000;
  const filter = opts.filter ?? null; // substring match on "suite/name"

  const results = [];
  let lastSuite = null;

  for (const { suite, name, fn } of registry) {
    const key = `${suite}/${name}`;
    if (filter && !key.toLowerCase().includes(filter.toLowerCase())) continue;

    if (suite !== lastSuite) {
      console.log(`\n${BOLD}${CYAN}── ${suite} ──${RESET}`);
      lastSuite = suite;
    }

    // warmup — don't record
    try {
      await measure(fn, warmup);
    } catch (e) {
      console.log(`  ${YELLOW}SKIP${RESET} ${name}: ${e.message}`);
      continue;
    }

    // real measurement
    const r = await measure(fn, iters);

    const line = `  ${GREEN}${name}${RESET}  ${BOLD}${fmt(r.opsPerSec)}${RESET} ops/s  ${DIM}(${r.usPerOp.toFixed(1)} μs/op, ${iters} iters)${RESET}`;
    console.log(line);

    results.push({ suite, name, ...r });
  }

  return results;
}

export default { suite, bench, run };
