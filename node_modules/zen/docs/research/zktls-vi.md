# zkTLS — Nghiên cứu

> **Trạng thái:** Nghiên cứu — chưa được triển khai.
>
> **Mục tiêu:** Tìm hiểu ZEN zkTLS — bằng chứng mật mã chứng minh rằng một giá trị cụ thể đã được lấy trung thực từ một máy chủ HTTPS cụ thể, có thể xác minh bởi bất kỳ peer nào mà không cần tin tưởng oracle đã thực hiện lấy dữ liệu đó.

---

## 1. Vấn đề oracle

ZEN là một đồ thị phi tập trung, được xác minh ngang hàng. Khi một node ghi một mức giá, số dư, hay bất kỳ dữ liệu thực tế nào lấy từ HTTPS API, các peer khác không có cách nào xác minh. Họ phải hoặc tin tưởng người ghi, hoặc tự tải lại cùng URL đó — cả hai đều không chấp nhận được trong một đồ thị không cần tin cậy.

**zkTLS** giải quyết điều này. Oracle tạo ra một bằng chứng không tiết lộ thông tin (zero-knowledge proof) kèm theo dữ liệu, chứng minh rằng dữ liệu xuất phát từ phản hồi của một máy chủ HTTPS cụ thể. Bất kỳ peer nào cũng có thể xác minh bằng chứng trong dưới 1 ms mà không cần tải lại, không cần tin tưởng oracle, và không cần bất kỳ tính toán đa bên nào.

---

## 2. Điều kiện để "oracle không thể giả mạo dữ liệu"

Ràng buộc cơ bản: oracle là TLS client. Họ nắm giữ session key. Một bằng chứng chỉ chứng minh giải mã AES đúng là **không đủ** — oracle có thể tự xây dựng một cặp `(key, ciphertext)` giả cho bất kỳ plaintext nào họ muốn.

**TLS 1.3 sử dụng hai loại key hoàn toàn khác nhau, không được nhầm lẫn:**

| Key | Nguồn gốc | Vai trò |
|-----|--------|------|
| `server_cert_pub` | Chứng chỉ lá (X.509) | Xác thực danh tính máy chủ; chỉ dùng trong `CertificateVerify` |
| `server_ephem_pub` | `ServerHello.key_share` | Dùng trong ECDH để derive session key; tạm thời, đổi mới mỗi phiên |

Bằng chứng thực sự không cần tin cậy đòi hỏi một chuỗi năm ràng buộc — mỗi ràng buộc đóng một vector tấn công khác nhau:

```
/* 1. Chuỗi chứng chỉ: server_cert_pub được CA uỷ quyền cho origin.host */
server_cert_pub ← cert_chain_verify(server_cert, embedded_root_CAs)       ← public
hostname        ← extract_SAN(server_cert)                                 ← ZK constraint
hostname        = origin_host                                               ← public

/* 2. CertificateVerify: server_ephem_pub được ràng buộc với danh tính server_cert */
context_cv      = "TLS 1.3, server CertificateVerify\0" || transcript_hash_cv
ECDSA_verify(server_cert_pub, context_cv, cert_verify_sig) = true          ← ZK

/* 3. ECDH tạm thời: session key được derive từ server_ephem_pub */
HS              = ECDH(oracle_ephem_priv, server_ephem_pub)                ← ZK

/* 4. Lịch trình key: HKDF-Expand-Label đúng chuẩn RFC 8446 */
write_key, write_iv = TLS13_key_schedule(HS, transcript_hash_full)         ← ZK

/* 5. Giải mã AEAD + auth tag + trích xuất */
per_record_iv   = write_iv XOR (0^4 || seq_no_64be)
AAD             = 0x17 0x03 0x03 <ciphertext_len_uint16be>
plaintext       = AES_128_GCM_decrypt(write_key, per_record_iv, ciphertext, AAD)  ← ZK
                  (auth tag được xác minh như một circuit constraint)
request_url     ← AES_128_GCM_decrypt(client_write_key, request_ciphertext, ...)  ← ZK
request_url     = origin_path                                               ← public
claim_value     = extract(plaintext, selector)                              ← ZK
```

Đầu vào công khai (9 phần tử): `SHA256(server_cert)`, `SHA256(response_ciphertext)`, `SHA256(request_ciphertext)`,
`transcript_hash_cv`, `origin_host_hash`, `origin_path_hash`, `selector_hash`, `claim_value`, `timestamp`

> `timestamp` (`att[">"`) là public input `p.i[8]` (giây unix dưới dạng BN254 scalar). Verifier xác nhận `p.i[8] == att[">"` trong bước kiểm tra trước pairing. Điều này cần thiết để làm cho ràng buộc cửa sổ hiệu lực chứng chỉ (`leaf.notBefore ≤ timestamp ≤ leaf.notAfter`) có thể xác minh — nếu `timestamp` là private input, prover có thể cung cấp bất kỳ giá trị nào trong phạm vi hợp lệ của chứng chỉ kể cả khi chứng chỉ đã hết hạn.

Đầu vào bí mật: `oracle_ephem_priv`, `server_ephem_pub`, `server_hello_bytes`,
`client_hello_bytes`, `enc_exts_bytes`, `cert_bytes`, `server_finished_bytes`,
`cert_verify_sig`, `resp_plaintext`, `req_plaintext`, `resp_seq_no`, `req_seq_no`

Nếu oracle dùng máy chủ giả → ràng buộc 1 thất bại (`cert_chain_verify`). Nếu họ MITM-swap `server_ephem_pub` → ràng buộc 2 thất bại (`CertificateVerify`). Nếu họ thay đổi ciphertext → ràng buộc 5 thất bại (AES-GCM auth tag). Nếu họ lấy URL khác → ràng buộc 5 thất bại (constraint request_url). Nếu họ khai sai giá trị → constraint trích xuất thất bại.

Đây là một circuit lớn (~9 M constraints cho máy chủ dùng chứng chỉ RSA, ~15 M cho ECDSA). ZEN zkTLS triển khai điều này dưới dạng một circuit duy nhất `tls13` — cách duy nhất thực sự không cần tin cậy cho các HTTPS API tuỳ ý.

---

## 3. Kiến trúc

