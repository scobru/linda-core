# zkTLS — Research

> **Status:** Research — not yet implemented.
>
> **Goal:** Understand ZEN zkTLS — cryptographic proofs that a specific value was honestly fetched from a specific HTTPS server, verifiable by any peer without trusting the oracle that fetched it.

---

## 1. The oracle problem

ZEN is a decentralised, peer-verified graph. When a node writes a price, a balance, or any real-world fact sourced from an HTTPS API, other peers have no way to verify it. They must either trust the writer or re-fetch the same URL — neither is acceptable in a trustless graph.

**zkTLS** solves this. The oracle generates a zero-knowledge proof alongside the data, proving that the claim came from a specific HTTPS server response. Any peer can verify the proof in under 1 ms without re-fetching, without trusting the oracle, and without any multi-party computation.

---

## 2. What "oracle cannot fake data" requires

The fundamental constraint: the oracle is the TLS client. They hold the session key. A proof that merely shows correct AES decryption is **not sufficient** — the oracle could construct a fake `(key, ciphertext)` pair for any plaintext they choose.

**TLS 1.3 uses two distinct key types that must not be confused:**

| Key | Source | Role |
|-----|--------|------|
| `server_cert_pub` | Leaf cert (X.509) | Authenticates server identity; used only in `CertificateVerify` |
| `server_ephem_pub` | `ServerHello.key_share` | Used in ECDH to derive session key; ephemeral, rotated per session |

Truly trustless proof requires a chain of five bindings — each closing a different attack vector:

```
/* 1. Cert chain: server_cert_pub is CA-authorised for origin.host */
server_cert_pub ← cert_chain_verify(server_cert, embedded_root_CAs)       ← public
hostname        ← extract_SAN(server_cert)                                 ← ZK constraint
hostname        = origin_host                                               ← public

/* 2. CertificateVerify: server_ephem_pub is bound to server_cert identity */
context_cv      = "TLS 1.3, server CertificateVerify\0" || transcript_hash_cv
ECDSA_verify(server_cert_pub, context_cv, cert_verify_sig) = true          ← ZK

/* 3. Ephemeral ECDH: session key derived from server_ephem_pub */
HS              = ECDH(oracle_ephem_priv, server_ephem_pub)                ← ZK

/* 4. Key schedule: exact RFC 8446 HKDF-Expand-Label */
write_key, write_iv = TLS13_key_schedule(HS, transcript_hash_full)         ← ZK

/* 5. AEAD decrypt + auth tag + extraction */
per_record_iv   = write_iv XOR (0^4 || seq_no_64be)
AAD             = 0x17 0x03 0x03 <ciphertext_len_uint16be>
plaintext       = AES_128_GCM_decrypt(write_key, per_record_iv, ciphertext, AAD)  ← ZK
                  (auth tag verified as circuit constraint)
request_url     ← AES_128_GCM_decrypt(client_write_key, request_ciphertext, ...)  ← ZK
request_url     = origin_path                                               ← public
claim_value     = extract(plaintext, selector)                              ← ZK
```

Public inputs (9): `SHA256(server_cert)`, `SHA256(response_ciphertext)`, `SHA256(request_ciphertext)`,
`transcript_hash_cv`, `origin_host_hash`, `origin_path_hash`, `selector_hash`, `claim_value`, `timestamp`

