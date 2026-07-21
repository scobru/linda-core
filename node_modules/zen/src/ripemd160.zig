// src/ripemd160.zig — Pure RIPEMD-160. No stdlib. Freestanding WASM-compatible.
// Spec: https://homes.esat.kuleuven.be/~bosselae/ripemd160.html
// Ports the existing ripemd160.js to native Zig u32 arithmetic.

const KL = [5]u32{ 0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e };
const KR = [5]u32{ 0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000 };

const ML = [80]u5{
    0, 1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
    7, 4,  13, 1,  10, 6,  15, 3,  12, 0, 9,  5,  2,  14, 11, 8,
    3, 10, 14, 4,  9,  15, 8,  1,  2,  7, 0,  6,  13, 11, 5,  12,
    1, 9,  11, 10, 0,  8,  12, 4,  13, 3, 7,  15, 14, 5,  6,  2,
    4, 0,  5,  9,  7,  12, 2,  10, 14, 1, 3,  8,  11, 6,  15, 13,
};
const MR = [80]u5{
    5,  14, 7,  0, 9, 2,  11, 4,  13, 6,  15, 8,  1,  10, 3,  12,
    6,  11, 3,  7, 0, 13, 5,  10, 14, 15, 8,  12, 4,  9,  1,  2,
    15, 5,  1,  3, 7, 14, 6,  9,  11, 8,  12, 2,  10, 0,  4,  13,
    8,  6,  4,  1, 3, 11, 15, 0,  5,  12, 2,  13, 9,  7,  10, 14,
    12, 15, 10, 4, 1, 5,  8,  7,  6,  2,  13, 14, 0,  3,  9,  11,
};
const SL = [80]u5{
    11, 14, 15, 12, 5,  8,  7,  9,  11, 13, 14, 15, 6,  7,  9,  8,
    7,  6,  8,  13, 11, 9,  7,  15, 7,  12, 15, 9,  11, 7,  13, 12,
    11, 13, 6,  7,  14, 9,  13, 15, 14, 8,  13, 6,  5,  12, 7,  5,
    11, 12, 14, 15, 14, 15, 9,  8,  9,  14, 5,  6,  8,  6,  5,  12,
    9,  15, 5,  11, 6,  8,  13, 12, 5,  12, 13, 14, 11, 8,  5,  6,
};
const SR = [80]u5{
    8,  9,  9,  11, 13, 15, 15, 5,  7,  7,  8,  11, 14, 14, 12, 6,
    9,  13, 15, 7,  12, 8,  9,  11, 7,  7,  12, 7,  6,  15, 13, 11,
    9,  7,  15, 11, 8,  6,  6,  14, 12, 13, 5,  14, 13, 13, 7,  5,
    15, 5,  8,  11, 14, 14, 6,  14, 6,  9,  12, 9,  12, 5,  15, 8,
    8,  5,  12, 9,  12, 5,  14, 6,  8,  13, 6,  5,  15, 13, 11, 11,
};

inline fn rotl32(x: u32, n: u5) u32 {
    return (x << n) | (x >> -%n);
}

inline fn fl(r: u3, x: u32, y: u32, z: u32) u32 {
    return switch (r) {
        0 => x ^ y ^ z,
        1 => (x & y) | (~x & z),
        2 => (x | ~y) ^ z,
        3 => (x & z) | (y & ~z),
        4 => x ^ (y | ~z),
        else => unreachable,
    };
}

inline fn fr(r: u3, x: u32, y: u32, z: u32) u32 {
    return fl(4 - r, x, y, z);
}

fn processBlock(state: *[5]u32, block: *const [64]u8) void {
    // Read 16 little-endian u32 words
    var M: [16]u32 = undefined;
    for (0..16) |i| {
        M[i] = @as(u32, block[i * 4]) |
            (@as(u32, block[i * 4 + 1]) << 8) |
            (@as(u32, block[i * 4 + 2]) << 16) |
            (@as(u32, block[i * 4 + 3]) << 24);
    }

    var al = state[0];
    var bl = state[1];
    var cl = state[2];
    var dl = state[3];
    var el = state[4];
    var ar = state[0];
    var br = state[1];
    var cr = state[2];
    var dr = state[3];
    var er = state[4];

    for (0..80) |i| {
        const r: u3 = @intCast(i / 16);
        var t: u32 = undefined;

        t = rotl32(al +% fl(r, bl, cl, dl) +% M[ML[i]] +% KL[r], SL[i]) +% el;
        al = el;
        el = dl;
        dl = rotl32(cl, 10);
        cl = bl;
        bl = t;

        t = rotl32(ar +% fr(r, br, cr, dr) +% M[MR[i]] +% KR[r], SR[i]) +% er;
        ar = er;
        er = dr;
        dr = rotl32(cr, 10);
        cr = br;
        br = t;
    }

    const T = state[1] +% cl +% dr;
    state[1] = state[2] +% dl +% er;
    state[2] = state[3] +% el +% ar;
    state[3] = state[4] +% al +% br;
    state[4] = state[0] +% bl +% cr;
    state[0] = T;
}

// ── One-shot ─────────────────────────────────────────────────────────────────

pub fn hash(data: []const u8, out: *[20]u8) void {
    var state = [5]u32{ 0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0 };

    // Process full 64-byte blocks
    var offset: usize = 0;
    while (offset + 64 <= data.len) : (offset += 64) {
        processBlock(&state, data[offset..][0..64]);
    }

    // Padding (same MD-strengthening as MD4/SHA-1)
    const bit_len: u64 = @as(u64, data.len) * 8;
    const remaining = data.len - offset;
    var tail: [128]u8 = [_]u8{0} ** 128;
    @memcpy(tail[0..remaining], data[offset..]);
    tail[remaining] = 0x80;

    const pad_len: usize = if (remaining < 56) 64 else 128;

    // Append bit length in little-endian (RIPEMD uses LE, unlike SHA-2)
    tail[pad_len - 8] = @intCast(bit_len & 0xff);
    tail[pad_len - 7] = @intCast((bit_len >> 8) & 0xff);
    tail[pad_len - 6] = @intCast((bit_len >> 16) & 0xff);
    tail[pad_len - 5] = @intCast((bit_len >> 24) & 0xff);
    tail[pad_len - 4] = @intCast((bit_len >> 32) & 0xff);
    tail[pad_len - 3] = @intCast((bit_len >> 40) & 0xff);
    tail[pad_len - 2] = @intCast((bit_len >> 48) & 0xff);
    tail[pad_len - 1] = @intCast((bit_len >> 56) & 0xff);

    processBlock(&state, tail[0..64]);
    if (pad_len == 128) processBlock(&state, tail[64..128]);

    // Output: 5 × u32 in little-endian order
    for (0..5) |i| {
        out[i * 4 + 0] = @intCast(state[i] & 0xff);
        out[i * 4 + 1] = @intCast((state[i] >> 8) & 0xff);
        out[i * 4 + 2] = @intCast((state[i] >> 16) & 0xff);
        out[i * 4 + 3] = @intCast((state[i] >> 24) & 0xff);
    }
}