```
┌───────────────────────────────────────────────────────────────┐
│  Tầng 3: Ứng dụng                                             │
│  zktls.prove({ url, extract, circuit })                       │
│  zen.get(soul).get(key).put(val, cb, { tls: attestation })    │
├───────────────────────────────────────────────────────────────┤
│  Tầng 2: ZEN bridge (src/pen.js + src/put.js + src/get.js)   │
│  PEN opcode 0xC5 — thực thi chính sách tls trên mỗi lần ghi  │
│  spec.tls trong ZEN.pen() được biên dịch thành 0xC5 tail bytes│
│  opt.tls trong zen.put() tự động prove, lưu att vào _["&"]   │
│  .tls(cb) trên zen.get() đọc _["&"] từ node đã giải quyết    │
├───────────────────────────────────────────────────────────────┤
│  Tầng 1: lib/zktls.js  (~3000 dòng, bundle từ lib/zk/tls/)       │
│  prove(opt)    → Attestation   (vai trò oracle, BigInt prover)│
│  verify(att)   → boolean       (tất cả peers, gọi WASM)       │
│  setup(circuit, ptau, out)     (thiết lập tin cậy một lần)    │
│  register(name, { prove, verify })  (circuit tuỳ chỉnh)       │
│  Nội bộ: BN254 BigInt, Groth16 prover, R1CS (tls13)           │
│  R1CS viết trực tiếp bằng JS — không cần Circom               │
├───────────────────────────────────────────────────────────────┤
│  Tầng 0: lib/zktls.wasm — ĐỘC LẬP (~35–45 KB, 0 imports)     │
│  Nguồn: lib/zk/tls/*.zig (điểm vào: lib/zk/tls/main.zig)      │
│  Bộ xác minh Groth16 trên BN254                               │
│  Tháp trường BN254 (Fp → Fp2 → Fp6 → Fp12)                   │
│  Ate pairing, AES-128-GCM, SHA-256                            │
└───────────────────────────────────────────────────────────────┘
```

Mỗi peer ZEN đều là một oracle tiềm năng. `lib/zktls.js` là một file duy nhất xử lý cả hai vai trò:

- **Vai trò Verify** (tất cả peers, kể cả trình duyệt): gọi `lib/zktls.wasm` để kiểm tra BN254 pairing — nhanh (~1 ms), chỉ tải ~35–45 KB WASM.
- **Vai trò Oracle** (peer nào lấy dữ liệu HTTPS): chạy BigInt Groth16 prover bên trong. Proving key (`.zkey`) được tải lazy khi lần đầu gọi `prove()`.

Không có dependency bên ngoài. Ma trận constraint R1CS cho `tls13` được viết trực tiếp dưới dạng object JS — không cần compiler Circom.

---

## 4. Tại sao không dùng circuit ecdsa đơn giản hơn?

Nếu một API đã ký phản hồi bằng ECDSA (Chainlink, Pyth, JWT ES256), người ta có thể đề xuất một circuit nhẹ hơn chỉ chứng minh `ECDSA_verify(api_pub, hash(body), sig) = true`. Điều này là **thừa** — ZEN và PEN đã xử lý điều đó natively với chi phí ZK bằng 0:

```js
// API ký phản hồi → oracle ghi {data, sig} → PEN xác minh ECDSA trực tiếp
const soul = ZEN.pen({ sign: true, cert: API_PUB })
zen.get(soul).get('price').put(data, null, { authenticator: pair, cert: apiCert })
```

PEN opcode `0xC0` (SGN) + `0xC1` (CRT) đã thực thi điều này. Bất kỳ peer nào xác minh trong micro-giây mà không cần proof, không cần `.zkey`, không cần pairing. Một circuit ECDSA trong ZK sẽ thêm chi phí proving (~15 s) mà không có lợi ích bảo mật — mô hình tin cậy y hệt với xác minh chứng chỉ PEN native.

**zkTLS chỉ cần thiết khi API không ký phản hồi của nó** — trường hợp HTTPS tổng quát nơi oracle là bên duy nhất biết TLS session key. Đó là điều circuit `tls13` giải quyết.

---

## 5. Circuit `tls13` — HTTPS tổng quát

zkTLS cung cấp một circuit duy nhất: `tls13`. Nhắm mục tiêu bất kỳ máy chủ HTTPS nào. Không cần sự hợp tác của máy chủ. Nhúng các public key root CA nổi tiếng vào circuit. Oracle không thể mạo danh máy chủ hợp lệ.

**Circuit chứng minh những gì (7 bước):**

```
/* Bước 1 — Chuỗi chứng chỉ + cửa sổ hiệu lực chứng chỉ */
server_cert_pub = cert_chain_verify(server_cert, embedded_root_CAs)
  where: sig_verify(root_CA_pub, intermediate.tbs, intermediate.sig) = true
         sig_verify(intermediate.pub, leaf.tbs, leaf.sig) = true
         server_cert_pub = leaf.spki
         leaf.notBefore ≤ timestamp ≤ leaf.notAfter           ← circuit constraint, timestamp = p.i[8]

/* Bước 2 — Hostname: chứng chỉ thuộc về domain được khai (SAN/CN trong circuit) */
hostname_in_cert = extract_SAN_or_CN(leaf.tbs)                 ← trích xuất DER trong circuit
hostname_in_cert = origin_host                                  ← circuit constraint, hash = p.i[4]

/* Bước 3 — CertificateVerify: server_ephem_pub ↔ danh tính server cert */
/* server_hello_bytes là private witness; circuit hash nó để ràng buộc server_ephem_pub
   vào transcript trước khi xác minh chữ ký CertificateVerify */
server_ephem_pub   = parse_key_share(server_hello_bytes)        ← trích xuất trong circuit (private)
transcript_hash_cv = SHA256(client_hello_bytes || server_hello_bytes
                            || enc_exts_bytes || cert_bytes)    ← hash trong circuit = p.i[3]
context_cv         = "TLS 1.3, server CertificateVerify\0" || transcript_hash_cv
sig_verify(server_cert_pub, context_cv, cert_verify_sig) = true ← ECDSA/RSA-PSS circuit constraint

/* Bước 4 — ECDH tạm thời */
HS = ECDH(oracle_ephem_priv, server_ephem_pub)                  ← private × private

/* Bước 5 — Lịch trình key: đúng chuẩn RFC 8446 §7.1 HKDF-Expand-Label */
early_secret     = HKDF-Extract(0x00^32, 0x00^32)
derived_hs       = HKDF-Expand-Label(early_secret, "derived", SHA256(""), 32)
handshake_secret = HKDF-Extract(derived_hs, HS)
transcript_hash_full = SHA256(... || server_finished_bytes)     ← đến server Finished (private)
s_hs_traffic     = HKDF-Expand-Label(handshake_secret, "s hs traffic", transcript_hash_cv, 32)
master_secret    = HKDF-Extract(
                     HKDF-Expand-Label(handshake_secret, "derived", SHA256(""), 32), 0x00^32)
s_ap_traffic     = HKDF-Expand-Label(master_secret, "s ap traffic", transcript_hash_full, 32)
c_ap_traffic     = HKDF-Expand-Label(master_secret, "c ap traffic", transcript_hash_full, 32)
server_write_key = HKDF-Expand-Label(s_ap_traffic, "key", "", 16)   // AES-128
server_write_iv  = HKDF-Expand-Label(s_ap_traffic, "iv",  "", 12)
client_write_key = HKDF-Expand-Label(c_ap_traffic, "key", "", 16)   // cho request
client_write_iv  = HKDF-Expand-Label(c_ap_traffic, "iv",  "", 12)   //   binding

/* Bước 6 — AES-128-GCM: AEAD với auth tag + sequence number trong IV */
/* Phản hồi (server → oracle) — một TLS ApplicationData record duy nhất, tối đa 16 KB: */
resp_per_record_iv = server_write_iv XOR (0x00^4 || resp_seq_no_uint64_be)
resp_AAD           = 0x17 0x03 0x03 <resp_ciphertext_len_uint16_be>   // header TLS record 5 byte
resp_plaintext, resp_tag_valid = AES_128_GCM_decrypt(
    server_write_key, resp_per_record_iv, response_ciphertext, resp_AAD)
resp_tag_valid = true                                           ← circuit constraint; hash = p.i[1]

/* Request (oracle → server) — ràng buộc HTTP URL vào proof: */
req_per_record_iv  = client_write_iv XOR (0x00^4 || req_seq_no_uint64_be)
req_AAD            = 0x17 0x03 0x03 <req_ciphertext_len_uint16_be>
req_plaintext, req_tag_valid = AES_128_GCM_decrypt(
    client_write_key, req_per_record_iv, request_ciphertext, req_AAD)
req_tag_valid = true                                            ← circuit constraint; hash = p.i[2]
request_path = parse_http_request_path(req_plaintext)
request_path = origin_path                                      ← circuit constraint; hash = p.i[5]

/* Bước 7 — Trích xuất */
extract(resp_plaintext, selector) = claim_value                 ← circuit constraint; encoded = p.i[7]
```

