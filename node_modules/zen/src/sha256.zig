// src/sha256.zig — Pure SHA-256. No stdlib. Freestanding WASM-compatible.
// Provides both a streaming context API and a one-shot hash() function.

const K = [64]u32{
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

const H0 = [8]u32{
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
};

inline fn rotr32(x: u32, n: u5) u32 {
    return (x >> n) | (x << -%n);
}

fn processBlock(state: *[8]u32, block: *const [64]u8) void {
    var w: [64]u32 = undefined;
    for (0..16) |i| {
        w[i] = (@as(u32, block[i * 4]) << 24) |
            (@as(u32, block[i * 4 + 1]) << 16) |
            (@as(u32, block[i * 4 + 2]) << 8) |
            @as(u32, block[i * 4 + 3]);
    }
    for (16..64) |i| {
        const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
        const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] +% w[i - 7] +% s0 +% s1;
    }
    var a = state[0];
    var b = state[1];
    var c = state[2];
    var d = state[3];
    var e = state[4];
    var f = state[5];
    var g = state[6];
    var h = state[7];
    for (0..64) |i| {
        const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = h +% s1 +% ch +% K[i] +% w[i];
        const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = s0 +% maj;
        h = g;
        g = f;
        f = e;
        e = d +% t1;
        d = c;
        c = b;
        b = a;
        a = t1 +% t2;
    }
    state[0] +%= a;
    state[1] +%= b;
    state[2] +%= c;
    state[3] +%= d;
    state[4] +%= e;
    state[5] +%= f;
    state[6] +%= g;
    state[7] +%= h;
}

// ── Streaming context ────────────────────────────────────────────────────────

pub const Ctx = struct {
    state: [8]u32,
    buf: [64]u8,
    buflen: u8,
    total: u64,
};

pub fn init() Ctx {
    return Ctx{
        .state = H0,
        .buf = [_]u8{0} ** 64,
        .buflen = 0,
        .total = 0,
    };
}

pub fn update(ctx: *Ctx, data: []const u8) void {
    var offset: usize = 0;
    ctx.total += data.len;
    if (ctx.buflen > 0) {
        const need: usize = 64 - @as(usize, ctx.buflen);
        const take = @min(need, data.len);
        @memcpy(ctx.buf[ctx.buflen .. ctx.buflen + take], data[0..take]);
        ctx.buflen += @intCast(take);
        offset = take;
        if (ctx.buflen == 64) {
            processBlock(&ctx.state, &ctx.buf);
            ctx.buflen = 0;
        }
    }
    while (offset + 64 <= data.len) {
        processBlock(&ctx.state, data[offset..][0..64]);
        offset += 64;
    }
    const remaining = data.len - offset;
    if (remaining > 0) {
        @memcpy(ctx.buf[0..remaining], data[offset..]);
        ctx.buflen = @intCast(remaining);
    }
}

pub fn final(ctx: *Ctx, out: *[32]u8) void {
    const bit_len: u64 = ctx.total * 8;
    ctx.buf[ctx.buflen] = 0x80;
    const bl: usize = ctx.buflen + 1;
    if (bl > 56) {
        @memset(ctx.buf[bl..64], 0);
        processBlock(&ctx.state, &ctx.buf);
        @memset(ctx.buf[0..56], 0);
    } else {
        @memset(ctx.buf[bl..56], 0);
    }
    ctx.buf[56] = @intCast((bit_len >> 56) & 0xff);
    ctx.buf[57] = @intCast((bit_len >> 48) & 0xff);
    ctx.buf[58] = @intCast((bit_len >> 40) & 0xff);
    ctx.buf[59] = @intCast((bit_len >> 32) & 0xff);
    ctx.buf[60] = @intCast((bit_len >> 24) & 0xff);
    ctx.buf[61] = @intCast((bit_len >> 16) & 0xff);
    ctx.buf[62] = @intCast((bit_len >> 8) & 0xff);
    ctx.buf[63] = @intCast(bit_len & 0xff);
    processBlock(&ctx.state, &ctx.buf);
    for (0..8) |i| {
        out[i * 4 + 0] = @intCast((ctx.state[i] >> 24) & 0xff);
        out[i * 4 + 1] = @intCast((ctx.state[i] >> 16) & 0xff);
        out[i * 4 + 2] = @intCast((ctx.state[i] >> 8) & 0xff);
        out[i * 4 + 3] = @intCast(ctx.state[i] & 0xff);
    }
}

// ── One-shot ─────────────────────────────────────────────────────────────────

pub fn hash(data: []const u8, out: *[32]u8) void {
    var ctx = init();
    update(&ctx, data);
    final(&ctx, out);
}
