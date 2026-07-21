/**
 * test/bench/run.js — Run all benchmarks or a filtered subset.
 *
 * Usage:
 *   node --experimental-vm-modules test/bench/run.js
 *   node --experimental-vm-modules test/bench/run.js hash
 *   node --experimental-vm-modules test/bench/run.js json
 *   node --experimental-vm-modules test/bench/run.js dup
 *   node --experimental-vm-modules test/bench/run.js radix
 *   node --experimental-vm-modules test/bench/run.js ham
 *   node --experimental-vm-modules test/bench/run.js sign
 *   node --experimental-vm-modules test/bench/run.js base62
 */

const filter = process.argv[2] || "";

const modules = [
  { tag: "hash",  file: "./01_hash.js" },
  { tag: "json",  file: "./02_json.js" },
  { tag: "dup",   file: "./03_dup.js" },
  { tag: "radix", file: "./04_radix.js" },
  { tag: "ham",   file: "./05_ham.js" },
  { tag: "sign",  file: "./06_crypto_sign.js" },
  { tag: "base62", file: "./07_base62.js" },
];

for (const m of modules) {
  if (!filter || m.tag.includes(filter)) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`BENCH: ${m.tag}`);
    console.log("=".repeat(60));
    await import(m.file);
  }
}