Đầu vào công khai (9 phần tử trong `p.i`, tất cả là BN254 scalar — xem §6 định dạng attestation):

| Chỉ số `p.i` | Giá trị | Ghi chú |
|---|---|---|
| 0 | `SHA256(server_cert)` | Verifier hash `att.s.c` để kiểm tra |
| 1 | `SHA256(response_ciphertext)` | Verifier hash `att.s.r` để kiểm tra |
| 2 | `SHA256(request_ciphertext)` | Ràng buộc URL request; verifier hash `att.s.q` |
| 3 | `transcript_hash_cv` | Hash 32-byte; verifier kiểm tra với `att.s.h` |
| 4 | `SHA256(origin_host)` | Ràng buộc hostname; verifier hash `att.o.h` |
| 5 | `SHA256(origin_path)` | Ràng buộc URL path; verifier hash `att.o["/"]` |
| 6 | `selector_hash` | Hash của extraction path; verifier tính lại từ `att.x["/"]` |
| 7 | `claim_value` | Giá trị đã chứng minh: nếu ≤ 31 byte UTF-8 → big-endian integer của bytes; nếu dài hơn → `SHA256(UTF-8 bytes)` cắt bớt còn 31 byte |
| 8 | `timestamp` | Giây unix (`att[">"`) dưới dạng BN254 scalar; verifier kiểm tra `p.i[8] == att[">"` trước pairing |

Đầu vào bí mật: `oracle_ephem_priv`, `server_ephem_pub`, `server_hello_bytes`,
`client_hello_bytes`, `enc_exts_bytes`, `cert_bytes`, `server_finished_bytes`,
`cert_verify_sig`, `resp_plaintext`, `req_plaintext`, `resp_seq_no`, `req_seq_no`

> `timestamp` (`att[">"`) là public input `p.i[8]` (giây unix dưới dạng BN254 scalar). Verifier xác nhận `p.i[8] == att[">"` trong bước pre-pairing. Điều này ràng buộc ràng buộc cửa sổ hiệu lực chứng chỉ (`leaf.notBefore ≤ timestamp ≤ leaf.notAfter`) với thời gian thực tế — ngăn oracle cung cấp timestamp giả làm cho chứng chỉ hết hạn trông vẫn hợp lệ. `sign: true` trong PEN soul bổ sung thêm ràng buộc timestamp qua key ZEN của oracle, thực thi tính mới qua `maxAge`.

**Mô hình tin cậy:** Không cần tin cậy, có điều kiện:
1. Ít nhất một trong số 54 contributor Hermez ptau đã huỷ toxic waste của họ
2. Không có root CA nào trong bundle nhúng hiện đang bị xâm phạm

**Ước tính constraint:**

| Thành phần | Constraints |
|-----------|-------------|
| Nhân vô hướng P-256 ECDH (mô phỏng trong trường BN254) | ~4 500 000 |
| CertificateVerify RSA-PSS (2048-bit, e=65537) | ~3 000 000 |
| Lịch trình key HKDF-SHA256 (RFC 8446 HKDF-Expand-Label, cả hai traffic secret) | ~130 000 |
| Giải mã AES-128-GCM phản hồi + auth tag (~1 KB) | ~350 000 |
| Giải mã AES-128-GCM request + trích xuất URL (~100 B) | ~80 000 |
| Xác minh chuỗi chứng chỉ X.509 (chuỗi RSA 2-cert) | ~700 000 |
| Ràng buộc hostname (trích xuất DER SAN/CN) | ~50 000 |
| Cửa sổ hiệu lực chứng chỉ (notBefore/notAfter) | ~20 000 |
| Tính lại transcript_hash_cv (SHA-256 của handshake bytes) | ~120 000 |
| Trích xuất JSON / regex | ~80 000 |
| **Tổng (chứng chỉ RSA-2048, phản hồi 1 KB)** | **~9 030 000** |

> Nếu máy chủ dùng chứng chỉ ECDSA P-256, CertificateVerify tốn ~9 000 000 thay thế → tổng ~15 030 000.

- Tạo proof: ~5–15 phút phía server (Node.js BigInt); ~30–60 giây với GPU
- Kích thước proof: 192 byte
- Xác minh: < 1 ms

> **Thiết lập tin cậy:** Cần `powersOfTau28_hez_final_24.ptau` (2²⁴, ~8.5 GB) từ lễ nghi Hermez công khai ([tải về](https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_24.ptau)). Tải một lần, tạo `lib/zktls_tls13.zkey` + `vk.json` cục bộ.

---

## 6. Định dạng attestation

Mỗi attestation là một object JSON thuần, được lưu trong `msg.put["&"]` trên ZEN wire và tuỳ chọn được lưu trữ trong đồ thị.

Tất cả key là 1 ký tự. `&` là key wire-level trên `msg.put` (tượng hình "và/kèm theo" — proof đi kèm giá trị được ghi; chưa dùng trong không gian giao thức ZEN: `~` là user namespace, `@` là reply-to, `#` là soul, `^` là PoW nonce, `$` được đặt trước cho tính năng ownership). Attestation mang cả ZK proof **và dữ liệu nhân chứng công khai** mà verifier cần để tái tạo tất cả `p.i` public inputs.

**Chú giải key 1 ký tự:**

