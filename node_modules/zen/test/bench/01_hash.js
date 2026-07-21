/**
 * test/bench/01_hash.js — Benchmark all hash operations in zen.
 *
 * Candidates for WASM:
 *   - SHA-256 (already WebCrypto, baseline)
 *   - Keccak-256 (already WASM — verify speedup here)
 *   - RIPEMD-160 (already WASM — verify speedup here)
 *   - String.hash / DJB2 (shim.js — used in dup.check)
 *
 * Run:
 *   node --experimental-vm-modules test/bench/01_hash.js
 */

import { suite, bench, run } from "./harness.js";
import ZEN from "../../zen.js";

// ── test payloads ─────────────────────────────────────────────────────────────
const BYTES_4 = new Uint8Array([1, 2, 3, 4]);
const BYTES_64 = crypto.getRandomValues(new Uint8Array(64));
const BYTES_1K = crypto.getRandomValues(new Uint8Array(1024));
const BYTES_64K = crypto.getRandomValues(new Uint8Array(65536));
const STR_SHORT = "hello world";
const STR_MEDIUM = "x".repeat(256);
const STR_LONG = "x".repeat(4096);

// ── WebCrypto baseline ───────────────────────────────────────────────────────
suite("SHA-256 (WebCrypto — baseline)", () => {
  bench("4 bytes", () => crypto.subtle.digest("SHA-256", BYTES_4));
  bench("64 bytes", () => crypto.subtle.digest("SHA-256", BYTES_64));
  bench("1 KB", () => crypto.subtle.digest("SHA-256", BYTES_1K));
  bench("64 KB", () => crypto.subtle.digest("SHA-256", BYTES_64K));
});

// ── ZEN's sha256.js (which wraps WebCrypto via shim) ─────────────────────────
const sha256Mod = await import("../../src/sha256.js");
const sha256 = sha256Mod.default;

suite("sha256.js (ZEN wrapper)", () => {
  bench("string short", () => sha256(STR_SHORT));
  bench("string medium", () => sha256(STR_MEDIUM));
  bench("string long", () => sha256(STR_LONG));
  bench("Uint8Array 1KB", () => sha256(BYTES_1K));
});

// ── keccak256.js (WASM) ───────────────────────────────────────────────────────
const keccak256Mod = await import("../../src/keccak256.js");
const keccak256 = keccak256Mod.default;

suite("keccak256.js (WASM)", () => {
  bench("4 bytes", () => keccak256(BYTES_4));
  bench("64 bytes", () => keccak256(BYTES_64));
  bench("1 KB", () => keccak256(BYTES_1K));
  bench("64 KB", () => keccak256(BYTES_64K));
  bench("string short", () => keccak256(STR_SHORT));
});

// ── ripemd160.js (WASM) ───────────────────────────────────────────────────────
const ripemd160Mod = await import("../../src/ripemd160.js");
const ripemd160 = ripemd160Mod.default;

suite("ripemd160.js (WASM)", () => {
  bench("4 bytes", () => ripemd160(BYTES_4));
  bench("64 bytes", () => ripemd160(BYTES_64));
  bench("1 KB", () => ripemd160(BYTES_1K));
  bench("64 KB", () => ripemd160(BYTES_64K));
});

// ── ZEN.hash SHA-256 path (name: "SHA-256" skips PBKDF2) ─────────────────────
const SHA256_OPT = { name: "SHA-256", encode: "hex" };
suite("ZEN.hash SHA-256 path", () => {
  bench("short string", () => ZEN.hash("hello world", null, null, SHA256_OPT));
  bench("medium string", () => ZEN.hash(STR_MEDIUM, null, null, SHA256_OPT));
});

// ── ZEN.hash HKDF path (strong seed → derived key, no iterations) ─────────────
// Use when input is already high-entropy (e.g. WebAuthn seed, keypair priv).
// ~1000x faster than PBKDF2. NOT suitable for passwords.
const HKDF_OPT = { name: "HKDF" };
suite("ZEN.hash HKDF (strong seed, no iter)", () => {
  bench("short string", () => ZEN.hash("hello world", "salt", null, HKDF_OPT));
  bench("with seed", () => ZEN.hash(STR_MEDIUM, "wallet", null, HKDF_OPT));
});

// ── ZEN.hash PBKDF2 path (default — intentionally slow: 100k iterations) ─────
suite("ZEN.hash PBKDF2 (default, 100k iter)", () => {
  bench("short string", () => ZEN.hash("hello world"));
  bench("with salt", () => ZEN.hash("hello", "salt"));
});

// ── DJB2 String.hash (used in dup.check dedup) ───────────────────────────────
// This runs in every message received, no await needed
suite("String.hash DJB2 (sync, shim.js)", () => {
  bench("9-char msgID (typical)", () => String.hash("aBcDeFgHi"));
  bench("64-char soul key", () => String.hash("a".repeat(64)));
});

// PBKDF2 benches take ~27ms each — use reduced iters to keep total time sane.
// SHA-256 / WASM benches are fast enough that 2000 iters is fine but PBKDF2
// at 2000 iters × 27ms = ~54s just for that suite.
await run({ warmup: 20, iters: 100 });
