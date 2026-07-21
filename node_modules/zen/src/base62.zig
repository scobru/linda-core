// src/base62.zig — Base62 codec. No stdlib. Freestanding WASM-compatible.
// Alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
// PUB_LEN = 44: a 32-byte (256-bit) value always encodes to exactly 44 chars.
//   Proof: log_62(2^256) ≈ 43.03 → ceil = 44. Left-padded with '0'.
//
// Replaces the BigInt-heavy JS implementation with native u256/u512 arithmetic.

pub const PUB_LEN: usize = 44;
const ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// ── Encode ───────────────────────────────────────────────────────────────────

/// Encode 32 bytes as a 44-character base62 string.
pub fn encode32(bytes: *const [32]u8, out: *[PUB_LEN]u8) void {
    var n: u256 = 0;
    for (bytes) |b| {
        n = (n << 8) | b;
    }
    var i: usize = PUB_LEN;
    while (i > 0) {
        i -= 1;
        out[i] = ALPHA[@intCast(n % 62)];
        n /= 62;
    }
    // If n > 0 here, the value didn't fit — shouldn't happen for valid 32-byte input.
}

// ── Decode ───────────────────────────────────────────────────────────────────

fn charToIdx(c: u8) ?u8 {
    if (c >= '0' and c <= '9') return c - '0';
    if (c >= 'A' and c <= 'Z') return c - 'A' + 10;
    if (c >= 'a' and c <= 'z') return c - 'a' + 36;
    return null;
}

/// Decode a 44-character base62 string to 32 bytes.
/// Returns false if any character is invalid or the value overflows 256 bits.
pub fn decode32(input: *const [PUB_LEN]u8, out: *[32]u8) bool {
    // Use u512 accumulator since 62^44 > 2^256 is possible during decoding.
    var n: u512 = 0;
    for (input) |c| {
        const idx = charToIdx(c) orelse return false;
        n = n * 62 + idx;
    }
    if (n >> 256 != 0) return false;
    const v: u256 = @intCast(n);
    var i: usize = 32;
    while (i > 0) {
        i -= 1;
        out[i] = @intCast(v >> @intCast((31 - i) * 8) & 0xff);
    }
    // Re-encode from v correctly (big-endian)
    var vv = v;
    var j: usize = 32;
    while (j > 0) {
        j -= 1;
        out[j] = @intCast(vv & 0xff);
        vv >>= 8;
    }
    return true;
}

// ── bufToB62 ─────────────────────────────────────────────────────────────────
// Encode a buffer of arbitrary length in 32-byte chunks, each chunk → 44 chars.
// out must be at least ceil(in_len / 32) * 44 bytes.

pub fn bufToB62(in: []const u8, out: []u8) void {
    var i: usize = 0;
    var out_off: usize = 0;
    while (i < in.len) : (i += 32) {
        const end = @min(i + 32, in.len);
        var chunk: [32]u8 = [_]u8{0} ** 32;
        const chunk_len = end - i;
        @memcpy(chunk[32 - chunk_len .. 32], in[i..end]);
        encode32(&chunk, out[out_off..][0..PUB_LEN]);
        out_off += PUB_LEN;
    }
}