| Key | Tên đầy đủ | Mức |
|-----|-----------|-------|
| `c` | circuit | top |
| `o` | origin | top |
| `o.h` | host | origin |
| `o["/"]` | path | origin (`/` = path, tượng hình) |
| `o.m` | method | origin |
| `x` | extract | top |
| `x.t` | type | extract |
| `x["/"]` | path | extract |
| `v` | value/claim | top |
| `v.v` | value | claim |
| `v.t` | type | claim |
| `s` | session (dữ liệu TLS) | top |
| `s.c` | server cert | session |
| `s.r` | response ciphertext | session |
| `s.q` | request (query) ciphertext | session |
| `s.h` | transcript hash (cv) | session |
| `p` | proof | top |
| `p.a` | pi_a | proof |
| `p.b` | pi_b | proof |
| `p.c` | pi_c | proof |
| `p.i` | public inputs array | proof |
| `>` | timestamp | top (quy ước thời gian ZEN) |
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
    "h": "<base62 SHA-256 32-byte của handshake đến Certificate>"
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

**Tái tạo `p.i` của verifier (trước kiểm tra pairing):**

| Chỉ số `p.i` | Verifier tính | Verifier so sánh với |
|---|---|---|
| 0 | `SHA256(base64_decode(att.s.c))` | `att.p.i[0]` |
| 1 | `SHA256(base64_decode(att.s.r))` | `att.p.i[1]` |
| 2 | `SHA256(base64_decode(att.s.q))` | `att.p.i[2]` |
| 3 | `base62_decode(att.s.h)` | `att.p.i[3]` |
| 4 | `SHA256(att.o.h)` | `att.p.i[4]` |
| 5 | `SHA256(att.o["/"])` | `att.p.i[5]` |
| 6 | tính lại `selector_hash` từ `att.x["/"]` | `att.p.i[6]` |
| 7 | `encode_claim(att.v.v)` — nếu ≤ 31 byte: big-endian int của UTF-8 bytes; nếu không: `SHA256(UTF-8 bytes)` cắt còn 31 byte | `att.p.i[7]` |
| 8 | `att[">"` dưới dạng integer | `att.p.i[8]` |

Nếu bất kỳ kiểm tra nào thất bại, verifier từ chối trước khi gọi `groth16_verify` trong WASM.

| Key | Bắt buộc | Mô tả |
|-----|----------|-------------|
| `c` | ✓ | `"tls13"` hoặc tên circuit đã đăng ký tuỳ chỉnh |
| `o.h` | ✓ | Hostname của máy chủ HTTPS |
| `o["/"]` | ✓ | Request path + query string |
| `o.m` | — | HTTP method, mặc định `"GET"` |
| `x.t` | ✓ | `"json"`, `"regex"`, hoặc `"text"` |
| `x["/"]` | ✓ | JSON path dạng dot-notation hoặc regex với một capture group |
| `v.v` | ✓ | Giá trị đã trích xuất được chứng minh (dạng chuỗi) |
| `v.t` | — | `"string"`, `"number"`, `"boolean"` |
| `s.c` | ✓ | Chuỗi chứng chỉ DER mã hoá Base64 |
| `s.r` | ✓ | TLS ApplicationData record thô Base64 (server → oracle) |
| `s.q` | ✓ | TLS ApplicationData record thô Base64 (oracle → server, HTTP request) |
| `s.h` | ✓ | SHA-256 32-byte Base62 của handshake đến Certificate (cho CertificateVerify) |
| `p.a/b/c` | ✓ | Các điểm proof Groth16 (mã hoá base62) |
| `p.i` | ✓ | Mảng 8 phần tử public inputs Groth16 (BN254 scalar base62) |
| `>` | ✓ | Unix giây khi lấy dữ liệu (ký trong phong bì ZEN của oracle, không nằm trong `p.i`) |
| `e` | — | Cửa sổ tính mới của attestation (giây) |

---

## 7. `zktls.prove(opt)` — lấy dữ liệu và tạo proof

Bất kỳ peer nào cũng có thể đóng vai oracle. Lấy phản hồi HTTPS và tạo SNARK proof đầy đủ bằng BigInt Groth16 prover bên trong `lib/zktls.js`. Proving key (`.zkey`) được tải lazy khi lần đầu gọi.

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
  pair:    oraclePair,    // cặp key ZEN của oracle (ký phong bì attestation)
  ttl:     3600,
})
```

**Tuỳ chọn:**

| Tuỳ chọn | Mô tả |
|--------|-------------|
| `url` | URL HTTPS đầy đủ để lấy dữ liệu |
| `method` | HTTP method, mặc định `"GET"` |
| `headers` | Request headers |
| `extract.type` | `"json"`, `"regex"`, hoặc `"text"` |
| `extract.path` | JSON path hoặc regex với một capture group |
| `root_cas` | Mảng các chứng chỉ root CA mã hoá DER. Mặc định là bộ Mozilla NSS (15 root hàng đầu). |
| `capture` | `'response_only'` (mặc định) hoặc `'full_session'` (gồm handshake để kiểm tra). |
| `pair` | Cặp key ZEN của oracle (ký phong bì attestation) |
| `ttl` | Cửa sổ tính mới của attestation tính bằng giây |

**Các kiểu trích xuất:**

| Kiểu | `path` | Trích xuất |
|------|--------|---------|
| `'json'` | Dot-notation: `'.data.price'`, `'.items[0].id'` | Giá trị JSON đã phân tích |
| `'regex'` | Regex với một capture group: `'"price":"(\\d+\\.?\\d*)"'` | Capture group đầu tiên |
| `'text'` | `null` | Toàn bộ nội dung phản hồi dạng chuỗi |

### Cách oracle thu thập dữ liệu TLS session

Module `tls` tích hợp của Node.js không tiết lộ ephemeral ECDH private key — thông tin cần thiết để xây dựng ZK witness. Do đó `lib/zktls.js` triển khai một **TLS 1.3 client tối thiểu** tự tạo cặp key tạm thời riêng và giữ lại toàn bộ trạng thái session:

```
Oracle                                    Server
  │──── ClientHello (oracle_ephem_pub) ─────▶│  ← thu client_hello_bytes
  │◀─── ServerHello (server_ephem_pub) ──────│  ← thu server_hello_bytes
  │◀─── {EncExtensions, Certificate,         │  ← thu enc_exts_bytes, cert_bytes,
  │      CertificateVerify, Finished} ───────│    cert_verify_sig, server_finished_bytes
  │                                           │
  │  oracle tính toán (RFC 8446 §7.1):        │
  │    transcript_hash_cv = SHA256(ClientHello || ServerHello || EncExts || Cert)
  │    HS = ECDH(oracle_ephem_priv, server_ephem_pub)
  │    [lịch trình key HKDF-Expand-Label đầy đủ]
  │    client_write_key, server_write_key, ivs được derive
  │                                           │
  │──── {Finished} ─────────────────────────▶│
  │──── {ApplicationData (HTTP request)} ────▶│  ← thu request_ciphertext
  │◀─── {ApplicationData (HTTP response)} ───│  ← thu response_ciphertext
