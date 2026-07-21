/**
 * test/bench/07_base62.js — Benchmark base62 encoding/decoding (WASM).
 *
 * base62 is used in:
 *   - ZEN.hash() output encoding (every hash call)
 *   - pub/priv key serialization
 *   - Radisk file naming
 *
 * We already have WASM fast paths in src/base62.js.
 * This bench validates the WASM speedup vs the JS fallback.
 *
 * Run:
 *   node --experimental-vm-modules test/bench/07_base62.js
 */

import { suite, bench, run } from "./harness.js";
import base62Mod from "../../src/base62.js";
const base62 = base62Mod.default ?? base62Mod;

// Typical ZEN hash output: sha256 = 32 bytes → base62 ~43 chars
const BYTES_32 = crypto.getRandomValues(new Uint8Array(32));
const BYTES_64 = crypto.getRandomValues(new Uint8Array(64));
// Typical pub key (33 bytes compressed secp256k1)
const BYTES_33 = crypto.getRandomValues(new Uint8Array(33));

// pre-encoded strings for decode bench
const ENC_32 = base62.bufToB62(BYTES_32);
const ENC_64 = base62.bufToB62(BYTES_64);

console.log(`Encoded 32B → ${ENC_32.length} chars`);
console.log(`Encoded 64B → ${ENC_64.length} chars`);

suite("base62 bufToB62 (WASM fast path)", () => {
  bench("32 bytes (sha256 hash)", () => base62.bufToB62(BYTES_32));
  bench("33 bytes (pub key)", () => base62.bufToB62(BYTES_33));
  bench("64 bytes (64B payload)", () => base62.bufToB62(BYTES_64));
});

suite("base62 b62ToBuf (decode)", () => {
  bench("decode 32B (43 chars)", () => base62.b62ToBI(ENC_32));
  bench("decode 64B (86 chars)", () => base62.b62ToBI(ENC_64));
});

// ── btoa/atob comparison (base64, browser standard) ──────────────────────────
// base64 is often the alternative — compare encoding speed
const b64_32 = btoa(String.fromCharCode(...BYTES_32));

suite("base64 atob/btoa comparison", () => {
  bench("btoa 32B", () => btoa(String.fromCharCode(...BYTES_32)));
  bench("atob 32B encoded", () => atob(b64_32));
  bench("Buffer.from 32B base64", () => Buffer.from(BYTES_32).toString("base64"));
});

await run({ warmup: 500, iters: 5000 });
