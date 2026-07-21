// src/keccak256.zig — Pure Keccak-256. No stdlib. Freestanding WASM-compatible.
// This is Keccak (suffix 0x01), NOT SHA3 (suffix 0x06).
// Rate = 1088 bits (136 bytes). Capacity = 512 bits. Output = 256 bits.
//
// Replaces the BigInt-heavy JS implementation with native u64 arithmetic.
// The JS version stored the 25-lane state as BigInt, making it extremely slow.
// Here each lane is a u64 — straightforward and fast.

const RATE: usize = 136;
const SUFFIX: u8 = 0x01;

const ROT = [25]u6{
    0,  1,  62, 28, 27,
    36, 44, 6,  55, 20,
    3,  10, 43, 25, 39,
    41, 45, 15, 21, 8,
    18, 2,  61, 56, 14,
};

const RC = [24]u64{
    0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
    0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
    0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
};

inline fn rotl64(x: u64, n: u6) u64 {
    return (x << n) | (x >> -%n);
}

fn keccakF(state: *[25]u64) void {
    var round: usize = 0;
    while (round < 24) : (round += 1) {
        // θ (Theta)
        var c: [5]u64 = undefined;
        for (0..5) |x| {
            c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
        }
        var d: [5]u64 = undefined;
        for (0..5) |x| {
            d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
        }
        for (0..25) |i| {
            state[i] ^= d[i % 5];
        }

        // ρ (Rho) + π (Pi) combined
        var b: [25]u64 = undefined;
        for (0..5) |y| {
            for (0..5) |x| {
                const idx = x + 5 * y;
                b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[idx], ROT[idx]);
            }
        }

        // χ (Chi)
        for (0..5) |y| {
            for (0..5) |x| {
                const idx = x + 5 * y;
                state[idx] = b[idx] ^ (~b[(x + 1) % 5 + 5 * y] & b[(x + 2) % 5 + 5 * y]);
            }
        }

        // ι (Iota)
        state[0] ^= RC[round];
    }
}

fn xorLane(state: *[25]u64, block: []const u8) void {
    const words = block.len / 8;
    for (0..words) |i| {
        var lane: u64 = 0;
        for (0..8) |j| {
            lane |= @as(u64, block[i * 8 + j]) << @intCast(j * 8);
        }
        state[i] ^= lane;
    }
}

// ── One-shot ─────────────────────────────────────────────────────────────────

pub fn hash(data: []const u8, out: *[32]u8) void {
    var state: [25]u64 = [_]u64{0} ** 25;

    // Absorb full blocks
    var offset: usize = 0;
    while (offset + RATE <= data.len) : (offset += RATE) {
        xorLane(&state, data[offset .. offset + RATE]);
        keccakF(&state);
    }

    // Final block with multi-rate padding
    var pad: [RATE]u8 = [_]u8{0} ** RATE;
    const remaining = data.len - offset;
    @memcpy(pad[0..remaining], data[offset..]);
    pad[remaining] ^= SUFFIX;
    pad[RATE - 1] ^= 0x80;
    xorLane(&state, &pad);
    keccakF(&state);

    // Squeeze: first 32 bytes (4 lanes, little-endian u64)
    for (0..4) |i| {
        const lane = state[i];
        for (0..8) |j| {
            out[i * 8 + j] = @intCast((lane >> @intCast(j * 8)) & 0xff);
        }
    }
}