```

Sau khi session hoàn tất, oracle nắm giữ toàn bộ dữ liệu private witness cho circuit:

| Giá trị thu được | Vai trò trong circuit |
|----------------|---------|
| `oracle_ephem_priv` | Private input — ECDH scalar |
| `server_ephem_pub` | Private input — được trích xuất từ `server_hello_bytes` bên trong circuit |
| `client_hello_bytes` | Private input — được hash trong circuit để ràng buộc `transcript_hash_cv` |
| `server_hello_bytes` | Private input — được hash trong circuit; `server_ephem_pub` được trích xuất ở đây |
| `enc_exts_bytes`, `cert_bytes` | Private inputs — được hash trong circuit cho `transcript_hash_cv` |
| `cert_verify_sig` | Private input — được xác minh với `server_cert_pub` và `transcript_hash_cv` |
| `server_finished_bytes` | Private input — hoàn thành `transcript_hash_full` cho lịch trình key |
| `server_cert` (chuỗi DER) | Public input — lưu tại `att.s.c`; `att.p.i[0]` = SHA256 hash |
| `response_ciphertext` (TLS record thô) | Public input — lưu tại `att.s.r`; `att.p.i[1]` = SHA256 hash |
| `request_ciphertext` (TLS record thô) | Public input — lưu tại `att.s.q`; `att.p.i[2]` = SHA256 hash |
| `transcript_hash_cv` | Public input — lưu tại `att.s.h`; `att.p.i[3]` |

Cách tiếp cận này hoàn toàn tự chứa — không cần ghi log key ở tầng OS, không có proxy bên ngoài, không có hook phụ thuộc nền tảng.

> **Yêu cầu trao đổi key P-256:** TLS client của oracle quảng bá `key_share` P-256 trong ClientHello. Circuit triển khai ECDH trên P-256 (không phải X25519). Hầu hết server HTTPS hỗ trợ cả P-256 lẫn X25519 trong TLS 1.3, nhưng server nào đã vô hiệu hoá P-256 hoàn toàn sẽ từ chối kết nối. Nếu một server đích chỉ hỗ trợ X25519, cần có biến thể circuit riêng với constraint Curve25519.

---

## 8. `zktls.verify(attestation, policy?)` — xác minh một proof

Chạy trên bất kỳ peer ZEN nào, trình duyệt hay server. Gọi `lib/zktls.wasm` để kiểm tra pairing. Không yêu cầu proving key `.zkey`.

```js
const ok = await zktls.verify(attestation)
// hoặc với các ràng buộc chính sách:
const ok = await zktls.verify(attestation, {
  host:      'api.coingecko.com',
  path:      '/api/v3/simple/price',
  maxAge:    300,               // từ chối nếu timestamp > 5 phút trước
  claimType: 'number',
})
```

Các trường chính sách:

| Trường | Tác dụng |
|-------|--------|
| `host` | Phải khớp với `att.o.h` |
| `path` | Khớp tiền tố với `att.o["/"]` (path + query string). `'/api/v3/simple/price'` khớp với bất kỳ URL nào dưới path đó, kể cả các query string khác nhau. Để khóa chặt đúng URL, bao gồm cả query string trong `tls.path` của soul. |
| `maxAge` | Từ chối nếu `Date.now()/1000 - att[">"] > maxAge` |
| `claimType` | `att.v.v` phải phân tích được thành kiểu này |

---

## 9. Chính sách PEN — `spec.tls` trong `ZEN.pen()`

Mã hoá yêu cầu zkTLS trực tiếp vào một PEN soul. Chính sách được thực thi trên mỗi lần ghi vào soul đó, bởi mỗi peer độc lập.

```js
import ZEN from './zen.js'

const soul = ZEN.pen({
  key:  myKeyExpr,
  sign: true,         // cũng yêu cầu chữ ký ZEN của oracle
  tls: {
    host:     'api.coingecko.com',
    path:     '/api/v3/simple/price',
    maxAge:   60,
    claimType: 'number',
  }
})

// soul bắt đầu bằng '!', nhúng cả predicate bytecode và 0xC5 tail policy
```

**Cách thực thi hoạt động:**
1. Lệnh ghi đến một soul có tiền tố `!`.
2. PEN đánh giá biểu thức predicate (key, val, v.v.) thông qua `pen.wasm`.
3. ZEN bridge đọc `msg.put["&"]` (attestation).
4. `zktls.verify(attestation, policy.tls)` được gọi.
5. Nếu xác minh thất bại → lệnh ghi bị từ chối, bị bỏ lặng lẽ (giống mọi từ chối HAM/policy).

### Mã hoá PEN opcode 0xC5

`spec.tls` được biên dịch thành một byte `0xC5` theo sau là chính sách được tuần tự hoá. Zig VM (`pen.wasm`) không xử lý opcode này — nó được xử lý hoàn toàn bởi `applypolicy()` trong `src/pen.js`.

`applypolicy()` kiểm tra `att.c` so với trường `circuit` của policy và từ chối nếu không khớp. Điều này ngăn kẻ tấn công ghi một attestation có `c: "my-circuit"` (một verifier tùy chỉnh luôn trả về `true`) vào một soul được biên dịch cho `"tls13"`.

```
0xC5
<circuit_len: u8>  <circuit: utf8>           ví dụ "tls13" (bắt buộc — không có default để tránh bypass)
<host_len: u8>     <host: utf8>
<path_len: u8>     <path: utf8>
<flags: u8>                                  bit 0 = has_maxAge
                                             bit 1 = has_claimType
[<maxAge: u32le>]                            nếu has_maxAge
[<claimType_len: u8> <claimType: utf8>]      nếu has_claimType
```

---

## 10. Ghi với một zkTLS attestation

### Phương án A — attestation đã được prove trước

Oracle prove trước, sau đó ghi:

```js
import ZEN   from './zen.js'
import zktls from './lib/zktls.js'

const pair = await ZEN.pair()

const soul = ZEN.pen({
  sign: true,
  tls:  { host: 'api.coingecko.com', path: '/api/v3/simple/price', maxAge: 60, claimType: 'number' }
})

// Prove (mất ~5–15 phút cho circuit tls13)
const att = await zktls.prove({
  url:     'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
  extract: { type: 'json', path: '.bitcoin.usd' },
  pair,
})