> `timestamp` (`att[">"]) is public input `p.i[8]` (unix seconds as BN254 scalar). The verifier checks `base62_decode(str(att[">"]))` against `p.i[8]` before the pairing check. This is required to make the cert validity window constraint (`leaf.notBefore ≤ timestamp ≤ leaf.notAfter`) verifiable — if `timestamp` were a private input, the prover could supply any value within the cert's validity range even for an expired cert.

Private inputs: `oracle_ephem_priv`, `server_ephem_pub`, `server_hello_bytes`,
`client_hello_bytes`, `enc_exts_bytes`, `cert_bytes`, `server_finished_bytes`,
`cert_verify_sig`, `resp_plaintext`, `req_plaintext`, `resp_seq_no`, `req_seq_no`

If the oracle uses a fake server → binding 1 fails (`cert_chain_verify`). If they MITM-swap `server_ephem_pub` → binding 2 fails (`CertificateVerify`). If they alter ciphertext → binding 5 fails (AES-GCM auth tag). If they fetch a different URL → binding 5 fails (request_url constraint). If they claim a wrong value → extraction constraint fails.

This is a large circuit (~9 M constraints for RSA-cert servers, ~15 M for ECDSA-cert servers). ZEN zkTLS implements this as a single `tls13` circuit — the only approach that is genuinely trustless for arbitrary HTTPS APIs.

---

## 3. Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Layer 3: Application                                         │
│  zktls.prove({ url, extract, circuit })                       │
│  zen.get(soul).get(key).put(val, cb, { tls: attestation })    │
├───────────────────────────────────────────────────────────────┤
│  Layer 2: ZEN bridge (src/pen.js + src/put.js + src/get.js)   │
│  PEN opcode 0xC5 — enforces tls policy on every write         │
│  spec.tls in ZEN.pen() compiles to 0xC5 tail bytes            │
│  opt.tls in zen.put() auto-proves, stores att in _["&"]       │
│  .tls(cb) on zen.get() reads _["&"] from resolved node        │
├───────────────────────────────────────────────────────────────┤
│  Layer 1: lib/zktls.js  (~3000 lines, bundled from lib/zk/tls/)   │
│  prove(opt)    → Attestation   (oracle role, BigInt prover)   │
│  verify(att)   → boolean       (all peers, calls WASM)        │
│  setup(circuit, ptau, out)     (one-time trusted setup)       │
│  register(name, { prove, verify })  (custom circuits)         │
│  Internals: BN254 BigInt, Groth16 prover, R1CS (tls13)       │
│  R1CS written directly in JS — no Circom dependency           │
├───────────────────────────────────────────────────────────────┤
│  Layer 0: lib/zktls.wasm — STANDALONE (~35–45 KB, 0 imports)  │
│  Source: lib/zk/tls/*.zig (entry: lib/zk/tls/main.zig)        │
│  Groth16 verifier over BN254                                  │
│  BN254 field tower (Fp → Fp2 → Fp6 → Fp12)                   │
│  Ate pairing, AES-128-GCM, SHA-256                            │
└───────────────────────────────────────────────────────────────┘
```

Every ZEN peer is a potential oracle. `lib/zktls.js` is a single file that handles both roles:

- **Verify role** (all peers, including browser): calls `lib/zktls.wasm` for the BN254 pairing check — fast (~1 ms), loads ~35–45 KB WASM only.
- **Oracle role** (any peer that fetches HTTPS data): runs the BigInt Groth16 prover internally. Proving key (`.zkey`) is loaded lazily on first `prove()` call.

No external dependencies. R1CS constraint matrices for `tls13` are written directly in JS — no Circom compiler required.

---

## 4. Why not a simpler ecdsa circuit?

If an API already signs its responses with ECDSA (Chainlink, Pyth, JWT ES256), one might propose a lighter circuit that only proves `ECDSA_verify(api_pub, hash(body), sig) = true`. This is **redundant** — ZEN and PEN already handle it natively with zero ZK overhead:

```js
// API signs response → oracle writes {data, sig} → PEN verifies ECDSA directly
const soul = ZEN.pen({ sign: true, cert: API_PUB })
zen.get(soul).get('price').put(data, null, { authenticator: pair, cert: apiCert })
```

PEN opcode `0xC0` (SGN) + `0xC1` (CRT) already enforce this. Any peer verifies in microseconds with no proof, no `.zkey`, no pairing. An ecdsa ZK circuit would add proving cost (~15 s) for zero security gain — the trust model is identical to native PEN cert verification.

**zkTLS is only needed when the API does not sign its responses** — the general HTTPS case where the oracle is the only party that knows the TLS session key. That is what the `tls13` circuit solves.

---

## 5. Circuit `tls13` — general HTTPS

zkTLS provides a single circuit: `tls13`. Targets any HTTPS server. No server cooperation needed. Embeds well-known root CA public keys in the circuit. Oracle cannot impersonate a legitimate server.

**What the circuit proves (7 steps):**

```
/* Step 1 — Certificate chain + cert validity window */
server_cert_pub = cert_chain_verify(server_cert, embedded_root_CAs)
  where: sig_verify(root_CA_pub, intermediate.tbs, intermediate.sig) = true
         sig_verify(intermediate.pub, leaf.tbs, leaf.sig) = true
         server_cert_pub = leaf.spki
         leaf.notBefore ≤ timestamp ≤ leaf.notAfter           ← circuit constraint, timestamp = p.i[8]

/* Step 2 — Hostname: cert belongs to claimed domain (SAN/CN in circuit) */
hostname_in_cert = extract_SAN_or_CN(leaf.tbs)                 ← in-circuit DER extraction
hostname_in_cert = origin_host                                  ← circuit constraint, hash = p.i[4]

/* Step 3 — CertificateVerify: server_ephem_pub ↔ server cert identity */
/* server_hello_bytes is private witness; circuit hashes it to bind server_ephem_pub
   into the transcript before verifying CertificateVerify signature */
server_ephem_pub   = parse_key_share(server_hello_bytes)        ← in-circuit extraction (private)
transcript_hash_cv = SHA256(client_hello_bytes || server_hello_bytes
                            || enc_exts_bytes || cert_bytes)    ← in-circuit hash = p.i[3]
context_cv         = "TLS 1.3, server CertificateVerify\0" || transcript_hash_cv
sig_verify(server_cert_pub, context_cv, cert_verify_sig) = true ← ECDSA/RSA-PSS circuit constraint

/* Step 4 — Ephemeral ECDH */
HS = ECDH(oracle_ephem_priv, server_ephem_pub)                  ← private × private

/* Step 5 — Key schedule: exact RFC 8446 §7.1 HKDF-Expand-Label */
early_secret     = HKDF-Extract(0x00^32, 0x00^32)
derived_hs       = HKDF-Expand-Label(early_secret, "derived", SHA256(""), 32)
handshake_secret = HKDF-Extract(derived_hs, HS)
transcript_hash_full = SHA256(... || server_finished_bytes)     ← up to server Finished (private)
s_hs_traffic     = HKDF-Expand-Label(handshake_secret, "s hs traffic", transcript_hash_cv, 32)
master_secret    = HKDF-Extract(
                     HKDF-Expand-Label(handshake_secret, "derived", SHA256(""), 32), 0x00^32)
s_ap_traffic     = HKDF-Expand-Label(master_secret, "s ap traffic", transcript_hash_full, 32)
c_ap_traffic     = HKDF-Expand-Label(master_secret, "c ap traffic", transcript_hash_full, 32)
server_write_key = HKDF-Expand-Label(s_ap_traffic, "key", "", 16)   // AES-128
server_write_iv  = HKDF-Expand-Label(s_ap_traffic, "iv",  "", 12)
client_write_key = HKDF-Expand-Label(c_ap_traffic, "key", "", 16)   // for request
client_write_iv  = HKDF-Expand-Label(c_ap_traffic, "iv",  "", 12)   //   binding

/* Step 6 — AES-128-GCM: AEAD with auth tag + sequence number in IV */
/* Response (server → oracle) — single TLS ApplicationData record, max 16 KB: */
resp_per_record_iv = server_write_iv XOR (0x00^4 || resp_seq_no_uint64_be)
resp_AAD           = 0x17 0x03 0x03 <resp_ciphertext_len_uint16_be>   // 5-byte TLS record header
resp_plaintext, resp_tag_valid = AES_128_GCM_decrypt(
    server_write_key, resp_per_record_iv, response_ciphertext, resp_AAD)
resp_tag_valid = true                                           ← circuit constraint; hash = p.i[1]

/* Request (oracle → server) — binds HTTP URL to proof: */
req_per_record_iv  = client_write_iv XOR (0x00^4 || req_seq_no_uint64_be)
req_AAD            = 0x17 0x03 0x03 <req_ciphertext_len_uint16_be>
req_plaintext, req_tag_valid = AES_128_GCM_decrypt(
    client_write_key, req_per_record_iv, request_ciphertext, req_AAD)
req_tag_valid = true                                            ← circuit constraint; hash = p.i[2]
request_path = parse_http_request_path(req_plaintext)
request_path = origin_path                                      ← circuit constraint; hash = p.i[5]

/* Step 7 — Extraction */
extract(resp_plaintext, selector) = claim_value                 ← circuit constraint; encoded = p.i[7]
```

Public inputs (9 elements in `p.i`, all BN254 scalars — see §6 attestation format):

| `p.i` index | Value | Notes |
|---|---|---|
| 0 | `SHA256(server_cert)` | Verifier hashes `att.s.c` to check |
| 1 | `SHA256(response_ciphertext)` | Verifier hashes `att.s.r` to check |
| 2 | `SHA256(request_ciphertext)` | Binds request URL; verifier hashes `att.s.q` |
| 3 | `transcript_hash_cv` | 32-byte hash; verifier checks against `att.s.h` |
| 4 | `SHA256(origin_host)` | Hostname binding; verifier hashes `att.o.h` |
| 5 | `SHA256(origin_path)` | URL path binding; verifier hashes `att.o["/"]` |
| 6 | `selector_hash` | Hash of extraction path; verifier recomputes from `att.x["/"]` |
| 7 | `claim_value` | Proven value: if ≤ 31 UTF-8 bytes → big-endian integer of bytes; if longer → `SHA256(UTF-8 bytes)` truncated to 31 bytes |
| 8 | `timestamp` | Unix seconds (`att[">"`) as BN254 scalar; verifier checks `p.i[8] == att[">"` before pairing |

Private inputs: `oracle_ephem_priv`, `server_ephem_pub`, `server_hello_bytes`,
`client_hello_bytes`, `enc_exts_bytes`, `cert_bytes`, `server_finished_bytes`,
`cert_verify_sig`, `resp_plaintext`, `req_plaintext`, `resp_seq_no`, `req_seq_no`

> `timestamp` (`att[">"`) is public input `p.i[8]` (unix seconds as BN254 scalar). The verifier confirms `p.i[8] == att[">"` in the pre-pairing reconstruction step. This binds the cert validity window check (`leaf.notBefore ≤ timestamp ≤ leaf.notAfter`) to the actual fetch time — preventing the oracle from supplying a fake timestamp that makes an expired cert appear valid. `sign: true` in the PEN soul additionally binds the timestamp via the oracle's ZEN key pair, enforcing freshness via `maxAge`.

**Trust model:** Trustless conditional on:
1. At least one of the 54 Hermez ptau contributors destroyed their toxic waste
2. No root CA in the embedded bundle is currently compromised

**Constraint estimate:**

| Component | Constraints |
|-----------|-------------|
| P-256 ECDH scalar multiplication (emulated, BN254 field) | ~4 500 000 |
| RSA-PSS CertificateVerify (2048-bit, e=65537) | ~3 000 000 |
| HKDF-SHA256 key schedule (RFC 8446 HKDF-Expand-Label, both traffic secrets) | ~130 000 |
| AES-128-GCM response decrypt + auth tag (~1 KB) | ~350 000 |
| AES-128-GCM request decrypt + URL extraction (~100 B) | ~80 000 |
| X.509 cert chain verify (2-cert RSA chain) | ~700 000 |
| Hostname binding (SAN/CN DER extraction) | ~50 000 |
| Cert validity window (notBefore/notAfter) | ~20 000 |
| transcript_hash_cv recomputation (SHA-256 of handshake bytes) | ~120 000 |
| JSON / regex extraction | ~80 000 |
| **Total (RSA-2048 cert, 1 KB response)** | **~9 030 000** |

> If the server uses a P-256 ECDSA cert, CertificateVerify costs ~9 000 000 instead → total ~15 030 000.

- Proof generation: ~5–15 min server-side (Node.js BigInt); ~30–60 s GPU-accelerated
- Proof size: 192 bytes
- Verification: < 1 ms

> **Trusted setup:** Requires `powersOfTau28_hez_final_24.ptau` (2²⁴, ~8.5 GB) from the Hermez public ceremony ([download](https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_24.ptau)). Download once, generate `lib/zktls_tls13.zkey` + `vk.json` locally.

---

## 6. Attestation format

Every attestation is a plain JSON object, stored in `msg.put["&"]` on the ZEN wire and optionally persisted in the graph.

All keys are single characters. `&` is the wire-level key on `msg.put` (pictographic for "and/alongside" — the proof accompanies the written value; unused in ZEN's protocol namespace: `~` is user namespace, `@` is reply-to, `#` is soul, `^` is PoW nonce, `$` is reserved for ownership). The attestation carries both the ZK proof **and the public witness data** the verifier needs to reconstruct all `p.i` public inputs.

**Single-char key legend:**

| Key | Full name | Level |
|-----|-----------|-------|
| `c` | circuit | top |
| `o` | origin | top |
| `o.h` | host | origin |
| `o["/"]` | path | origin (`/` = path, pictographic) |
| `o.m` | method | origin |
| `x` | extract | top |
| `x.t` | type | extract |
| `x["/"]` | path | extract |
| `v` | value/claim | top |
| `v.v` | value | claim |
| `v.t` | type | claim |
| `s` | session (TLS data) | top |
| `s.c` | server cert | session |
| `s.r` | response ciphertext | session |
| `s.q` | request (query) ciphertext | session |
| `s.h` | transcript hash (cv) | session |
| `p` | proof | top |
| `p.a` | pi_a | proof |
| `p.b` | pi_b | proof |
| `p.c` | pi_c | proof |
| `p.i` | public inputs array | proof |
| `>` | timestamp | top (`>` = ZEN time convention) |
| `e` | expiry (ttl) | top |

```json
{
  "c": "tls13",
  "o": { "h": "api.coingecko.com", "/": "/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", "m": "GET" },
  "x": { "t": "json", "/": ".bitcoin.usd" },
  "v": { "v": "42150.73", "t": "number" },
  "s": {
    "c": "<base64 DER cert chain, ~2 KB>",
    "r": "<base64 raw TLS ApplicationData record (server→oracle), ~1 KB>",
    "q": "<base64 raw TLS ApplicationData record (oracle→server), ~200 B>",
    "h": "<base62 32-byte SHA-256 of handshake up to Certificate>"
  },
  "p": {
    "a": "<base62 G1 point>",
    "b": "<base62 G2 point>",
    "c": "<base62 G1 point>",
    "i": [
      "<base62 — SHA256(s.c)>",
      "<base62 — SHA256(s.r)>",
      "<base62 — SHA256(s.q)>",
      "<base62 — s.h>",
      "<base62 — SHA256(o.h)>",
      "<base62 — SHA256(o[\"/\"])>",
      "<base62 — selector_hash>",
      "<base62 — claim_value>"
    ]
  },
  ">": 1714060800,
  "e": 3600
}
```

**Verifier `p.i` reconstruction (before pairing check):**

| `p.i` index | Verifier computes | Verifier checks against |
|---|---|---|
| 0 | `SHA256(base64_decode(att.s.c))` | `att.p.i[0]` |
| 1 | `SHA256(base64_decode(att.s.r))` | `att.p.i[1]` |
| 2 | `SHA256(base64_decode(att.s.q))` | `att.p.i[2]` |
| 3 | `base62_decode(att.s.h)` | `att.p.i[3]` |
| 4 | `SHA256(att.o.h)` | `att.p.i[4]` |
| 5 | `SHA256(att.o["/"])` | `att.p.i[5]` |
| 6 | recompute `selector_hash` from `att.x["/"]` | `att.p.i[6]` |
| 7 | `encode_claim(att.v.v)` — if ≤ 31 bytes: big-endian int of UTF-8 bytes; else: `SHA256(UTF-8 bytes)` truncated to 31 bytes | `att.p.i[7]` |
| 8 | `att[">"` as integer | `att.p.i[8]` |

If any check fails, the verifier rejects before calling `groth16_verify` in WASM.

| Key | Required | Description |
|-----|----------|-------------|
| `c` | ✓ | `"tls13"` or custom registered name — must match `circuit` in the 0xC5 policy, not just any registered handler |
| `o.h` | ✓ | HTTPS server hostname |
| `o["/"]` | ✓ | Request path + query string |
| `o.m` | — | HTTP method, default `"GET"` |
| `x.t` | ✓ | `"json"`, `"regex"`, or `"text"` |
| `x["/"]` | ✓ | Dot-notation JSON path or regex with one capture group |
| `v.v` | ✓ | The proven extracted value (as string); max 31 UTF-8 bytes for direct encoding, longer values use SHA256 |
| `v.t` | — | `"string"`, `"number"`, `"boolean"` |
| `s.c` | ✓ | Base64 DER-encoded server cert chain |
| `s.r` | ✓ | Base64 raw TLS ApplicationData record (server → oracle) — single record, max 16 KB |
| `s.q` | ✓ | Base64 raw TLS ApplicationData record (oracle → server, HTTP request) |
| `s.h` | ✓ | Base62 32-byte SHA-256 of handshake up to Certificate (for CertificateVerify) |
| `p.a/b/c` | ✓ | Groth16 proof points (base62 encoded) |
| `p.i` | ✓ | **9-element** Groth16 public inputs array (base62 BN254 scalars); `p.i[8]` = timestamp |
| `>` | ✓ | Unix seconds when fetch occurred — also `p.i[8]` in the SNARK proof |
| `e` | — | Attestation freshness window (seconds) |

---

## 7. `zktls.prove(opt)` — fetch and prove

Any peer can act as oracle. Fetches the HTTPS response and generates the full SNARK proof using the BigInt Groth16 prover inside `lib/zktls.js`. The proving key (`.zkey`) is loaded lazily on first call.

```js
import zktls from './lib/zktls.js'
import ZEN    from './zen.js'

const oraclePair = await ZEN.pair()

const attestation = await zktls.prove({
  url:     'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
  method:  'GET',
  headers: { 'Accept': 'application/json' },
  extract: {
    type: 'json',
    path: '.bitcoin.usd',
  },
  pair:    oraclePair,    // oracle's ZEN key pair (signs the attestation envelope)
  ttl:     3600,
})
```

**Options:**

| Option | Description |
|--------|-------------|
| `url` | Full HTTPS URL to fetch |
| `method` | HTTP method, default `"GET"` |
| `headers` | Request headers |
| `extract.type` | `"json"`, `"regex"`, or `"text"` |
| `extract.path` | JSON path or regex with one capture group |
| `root_cas` | Array of DER-encoded root CA certs. Defaults to Mozilla NSS bundle (top 15 roots). |
| `capture` | `'response_only'` (default) or `'full_session'` (include handshake for audit). |
| `pair` | Oracle's ZEN key pair (signs the attestation envelope) |
| `ttl` | Attestation freshness window in seconds |

**Extract types:**

| Type | `path` | Extracts |
|------|--------|---------|
| `'json'` | Dot-notation: `'.data.price'`, `'.items[0].id'` | Parsed JSON value |
| `'regex'` | Regex with one capture group: `'"price":"(\\d+\\.?\\d*)"'` | First capture group |
| `'text'` | `null` | Full response body as string |

### How the oracle captures TLS session data

Node.js's built-in `tls` module does not expose ephemeral ECDH private keys — the information needed to build the ZK witness. `lib/zktls.js` therefore implements a **minimal TLS 1.3 client** that generates its own ephemeral key pair and retains all session state:

```
Oracle                                    Server
  │──── ClientHello (oracle_ephem_pub) ─────▶│  ← captures client_hello_bytes
  │◀─── ServerHello (server_ephem_pub) ──────│  ← captures server_hello_bytes
  │◀─── {EncExtensions, Certificate,         │  ← captures enc_exts_bytes, cert_bytes,
  │      CertificateVerify, Finished} ───────│    cert_verify_sig, server_finished_bytes
  │                                           │
  │  oracle computes (RFC 8446 §7.1):         │
  │    transcript_hash_cv = SHA256(ClientHello || ServerHello || EncExts || Cert)
  │    HS = ECDH(oracle_ephem_priv, server_ephem_pub)
  │    [full HKDF-Expand-Label key schedule]
  │    client_write_key, server_write_key, ivs derived
  │                                           │
  │──── {Finished} ─────────────────────────▶│
  │──── {ApplicationData (HTTP request)} ────▶│  ← captures request_ciphertext
  │◀─── {ApplicationData (HTTP response)} ───│  ← captures response_ciphertext
```

After the session completes, the oracle holds all private witness data for the circuit:

| Captured value | Circuit role |
|----------------|---------|
| `oracle_ephem_priv` | Private input — ECDH scalar |
| `server_ephem_pub` | Private input — extracted from `server_hello_bytes` inside circuit |
| `client_hello_bytes` | Private input — hashed in circuit to bind `transcript_hash_cv` |
| `server_hello_bytes` | Private input — hashed in circuit; `server_ephem_pub` extracted here |
| `enc_exts_bytes`, `cert_bytes` | Private inputs — hashed in circuit for `transcript_hash_cv` |
| `cert_verify_sig` | Private input — verified against `server_cert_pub` and `transcript_hash_cv` |
| `server_finished_bytes` | Private input — completes `transcript_hash_full` for key schedule |
| `server_cert` (DER chain) | Public input — stored as `att.s.c`; `att.p.i[0]` = SHA256 hash |
| `response_ciphertext` (raw TLS record) | Public input — stored as `att.s.r`; `att.p.i[1]` = SHA256 hash |
| `request_ciphertext` (raw TLS record) | Public input — stored as `att.s.q`; `att.p.i[2]` = SHA256 hash |
| `transcript_hash_cv` | Public input — stored as `att.s.h`; `att.p.i[3]` |

This approach is fully self-contained — no OS-level key logging, no external proxy, no platform-specific hooks.

> **P-256 key exchange requirement:** The oracle's TLS client advertises a P-256 `key_share` in ClientHello. The circuit implements P-256 ECDH (not X25519). Virtually all HTTPS servers support P-256 in TLS 1.3 alongside X25519, but servers that have disabled P-256 entirely will refuse the connection. If a target server requires X25519, a separate circuit variant with a Curve25519 constraint would be needed.

---

## 8. `zktls.verify(attestation, policy?)` — verify a proof

Runs in any ZEN peer, browser or server. Calls `lib/zktls.wasm` for the pairing check. Does not require the `.zkey` proving key.

```js
const ok = await zktls.verify(attestation)
// or with policy constraints:
const ok = await zktls.verify(attestation, {
  host:      'api.coingecko.com',
  path:      '/api/v3/simple/price',
  maxAge:    300,               // reject if timestamp > 5 min old
  claimType: 'number',
})
```

Policy fields:

| Field | Effect |
|-------|--------|
| `host` | Must match `att.o.h` |
| `path` | Prefix match against `att.o["/"]` (path + query string). `'/api/v3/simple/price'` matches any URL under that path, including different query strings. To pin an exact URL, include the full query string in the policy `path`. |
| `maxAge` | Reject if `Date.now()/1000 - att[">"] > maxAge` |
| `claimType` | `att.v.v` must parse as this type |

---

## 9. PEN policy — `spec.tls` in `ZEN.pen()`

Encode a zkTLS requirement directly in a PEN soul. The policy is enforced on every write to that soul, by every peer independently.

```js
import ZEN from './zen.js'

const soul = ZEN.pen({
  key:  myKeyExpr,
  sign: true,         // also require oracle's ZEN signature
  tls: {
    host:     'api.coingecko.com',
    path:     '/api/v3/simple/price',
    maxAge:   60,
    claimType: 'number',
  }
})

// soul starts with '!', embeds both predicate bytecode and 0xC5 tail policy
```

**How enforcement works:**
1. Write arrives at a `!`-prefixed soul.
2. PEN evaluates the predicate expression (key, val, etc.) via `pen.wasm`.
3. The ZEN bridge reads `msg.put["&"]` (the attestation).
4. `zktls.verify(attestation, policy.tls)` is called.
5. If verification fails → write is rejected, dropped silently (same as any HAM/policy reject).

### PEN opcode 0xC5 encoding

`spec.tls` compiles to a `0xC5` tail byte followed by the serialised policy. The Zig VM (`pen.wasm`) does not process this opcode — it is handled entirely by `applypolicy()` in `src/pen.js`.

`applypolicy()` checks `att.c` against the policy `circuit` field and rejects if they do not match. This prevents an attacker from writing an attestation with `c: "my-circuit"` (a custom-registered verifier that always returns `true`) against a soul compiled for `"tls13"`.

```
0xC5
<circuit_len: u8>  <circuit: utf8>           e.g. "tls13" (required — no default to prevent bypass)
<host_len: u8>     <host: utf8>
<path_len: u8>     <path: utf8>
<flags: u8>                                  bit 0 = has_maxAge
                                             bit 1 = has_claimType
[<maxAge: u32le>]                            if has_maxAge
[<claimType_len: u8> <claimType: utf8>]      if has_claimType
```

---

## 10. Writing with a zkTLS attestation

### Option A — pre-proved attestation

The oracle proves first, then writes:

```js
import ZEN   from './zen.js'
import zktls from './lib/zktls.js'

const pair = await ZEN.pair()

const soul = ZEN.pen({
  sign: true,
  tls:  { host: 'api.coingecko.com', path: '/api/v3/simple/price', maxAge: 60, claimType: 'number' }
})

// Prove (takes ~3–8 min for tls13 circuit)
const att = await zktls.prove({
  url:     'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
  extract: { type: 'json', path: '.bitcoin.usd' },
  pair,
})

// Write — passes attestation in opt.tls
const zen = new ZEN({ peers: ['ws://relay.example.com'] })
zen.get(soul).get('btcUsd').put(att.v.v, null, {
  authenticator: pair,
  tls: att,
})
// put.js signs { v: att.v.v, ph: SHA256(att.p) } — binding value to this specific proof
// so an attacker cannot swap att with an older attestation proving the same value
```

### Option B — auto-prove inline

Pass `tls` as a fetch config. ZEN calls `zktls.prove()` internally before the put:

```js
zen.get(soul).get('btcUsd').put(null, null, {
  authenticator: pair,
  tls: {
    url:     'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    extract: { type: 'json', path: '.bitcoin.usd' },
  }
})
// att.v.v is set automatically as the written value
// msg.put["&"] is set automatically to the attestation
```

### Option C — reading zkTLS-attested data

The attestation is stored in `_["&"]` of the graph node — a metadata field analogous to HAM state `_[">"]`. It travels with the node during sync. Any peer can read it via the `.tls()` chain method, with or without re-verification:

```js
// Read value only — same as any get (no change to normal usage)
zen.get(soul).get('btcUsd').on(val => {
  console.log(val) // "42150.73"
})

// Read attestation + value together
zen.get(soul).get('btcUsd').tls((att, val) => {
  console.log(val)       // "42150.73"
  console.log(att.c)     // "tls13"
  console.log(att.o.h)   // "api.coingecko.com"
  console.log(att[">"])  // 1714060800 (unix seconds of fetch)
})

// Explicitly re-verify on read (optional — verification already ran at write time
// on every accepting peer; this is for auditing or third-party forwarding)
zen.get(soul).get('btcUsd').tls(async (att, val) => {
  const ok = await zktls.verify(att, {
    host:   'api.coingecko.com',
    maxAge: 3600,
  })
  console.log(ok) // true
})
```

**Storage:** `put.js` embeds the attestation in `node._["&"]` when it processes `opt.tls`. The `_["&"]` field is part of the ZEN node metadata (alongside `_["#"]` soul and `_[">"]` HAM state) and is never treated as user data.

**Verification lifecycle:**
- **At write time** — every peer that accepts the `put` runs `zktls.verify()` via PEN opcode `0xC5`. The value only enters the graph if the proof is valid.
- **At read time** — verification is NOT automatic. Call `zktls.verify()` explicitly inside `.tls(cb)` if independent re-verification is needed (e.g., forwarding proof to an external system).

**`get.js` change required:** Add `.tls()` to `Zen.chain` — reads `_["&"]` from the resolved node and calls `cb(attestation, value)`.

---

## 11. Custom circuits

Register a circuit with `zktls.register(name, { prove, verify })`:

```js
zktls.register('my-circuit', {
  // ctx: { url, method, headers, response (raw string), origin, extract, claim }
  async prove(ctx) {
    // Generate proof data. Return any JSON-serialisable object.
    return { a: '...', b: '...', c: '...', i: ['...'] }
  },
  // att: full Attestation object including att.p
  async verify(att, policy) {
    // Call lib/zktls.wasm or do pure JS verification.
    // Return true or false.
    return true
  }
})
```

Custom circuits use the same wire format (`msg.put["&"]`) and the same PEN opcode (`0xC5`). The `c` field in the attestation routes to the correct registered handler.

---

## 12. Standalone usage (no ZEN graph)

`lib/zktls.js` is usable as a pure proof library independent of ZEN:

```js
import zktls from './lib/zktls.js'
import ZEN    from './zen.js'

// Generate proof (any peer acting as oracle)
const pair = await ZEN.pair()
const att  = await zktls.prove({
  url:     'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
  extract: { type: 'json', path: '.bitcoin.usd' },
  pair,
})

// Serialise
const json = JSON.stringify(att)

// Verify anywhere (browser or server) — no zkey needed
const ok = await zktls.verify(JSON.parse(json), {
  host:    'api.coingecko.com',
  maxAge:  3600,
})

console.log(ok) // true
```

---

## 13. Trusted setup

The `tls13` circuit uses Groth16, which requires a one-time **trusted setup**. ZEN zkTLS uses the public **Hermez Powers of Tau** ceremony (2020–2021, 54 contributors + randomness beacon, toxic waste demonstrably destroyed):

| Circuit | Constraints | Required ptau | File size |
|---------|-------------|--------------|-----------|
| `tls13` (RSA-2048 cert) | ~9 030 000 | `powersOfTau28_hez_final_24.ptau` (2²⁴) | ~8.5 GB |
| `tls13` (P-256 ECDSA cert) | ~15 030 000 | `powersOfTau28_hez_final_24.ptau` (2²⁴) | ~8.5 GB |

> 2²³ (~8.4 M) is insufficient for the full circuit with CertificateVerify. Use `powersOfTau28_hez_final_24.ptau` (2²⁴ = 16.7 M constraints capacity).

**Official download** (hosted by Polygon/zkEVM on Google Cloud Storage, documented in [snarkjs README §7](https://github.com/iden3/snarkjs#7-prepare-phase-2)):

```bash
wget https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_24.ptau
# BLAKE2b-512: fa404d140d5819d39984833ca5ec3632cd4995f81e82db402371a4de7c2eae86
#              87c62bc632a95b0c6aadba3fb02680a94e09174b7233ccd26d78baca2647c733
```

The ptau file is downloaded once and used to generate the circuit-specific `.zkey` (proving key):

```bash
npm run zktls:setup   # generates lib/zktls_tls13.zkey + embeds vk in lib/zktls.wasm
```

The `.zkey` file (~4–6 GB) is only needed on oracle nodes (provers). The verification key (`vk.json`, ~2 KB) is extracted from the `.zkey` and embedded in `lib/zktls.wasm` at build time — all verifying peers need only the WASM.

---

## 14. Security model

| Threat | Defense | Layer |
|--------|---------|-------|
| Oracle uses a fake server | Server cert must chain to embedded root CA — forgery requires compromising a root CA | Circuit (Step 1) |
| Oracle claims wrong domain (cert for `evil.com`) | `extract_SAN_or_CN(cert) = origin_host` is a circuit constraint; hostname mismatch → proof invalid | Circuit (Step 2) |
| Oracle swaps `server_ephem_pub` (MITM) | `CertificateVerify` signature over `transcript_hash_cv` (which contains ServerHello with real `server_ephem_pub`) is verified in-circuit against `server_cert_pub` — swap without server's cert private key → sig fail | Circuit (Step 3) |
| Oracle alters response ciphertext | AES-GCM auth tag check is inside circuit; `SHA256(ciphertext)` is `p.i[1]` — mismatch → reject before pairing | Circuit (Step 6) |
| Oracle fetches different URL | HTTP request decrypted in circuit under same session key; `request_path = origin_path` is a circuit constraint | Circuit (Step 6) |
| Oracle claims wrong extracted value | `extract(resp_plaintext, selector) = claim_value` is a circuit constraint | Circuit (Step 7) |
| Oracle replays old data | `timestamp = p.i[8]` pins the fetch time inside the SNARK; `sign: true` + `maxAge` enforces freshness via oracle's ZEN signature | Circuit (Step 1) + Attestation signature |
| Oracle supplies fake timestamp to pass expired cert | `timestamp` is `p.i[8]` — a public input; verifier checks `p.i[8] == att[">"]` before calling WASM; mismatch → reject | Pre-pairing check |
| Attestation swap (replace `att` with older proof of same value) | `put.js` signs `{ v: att.v.v, ph: SHA256(att.p) }`; SNARK proof is session-unique — swapping `att` changes `att.p`, invalidating the signature | Attestation signature |
| Custom circuit bypass (`att.c: "always-true-circuit"`) | 0xC5 policy encodes `circuit` name; `applypolicy()` rejects if `att.c ≠ policy.circuit`; no default | 0xC5 policy |
| Expired certificate | `notBefore ≤ timestamp ≤ notAfter` is a circuit constraint; `timestamp = p.i[8]` is the actual fetch time | Circuit (Step 1) |
| Root CA compromise | Update embedded root CA list → rebuild `lib/zktls.wasm` → redeploy | Re-deployment |
| Groth16 toxic waste attack | Use Hermez public ceremony (54 contributors + beacon); `vk.json` pinned in WASM — any tampering detectable | Trusted setup |
| Revoked certificate (CRL/OCSP) | Not checkable in static circuit; mitigated by short `maxAge` + oracle key rotation | Policy (partial) |
| Response body > 16 KB (multi-record) | Not supported in `tls13` circuit — single TLS ApplicationData record only; `prove()` rejects if response spans multiple records | Implementation guard |

### What the proof guarantees (and does not guarantee)

**Guarantees (circuit-enforced):**
- Response plaintext was AES-128-GCM decrypted from `response_ciphertext` with auth tag intact
- Session key was derived from ECDH with `server_ephem_pub` that is bound to `server_cert` via `CertificateVerify`
- `server_cert` chains to an embedded root CA and its SAN/CN matches `origin.host`
- `server_cert` was within its validity window at `timestamp` (the actual fetch time, `p.i[8]`)
- HTTP request decrypted from `request_ciphertext` has path matching `origin.path`
- `v.v` is the correct extraction of `x["/"]` from the response
- The SNARK was produced for `timestamp = att[">"]` (not a privately-chosen fake time)

**Does NOT guarantee (outside circuit):**
- Certificate has not been revoked (CRL/OCSP not in circuit)
- The root CA bundle is not stale (operational concern — requires WASM rebuild on CA change)
- Oracle machine was not compromised at proving time (attacker with `.zkey` + oracle machine can forge any proof)
- Response body fits within a single TLS ApplicationData record (≤ 16 KB)

---

## 15. lib/zktls.wasm internals

Compiled from `lib/zk/tls/*.zig`. Standalone, zero imports.

**Exports:**

| Export | Signature | Description |
|--------|-----------|-------------|
| `groth16_verify` | `(vk_ptr, proof_ptr, pub_ptr, pub_len) → i32` | Returns 1 if valid, 0 if invalid |
| `alloc` | `(size: u32) → ptr: u32` | WASM allocator |
| `free` | `(ptr: u32, size: u32)` | WASM allocator |
| `mem` | `() → ptr: u32` | Returns pointer to shared memory region |

**Internal modules (Zig):**

| File | Lines (est.) | Purpose |
|------|-------------|-------|
| `lib/zk/tls/main.zig` | — | Zig root — `@import`s all sub-modules; compile entry point |
| `lib/zk/tls/bn254_fp.zig` | ~200 | BN254 Fp field (254-bit Montgomery mul) |
| `lib/zk/tls/bn254_fp2.zig` | ~100 | Fp2 extension (quadratic) |
| `lib/zk/tls/bn254_fp6.zig` | ~120 | Fp6 tower (cubic over Fp2) |
| `lib/zk/tls/bn254_fp12.zig` | ~120 | Fp12 tower (quadratic over Fp6) |
| `lib/zk/tls/bn254_g1.zig` | ~80 | G1 group ops (affine + Jacobian) |
| `lib/zk/tls/bn254_g2.zig` | ~80 | G2 group ops |
| `lib/zk/tls/bn254_pairing.zig` | ~150 | Ate pairing + Miller loop + final expo |
| `lib/zk/tls/groth16.zig` | ~60 | Groth16 verifier (3 pairings + 1 MSM) |

**Expected size:** ~35–45 KB compiled (`-O ReleaseSmall`).

> AES-128-GCM and SHA-256 are R1CS constraints verified implicitly by the pairing check — the WASM verifier does not re-execute them.

---

## 16. `lib/zktls.js` internals

Modular source under `lib/zk/tls/`. No external dependencies. No Circom. R1CS constraint matrices are written directly as JS objects. Reuses ZEN's existing P-256 curve (`src/curves/p256.js`) for the TLS ECDH step.

| Source file | Lines (est.) | Purpose |
|-------------|-------------|-------|
| `lib/zk/tls/tls.js` | ~900 | TLS 1.3 client — handshake, session key capture, record layer |
| `lib/zk/tls/bn254.js` | ~200 | BN254 BigInt arithmetic (Montgomery, Fp, point ops) |
| `lib/zk/tls/groth16.js` | ~400 | Groth16 prover (NTT, MSM, polynomial commitment) |
| `lib/zk/tls/r1cs.js` | ~600 | R1CS constraint matrices for circuit `tls13` |
| `lib/zk/tls/witness.js` | ~400 | Witness generation (TLS session state → BN254 field elements) |
| `lib/zk/tls/setup.js` | ~200 | Phase 2 setup utilities (`ptau → zkey`, vk extraction) |
| `lib/zk/tls/verify.js` | ~100 | WASM verifier loader (reconstruct `p.i`, call `groth16_verify`) |
| `lib/zk/tls/index.js` | ~150 | Public API entry point (`prove / verify / setup / register`) |

`lib/zktls.js` is the build output (bundled with the `defmod/reqmod` pattern from `lib/builder/zen.js`). `lib/zktls.min.js` is the production file. Edit source files under `lib/zk/tls/` and rebuild.

Calling pattern by role:

```js
// Any peer — verify only (loads ~35–45 KB WASM, no zkey needed):
import zktls from './lib/zktls.min.js'
const ok = await zktls.verify(attestation, policy)

// Any peer acting as oracle — prove + verify:
const att = await zktls.prove({ url, extract, ... })
// .zkey loaded lazily from disk on first prove() call

// One-time trusted setup (run once after downloading powersOfTau28_hez_final_24.ptau):
await zktls.setup('tls13', './powersOfTau28_hez_final_24.ptau', './lib/zktls_tls13.zkey')
```

---

## 17. Building

```bash
# Build WASM verifier + bundle JS modules + minify
npm run buildZKTLS
# produces: lib/zktls.wasm  lib/zktls.js (bundle)  lib/zktls.min.js (production)

# Generate trusted setup for tls13 circuit
# (downloads powersOfTau28_hez_final_24.ptau ~8.5 GB, one time)
npm run zktls:setup

# Run zkTLS tests
npm run testZKTLS
```

`lib/builder/zktls.js` does three things in sequence, all in one script:
1. Compiles `lib/zk/tls/*.zig` → `lib/zktls.wasm` (entry: `lib/zk/tls/main.zig`; pattern from `lib/builder/pen.js`)
2. Traverses `lib/zk/tls/index.js` imports and bundles into `lib/zktls.js` using the same `defmod/reqmod` pattern as `lib/builder/zen.js`
3. Minifies `lib/zktls.js` → `lib/zktls.min.js` (`uglifyjs --module -c -m`)

`lib/zktls.js` is a build output — edit source files under `lib/zk/tls/` and rebuild.

---

## 18. File reference

| File | Role |
|------|------|
| `lib/zk/tls/index.js` | Entry point + public API (`prove / verify / setup / register`) |
| `lib/zk/tls/tls.js` | TLS 1.3 client — handshake, session key capture, record layer |
| `lib/zk/tls/bn254.js` | BN254 BigInt arithmetic (Montgomery, Fp, point ops) |
| `lib/zk/tls/groth16.js` | Groth16 prover (NTT, MSM, polynomial commitment) |
| `lib/zk/tls/r1cs.js` | R1CS constraint matrices for circuit `tls13` |
| `lib/zk/tls/witness.js` | Witness generation (TLS session state → BN254 field elements) |
| `lib/zk/tls/setup.js` | Phase 2 setup utilities (`ptau → zkey`, vk extraction) |
| `lib/zk/tls/verify.js` | WASM verifier loader (reconstruct `p.i`, call `groth16_verify`) |
| `lib/zktls.js` | **Build output** — bundled from `lib/zk/tls/`; do not edit directly |
| `lib/zktls.min.js` | **Production file** — minified bundle; used in browser and Node |
| `lib/zktls.wasm` | BN254 Groth16 verifier (Zig, ~35–45 KB, standalone) |
| `lib/zk/tls/*.zig` | Zig source modules — compile to `lib/zktls.wasm` (entry: `lib/zk/tls/main.zig`) |
| `lib/builder/zktls.js` | Build script (Zig → WASM, bundle JS modules, minify) |
| `lib/zktls_tls13.zkey` | Proving key for tls13 circuit (oracle node, ~4–6 GB) |
| `test/zktls.js` | Unit tests (verifier, prove/verify round-trips) |

`.zkey` files are not committed to the repo. They are generated locally by running `zktls.setup()` after downloading the Hermez `.ptau` file. The verifier key (`vk.json`) is extracted from the `.zkey` and embedded into `lib/zktls.wasm` at build time — peers do not need the `.zkey` to verify.

---

## 19. Implementation

Single-phase implementation targeting the `tls13` circuit — the only circuit needed for trustless general HTTPS data.

1. `lib/zk/tls/*.js` — modular source (tls, bn254, groth16, r1cs, witness, setup, verify, index)
2. `lib/zk/tls/*.zig` — BN254 field tower + Groth16 verifier (Zig → WASM)
3. `src/pen.js` — opcode `0xC5` in `scanpolicy` + `applypolicy`
4. `src/put.js` — `opt.tls` auto-prove, `msg.put["&"]` attachment, store attestation in `node._["&"]`
5. `src/get.js` — `.tls(cb)` chain method reads `_["&"]` from resolved node, calls `cb(att, val)`
6. `lib/builder/zktls.js` — Zig → WASM + bundle `lib/zk/tls/index.js` → `lib/zktls.js` + minify → `lib/zktls.min.js`
7. `package.json` — `buildZKTLS`, `zktls:setup`, `testZKTLS` scripts
8. `test/zktls.js` — round-trip tests for prove + verify + read via `.tls()`
