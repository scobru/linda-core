// src/hmac_sha256.zig — HMAC-SHA-256. No stdlib. Freestanding WASM-compatible.
// Uses the streaming SHA-256 context from sha256.zig so no heap allocation is needed.
// HMAC(K, data) = SHA256((K' XOR opad) || SHA256((K' XOR ipad) || data))

const sha256 = @import("sha256.zig");

pub fn hmac(key: []const u8, data: []const u8, out: *[32]u8) void {
    var k: [64]u8 = [_]u8{0} ** 64;

    // If key > 64 bytes, hash it first
    if (key.len > 64) {
        sha256.hash(key, out); // borrow out temporarily
        @memcpy(k[0..32], out);
    } else {
        @memcpy(k[0..key.len], key);
    }

    var ipad: [64]u8 = undefined;
    var opad: [64]u8 = undefined;
    for (0..64) |i| {
        ipad[i] = k[i] ^ 0x36;
        opad[i] = k[i] ^ 0x5c;
    }

    // Inner: SHA256(ipad || data)
    var inner = sha256.init();
    sha256.update(&inner, &ipad);
    sha256.update(&inner, data);
    sha256.final(&inner, out);

    const inner_hash = out.*;

    // Outer: SHA256(opad || inner_hash)
    var outer = sha256.init();
    sha256.update(&outer, &opad);
    sha256.update(&outer, &inner_hash);
    sha256.final(&outer, out);
}