// Ghi — truyền attestation vào opt.tls
const zen = new ZEN({ peers: ['ws://relay.example.com'] })
zen.get(soul).get('btcUsd').put(att.v.v, null, {
  authenticator: pair,
  tls: att,
})
// put.js ký { v: att.v.v, ph: SHA256(att.p) } — ràng buộc giá trị với proof cụ thể này
// để kẻ tấn công không thể hoán đổi att với một attestation cũ hơn cùng giá trị
```

### Phương án B — tự động prove inline

Truyền `tls` như một cấu hình fetch. ZEN gọi `zktls.prove()` bên trong trước khi put:

```js
zen.get(soul).get('btcUsd').put(null, null, {
  authenticator: pair,
  tls: {
    url:     'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    extract: { type: 'json', path: '.bitcoin.usd' },
  }
})
// att.v.v được tự động đặt làm giá trị được ghi
// msg.put["&"] được tự động đặt thành attestation
```
### Phương án C — đọc dữ liệu có chứng thực zkTLS

Attestation được lưu trong `_["&"]` của graph node — một trường metadata tương tự HAM state `_[">"]`. Nó di chuyển cùng node trong lúc sync. Bất kỳ peer nào cũng có thể đọc nó qua chain method `.tls()`, có hoặc không có tái xác minh:

```js
// Chỉ đọc giá trị — giống mọi get thông thường (không thay đổi cách dùng thông thường)
zen.get(soul).get('btcUsd').on(val => {
  console.log(val) // "42150.73"
})

// Đọc attestation + giá trị cùng lúc
zen.get(soul).get('btcUsd').tls((att, val) => {
  console.log(val)       // "42150.73"
  console.log(att.c)     // "tls13"
  console.log(att.o.h)   // "api.coingecko.com"
  console.log(att[">"])  // 1714060800 (giây unix khi lấy dữ liệu)
})

// Tái xác minh rõ ràng khi đọc (tuỳ chọn — xác minh đã chạy lúc ghi
// trên mọi peer chấp nhận; đây dành cho kiểm toán hoặc chuyển tiếp đến bên thứ ba)
zen.get(soul).get('btcUsd').tls(async (att, val) => {
  const ok = await zktls.verify(att, {
    host:   'api.coingecko.com',
    maxAge: 3600,
  })
  console.log(ok) // true
})
```

**Lưu trữ:** `put.js` nhúng attestation vào `node._["&"]` khi xử lý `opt.tls`. Trường `_["&"]` là một phần của metadata ZEN node (cùng với `_["#"]` soul và `_[">"]` HAM state) và không bao giờ được coi là dữ liệu người dùng.

**Vòng đời xác minh:**
- **Lúc ghi** — mọi peer chấp nhận `put` đều chạy `zktls.verify()` qua PEN opcode `0xC5`. Giá trị chỉ đi vào graph nếu proof hợp lệ.
- **Lúc đọc** — xác minh KHÔNG tự động. Gọi `zktls.verify()` rõ ràng bên trong `.tls(cb)` nếu cần tái xác minh độc lập (ví dụ: chuyển tiếp proof đến hệ thống bên ngoài).

**Thay đổi cần thiết trong `get.js`:** Thêm `.tls()` vào `Zen.chain` — đọc `_["&"]` từ node đã giải quyết và gọi `cb(attestation, value)`.
---

## 11. Circuit tuỳ chỉnh

Đăng ký một circuit với `zktls.register(name, { prove, verify })`:

```js
zktls.register('my-circuit', {
  // ctx: { url, method, headers, response (raw string), origin, extract, claim }
  async prove(ctx) {
    // Tạo dữ liệu proof. Trả về bất kỳ object có thể JSON-serialise.
    return { a: '...', b: '...', c: '...', i: ['...'] }
  },
  // att: object Attestation đầy đủ bao gồm att.p
  async verify(att, policy) {
    // Gọi lib/zktls.wasm hoặc xác minh pure JS.
    // Trả về true hoặc false.
    return true
  }
})
```

Circuit tuỳ chỉnh dùng cùng định dạng wire (`msg.put["&"]`) và cùng PEN opcode (`0xC5`). Trường `c` trong attestation định tuyến đến handler đã đăng ký đúng.

---

## 12. Sử dụng độc lập (không có ZEN graph)

`lib/zktls.js` có thể dùng như một thư viện proof thuần độc lập với ZEN:

```js
import zktls from './lib/zktls.js'
import ZEN    from './zen.js'

// Tạo proof (bất kỳ peer nào đóng vai oracle)
const pair = await ZEN.pair()
const att  = await zktls.prove({
  url:     'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
  extract: { type: 'json', path: '.bitcoin.usd' },
  pair,
})

// Tuần tự hoá
const json = JSON.stringify(att)

// Xác minh ở bất cứ đâu (trình duyệt hoặc server) — không cần zkey
const ok = await zktls.verify(JSON.parse(json), {
  host:    'api.coingecko.com',
  maxAge:  3600,
})

console.log(ok) // true
```

---

## 13. Thiết lập tin cậy

Circuit `tls13` sử dụng Groth16, yêu cầu một lần **thiết lập tin cậy**. ZEN zkTLS sử dụng lễ nghi **Hermez Powers of Tau** công khai (2020–2021, 54 contributor + randomness beacon, toxic waste được chứng minh là đã huỷ):

| Circuit | Constraints | ptau cần thiết | Kích thước file |
|---------|-------------|--------------|-----------|
| `tls13` (chứng chỉ RSA-2048) | ~9 030 000 | `powersOfTau28_hez_final_24.ptau` (2²⁴) | ~8.5 GB |
| `tls13` (chứng chỉ ECDSA P-256) | ~15 030 000 | `powersOfTau28_hez_final_24.ptau` (2²⁴) | ~8.5 GB |

> 2²³ (~8.4 M) không đủ cho circuit đầy đủ với CertificateVerify. Dùng `powersOfTau28_hez_final_24.ptau` (2²⁴ = 16.7 M dung lượng constraint).

**Tải về chính thức** (do Polygon/zkEVM host trên Google Cloud Storage, ghi lại trong [snarkjs README §7](https://github.com/iden3/snarkjs#7-prepare-phase-2)):

```bash
wget https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_24.ptau
# BLAKE2b-512: fa404d140d5819d39984833ca5ec3632cd4995f81e82db402371a4de7c2eae86
#              87c62bc632a95b0c6aadba3fb02680a94e09174b7233ccd26d78baca2647c733
```

File ptau được tải một lần và dùng để tạo `.zkey` (proving key) cho từng circuit:

```bash
npm run zktls:setup   # tạo lib/zktls_tls13.zkey + nhúng vk vào lib/zktls.wasm
```

File `.zkey` (~4–6 GB) chỉ cần thiết trên các oracle node (prover). Verification key (`vk.json`, ~2 KB) được trích xuất từ `.zkey` và nhúng vào `lib/zktls.wasm` lúc build — tất cả peer xác minh chỉ cần WASM.

---

## 14. Mô hình bảo mật

| Mối đe doạ | Phòng thủ | Tầng |
|--------|---------|-------|
| Oracle dùng máy chủ giả | Chứng chỉ máy chủ phải chuỗi đến root CA nhúng — giả mạo đòi hỏi phải xâm phạm một root CA | Circuit (Bước 1) |
| Oracle khai sai domain (chứng chỉ cho `evil.com`) | `extract_SAN_or_CN(cert) = origin_host` là circuit constraint; hostname không khớp → proof không hợp lệ | Circuit (Bước 2) |
| Oracle swap `server_ephem_pub` (MITM) | Chữ ký `CertificateVerify` trên `transcript_hash_cv` (chứa ServerHello với `server_ephem_pub` thật) được xác minh trong circuit với `server_cert_pub` — swap không có cert private key của server → sig fail | Circuit (Bước 3) |
| Oracle thay đổi response ciphertext | Kiểm tra AES-GCM auth tag ở trong circuit; `SHA256(ciphertext)` là `p.i[1]` — không khớp → từ chối trước pairing | Circuit (Bước 6) |
| Oracle lấy URL khác | HTTP request được giải mã trong circuit dưới cùng session key; `request_path = origin_path` là circuit constraint | Circuit (Bước 6) |
| Oracle khai sai giá trị trích xuất | `extract(resp_plaintext, selector) = claim_value` là circuit constraint | Circuit (Bước 7) |
| Oracle replay dữ liệu cũ | `timestamp = p.i[8]` pin thời gian fetch vào SNARK; `sign: true` + `maxAge` thực thi tính mới qua chữ ký ZEN của oracle | Circuit (Bước 1) + Chữ ký attestation |
| Oracle cung cấp timestamp giả để qua cert hết hạn | `timestamp` là `p.i[8]` — public input; verifier kiểm tra `p.i[8] == att[">"]` trước khi gọi WASM; không khớp → từ chối | Kiểm tra pre-pairing |
| Hoán đổi attestation (thay `att` bằng proof cũ hơn cùng giá trị) | `put.js` ký `{ v: att.v.v, ph: SHA256(att.p) }`; SNARK proof là duy nhất theo session — thay `att` thay đổi `att.p`, làm chữ ký không hợp lệ | Chữ ký attestation |
| Bypass custom circuit (`att.c: "luon-dung-circuit"`) | Policy 0xC5 nhúng tên `circuit`; `applypolicy()` từ chối nếu `att.c ≠ policy.circuit`; không có default | Policy 0xC5 |
| Chứng chỉ hết hạn | `notBefore ≤ timestamp ≤ notAfter` là circuit constraint; `timestamp = p.i[8]` là thời gian fetch thực tế | Circuit (Bước 1) |
| Root CA bị xâm phạm | Cập nhật danh sách root CA nhúng → rebuild `lib/zktls.wasm` → redeploy | Tái triển khai |
| Tấn công toxic waste Groth16 | Dùng lễ nghi Hermez công khai (54 contributor + beacon); `vk.json` được pin trong WASM — bất kỳ giả mạo nào đều có thể phát hiện | Thiết lập tin cậy |
| Chứng chỉ bị thu hồi (CRL/OCSP) | Không thể kiểm tra trong circuit tĩnh; giảm thiểu bằng `maxAge` ngắn + key rotation của oracle | Policy (một phần) |
| Response body > 16 KB (nhiều record) | Không hỗ trợ trong circuit `tls13` — chỉ một TLS ApplicationData record; `prove()` từ chối nếu response trải trên nhiều record | Kiểm tra triển khai |

### Proof đảm bảo những gì (và không đảm bảo những gì)

**Đảm bảo (circuit thực thi):**
- Plaintext phản hồi được giải mã AES-128-GCM từ `response_ciphertext` với auth tag nguyên vẹn
- Session key được derive từ ECDH với `server_ephem_pub` được ràng buộc với `server_cert` qua `CertificateVerify`
- `server_cert` chuỗi đến một root CA nhúng và SAN/CN của nó khớp với `origin.host`
- `server_cert` nằm trong cửa sổ hiệu lực của nó tại `timestamp` (thời gian fetch thực tế, `p.i[8]`)
- HTTP request giải mã từ `request_ciphertext` có path khớp với `origin.path`
- `v.v` là trích xuất đúng của `x["/"]` từ phản hồi
- SNARK được tạo cho `timestamp = att[">"]` (không phải thời gian giả được chọn riêng)

**KHÔNG đảm bảo (ngoài circuit):**
- Chứng chỉ chưa bị thu hồi (CRL/OCSP không trong circuit)
- Bộ root CA không lỗi thời (vấn đề vận hành — yêu cầu rebuild WASM khi CA thay đổi)
- Máy oracle không bị xâm phạm lúc prove (attacker có `.zkey` + máy oracle có thể forge bất kỳ proof nào)
- Response body vừa trong một TLS ApplicationData record (≤ 16 KB)

---

## 15. Nội bộ lib/zktls.wasm

Được biên dịch từ `lib/zk/tls/*.zig`. Độc lập, không có import.

**Exports:**

| Export | Chữ ký | Mô tả |
|--------|-----------|-------------|
| `groth16_verify` | `(vk_ptr, proof_ptr, pub_ptr, pub_len) → i32` | Trả về 1 nếu hợp lệ, 0 nếu không hợp lệ |
| `alloc` | `(size: u32) → ptr: u32` | WASM allocator |
| `free` | `(ptr: u32, size: u32)` | WASM allocator |
| `mem` | `() → ptr: u32` | Trả về con trỏ đến vùng bộ nhớ chia sẻ |

**Module nội bộ (Zig):**

| File | Số dòng (ước tính) | Mục đích |
|------|-------------|-------|
| `lib/zk/tls/main.zig` | — | Zig root — `@import` tất cả sub-module; điểm vào biên dịch |
| `lib/zk/tls/bn254_fp.zig` | ~200 | Trường BN254 Fp (nhân Montgomery 254-bit) |
| `lib/zk/tls/bn254_fp2.zig` | ~100 | Mở rộng Fp2 (bậc hai) |
| `lib/zk/tls/bn254_fp6.zig` | ~120 | Tháp Fp6 (bậc ba trên Fp2) |
| `lib/zk/tls/bn254_fp12.zig` | ~120 | Tháp Fp12 (bậc hai trên Fp6) |
| `lib/zk/tls/bn254_g1.zig` | ~80 | Phép toán nhóm G1 (affine + Jacobian) |
| `lib/zk/tls/bn254_g2.zig` | ~80 | Phép toán nhóm G2 |
| `lib/zk/tls/bn254_pairing.zig` | ~150 | Ate pairing + Miller loop + final expo |
| `lib/zk/tls/groth16.zig` | ~60 | Verifier Groth16 (3 pairings + 1 MSM) |

**Kích thước ước tính:** ~35–45 KB biên dịch (`-O ReleaseSmall`).

> AES-128-GCM và SHA-256 là R1CS constraints được xác minh ngầm bởi kiểm tra pairing — WASM verifier không thực thi lại chúng.

---

## 16. Nội bộ `lib/zktls.js`

Mã nguồn module hoá dưới `lib/zk/tls/`. Không có dependency bên ngoài. Không có Circom. Ma trận constraint R1CS được viết trực tiếp dưới dạng object JS. Tái sử dụng curve P-256 hiện có của ZEN (`src/curves/p256.js`) cho bước TLS ECDH.

| File nguồn | Số dòng (ước tính) | Mục đích |
|------------|-------------|-------|
| `lib/zk/tls/tls.js` | ~900 | TLS 1.3 client — handshake, thu thập session key, record layer |
| `lib/zk/tls/bn254.js` | ~200 | Số học BigInt BN254 (Montgomery, Fp, phép toán điểm) |
| `lib/zk/tls/groth16.js` | ~400 | Groth16 prover (NTT, MSM, cam kết đa thức) |
| `lib/zk/tls/r1cs.js` | ~600 | Ma trận constraint R1CS cho circuit `tls13` |
| `lib/zk/tls/witness.js` | ~400 | Tạo witness (trạng thái TLS session → BN254 field elements) |
| `lib/zk/tls/setup.js` | ~200 | Tiện ích thiết lập Phase 2 (`ptau → zkey`, trích xuất vk) |
| `lib/zk/tls/verify.js` | ~100 | Bộ tải verifier WASM (tái tạo `p.i`, gọi `groth16_verify`) |
| `lib/zk/tls/index.js` | ~150 | Entry point + API công khai (`prove / verify / setup / register`) |

`lib/zktls.js` là build output (bundle với mẫu `defmod/reqmod` từ `lib/builder/zen.js`). `lib/zktls.min.js` là file production. Sửa các file nguồn trong `lib/zk/tls/` rồi chạy lại build.

Mẫu gọi theo vai trò:

```js
// Bất kỳ peer nào — chỉ verify (tải ~35–45 KB WASM, không cần zkey):
import zktls from './lib/zktls.min.js'
const ok = await zktls.verify(attestation, policy)

// Bất kỳ peer nào đóng vai oracle — prove + verify:
const att = await zktls.prove({ url, extract, ... })
// .zkey được tải lazy từ đĩa khi lần đầu gọi prove()

// Thiết lập tin cậy một lần (chạy một lần sau khi tải powersOfTau28_hez_final_24.ptau):
await zktls.setup('tls13', './powersOfTau28_hez_final_24.ptau', './lib/zktls_tls13.zkey')
```

---

## 17. Build

```bash
# Build WASM verifier + bundle các JS module + minify
npm run buildZKTLS
# tạo ra: lib/zktls.wasm  lib/zktls.js (bundle)  lib/zktls.min.js (production)

# Tạo thiết lập tin cậy cho circuit tls13
# (tải powersOfTau28_hez_final_24.ptau ~8.5 GB, một lần)
npm run zktls:setup

# Chạy test zkTLS
npm run testZKTLS
```

`lib/builder/zktls.js` thực hiện ba bước liên tiếp trong một script duy nhất:
1. Biên dịch `lib/zk/tls/*.zig` → `lib/zktls.wasm` (điểm vào: `lib/zk/tls/main.zig`; mẫu từ `lib/builder/pen.js`)
2. Duyệt import từ `lib/zk/tls/index.js` và bundle thành `lib/zktls.js` dùng cùng mẫu `defmod/reqmod` như `lib/builder/zen.js`
3. Minify `lib/zktls.js` → `lib/zktls.min.js` (`uglifyjs --module -c -m`)

`lib/zktls.js` là build output — sửa các file nguồn trong `lib/zk/tls/` rồi chạy lại build.

---

## 18. Tham chiếu file

| File | Vai trò |
|------|------|
| `lib/zk/tls/index.js` | Entry point + API công khai (`prove / verify / setup / register`) |
| `lib/zk/tls/tls.js` | TLS 1.3 client — handshake, thu thập session key, record layer |
| `lib/zk/tls/bn254.js` | Số học BigInt BN254 (Montgomery, Fp, phép toán điểm) |
| `lib/zk/tls/groth16.js` | Groth16 prover (NTT, MSM, cam kết đa thức) |
| `lib/zk/tls/r1cs.js` | Ma trận constraint R1CS cho circuit `tls13` |
| `lib/zk/tls/witness.js` | Tạo witness (trạng thái TLS session → BN254 field elements) |
| `lib/zk/tls/setup.js` | Tiện ích thiết lập Phase 2 (`ptau → zkey`, trích xuất vk) |
| `lib/zk/tls/verify.js` | Bộ tải verifier WASM (tái tạo `p.i`, gọi `groth16_verify`) |
| `lib/zktls.js` | **Build output** — bundle từ `lib/zk/tls/`; không sửa trực tiếp |
| `lib/zktls.min.js` | **File production** — bundle đã minify; dùng trên browser và Node |
| `lib/zktls.wasm` | Groth16 verifier BN254 (Zig, ~35–45 KB, độc lập) |
| `lib/zk/tls/*.zig` | Các module Zig nguồn — biên dịch thành `lib/zktls.wasm` (điểm vào: `lib/zk/tls/main.zig`) |
| `lib/builder/zktls.js` | Script build (Zig → WASM, bundle JS module, minify) |
| `lib/zktls_tls13.zkey` | Proving key cho circuit tls13 (oracle node, ~4–6 GB) |
| `test/zktls.js` | Unit test (verifier, vòng lặp prove/verify) |

Các file `.zkey` không được commit vào repo. Chúng được tạo cục bộ bằng cách chạy `zktls.setup()` sau khi tải file Hermez `.ptau`. Verification key (`vk.json`) được trích xuất từ `.zkey` và nhúng vào `lib/zktls.wasm` lúc build — peer không cần `.zkey` để xác minh.

---

## 19. Triển khai

Triển khai một giai đoạn nhắm vào circuit `tls13` — circuit duy nhất cần thiết cho dữ liệu HTTPS tổng quát không cần tin cậy.

1. `lib/zk/tls/*.js` — mã nguồn module hoá (tls, bn254, groth16, r1cs, witness, setup, verify, index)
2. `lib/zk/tls/*.zig` — Tháp trường BN254 + Groth16 verifier (Zig → WASM)
3. `src/pen.js` — opcode `0xC5` trong `scanpolicy` + `applypolicy`
4. `src/put.js` — `opt.tls` tự động prove, gắn `msg.put["&"]`, lưu attestation vào `node._["&"]`
5. `src/get.js` — chain method `.tls(cb)` đọc `_["&"]` từ node đã giải quyết, gọi `cb(att, val)`
6. `lib/builder/zktls.js` — Zig → WASM + bundle `lib/zk/tls/index.js` → `lib/zktls.js` + minify → `lib/zktls.min.js`
7. `package.json` — các script `buildZKTLS`, `zktls:setup`, `testZKTLS`
8. `test/zktls.js` — test vòng lập prove + verify + đọc qua `.tls()`

