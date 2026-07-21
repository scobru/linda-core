// src/crypto.zig — WASM boundary for all ZEN crypto primitives.
//
// This is the single entry point compiled to crypto.wasm.
// It imports all algorithm modules and exposes a flat export table
// that JavaScript can call via WebAssembly.
//
// Memory model:
//   A 1 MB static bump-allocator buffer is embedded in the WASM binary.
//   JS allocates input/output regions via alloc(), writes inputs, calls
//   an operation, then reads outputs. alloc_reset() resets the pointer.
//
//   Because JS is single-threaded (no true parallelism) and all WASM calls
//   are synchronous, the bump allocator is safe to use across calls.
//
// Exports:
//   alloc(size) → ptr         allocate `size` bytes, return WASM address
//   alloc_reset()             reset bump pointer (free everything)
//
//   sha256(in, in_len, out)           32-byte digest
//   keccak256(in, in_len, out)        32-byte digest
//   ripemd160(in, in_len, out)        20-byte digest
//   hmac_sha256(k, k_len, d, d_len, out)  32-byte HMAC
//
//   b62_enc(in32, out44)      32 raw bytes → 44 ASCII base62 chars
//   b62_dec(in44, out32) i32  44 ASCII base62 chars → 32 raw bytes (0=ok, -1=err)
//   b62_buf(in, in_len, out)  arbitrary buffer → groups of 44 chars
//
//   k1_mult_g(scalar32, out64) i32   secp256k1: scalar × G → x||y (64 bytes)
//   k1_mult(scalar32, px32, py32, out64) i32   secp256k1: scalar × P → x||y
//   k1_add(ax32, ay32, bx32, by32, out64) i32  secp256k1: A + B → x||y
//   k1_det_k(priv32, hash32, attempt, out32)    RFC 6979 deterministic k
//   k1_hash_scalar(seed, seed_len, label, label_len, out32)
//
//   p2_mult_g(scalar32, out64) i32   P-256: scalar × G → x||y
//   p2_mult(scalar32, px32, py32, out64) i32
//   p2_add(ax32, ay32, bx32, by32, out64) i32
//   p2_det_k(priv32, hash32, attempt, out32)
//   p2_hash_scalar(seed, seed_len, label, label_len, out32)
//
//   compact_point(x32, y32, out33)  compressed point encoding (0x02/0x03 prefix)

const sha256_mod = @import("sha256.zig");
const keccak_mod = @import("keccak256.zig");
const ripemd_mod = @import("ripemd160.zig");
const hmac_mod = @import("hmac_sha256.zig");
const b62_mod = @import("base62.zig");
const k1 = @import("curves/secp256k1.zig");
const p2 = @import("curves/p256.zig");
const cu = @import("curves/utils.zig");

// ── Shared 1 MB bump-allocator buffer ────────────────────────────────────────

var buf: [1 << 20]u8 align(8) = undefined;
var bump: u32 = 0;

export fn alloc(size: u32) u32 {
    const p: u32 = @intCast(@intFromPtr(&buf) + bump);
    bump += size;
    return p;
}

export fn alloc_reset() void {
    bump = 0;
}

// ── Helper: WASM u32 address → Zig slice ─────────────────────────────────────

inline fn ptr(addr: u32) [*]u8 {
    return @ptrFromInt(addr);
}

inline fn cptr(addr: u32) [*]const u8 {
    return @ptrFromInt(addr);
}

// ── Hash functions ────────────────────────────────────────────────────────────

export fn sha256(in_ptr: u32, in_len: u32, out_ptr: u32) void {
    sha256_mod.hash(cptr(in_ptr)[0..in_len], @ptrFromInt(out_ptr));
}

export fn keccak256(in_ptr: u32, in_len: u32, out_ptr: u32) void {
    keccak_mod.hash(cptr(in_ptr)[0..in_len], @ptrFromInt(out_ptr));
}

export fn ripemd160(in_ptr: u32, in_len: u32, out_ptr: u32) void {
    ripemd_mod.hash(cptr(in_ptr)[0..in_len], @ptrFromInt(out_ptr));
}

export fn hmac_sha256(key_ptr: u32, key_len: u32, data_ptr: u32, data_len: u32, out_ptr: u32) void {
    hmac_mod.hmac(
        cptr(key_ptr)[0..key_len],
        cptr(data_ptr)[0..data_len],
        @ptrFromInt(out_ptr),
    );
}

// ── Base62 ────────────────────────────────────────────────────────────────────

/// Encode 32 raw bytes → 44 ASCII base62 chars.
export fn b62_enc(in_ptr: u32, out_ptr: u32) void {
    b62_mod.encode32(@ptrFromInt(in_ptr), @ptrFromInt(out_ptr));
}

/// Decode 44 ASCII base62 chars → 32 raw bytes. Returns 0 on success, -1 on error.
export fn b62_dec(in_ptr: u32, out_ptr: u32) i32 {
    return if (b62_mod.decode32(@ptrFromInt(in_ptr), @ptrFromInt(out_ptr))) 0 else -1;
}

/// Encode arbitrary buffer in 32-byte chunks (each chunk → 44 chars).
export fn b62_buf(in_ptr: u32, in_len: u32, out_ptr: u32) void {
    b62_mod.bufToB62(cptr(in_ptr)[0..in_len], ptr(out_ptr)[0 .. (in_len + 31) / 32 * 44]);
}

// ── secp256k1 ─────────────────────────────────────────────────────────────────

/// scalar × G → 64 bytes (x||y). Returns 1 on success, 0 if result is ∞.
export fn k1_mult_g(scalar_ptr: u32, out_ptr: u32) i32 {
    const scalar = cu.bytesToU256(@ptrFromInt(scalar_ptr));
    const result = k1.pointMultiplyG(scalar) orelse return 0;
    const out = @as(*[64]u8, @ptrFromInt(out_ptr));
    cu.u256ToBytes(result.x, out[0..32]);
    cu.u256ToBytes(result.y, out[32..64]);
    return 1;
}

/// scalar × point → 64 bytes (x||y). Returns 1 on success, 0 if result is ∞.
export fn k1_mult(scalar_ptr: u32, px_ptr: u32, py_ptr: u32, out_ptr: u32) i32 {
    const scalar = cu.bytesToU256(@ptrFromInt(scalar_ptr));
    const pt = cu.Point{
        .x = cu.bytesToU256(@ptrFromInt(px_ptr)),
        .y = cu.bytesToU256(@ptrFromInt(py_ptr)),
    };
    const result = k1.pointMultiply(scalar, pt) orelse return 0;
    const out = @as(*[64]u8, @ptrFromInt(out_ptr));
    cu.u256ToBytes(result.x, out[0..32]);
    cu.u256ToBytes(result.y, out[32..64]);
    return 1;
}

/// A + B → 64 bytes (x||y). Returns 1 on success, 0 if result is ∞.
export fn k1_add(ax_ptr: u32, ay_ptr: u32, bx_ptr: u32, by_ptr: u32, out_ptr: u32) i32 {
    const a = cu.Point{ .x = cu.bytesToU256(@ptrFromInt(ax_ptr)), .y = cu.bytesToU256(@ptrFromInt(ay_ptr)) };
    const b = cu.Point{ .x = cu.bytesToU256(@ptrFromInt(bx_ptr)), .y = cu.bytesToU256(@ptrFromInt(by_ptr)) };
    const result = k1.pointAdd(a, b) orelse return 0;
    const out = @as(*[64]u8, @ptrFromInt(out_ptr));
    cu.u256ToBytes(result.x, out[0..32]);
    cu.u256ToBytes(result.y, out[32..64]);
    return 1;
}

/// RFC 6979 deterministic k for secp256k1. attempt=0 for first try.
export fn k1_det_k(priv_ptr: u32, hash_ptr: u32, attempt: u32, out_ptr: u32) void {
    k1.deterministicK(
        @ptrFromInt(priv_ptr),
        @ptrFromInt(hash_ptr),
        @intCast(attempt & 0xff),
        @ptrFromInt(out_ptr),
    );
}

/// hashToScalar: SHA256(label||seed) → scalar in [1, N-1].
export fn k1_hash_scalar(seed_ptr: u32, seed_len: u32, label_ptr: u32, label_len: u32, out_ptr: u32) void {
    k1.hashToScalar(
        cptr(seed_ptr)[0..seed_len],
        cptr(label_ptr)[0..label_len],
        @ptrFromInt(out_ptr),
    );
}

// ── P-256 ─────────────────────────────────────────────────────────────────────

export fn p2_mult_g(scalar_ptr: u32, out_ptr: u32) i32 {
    const scalar = cu.bytesToU256(@ptrFromInt(scalar_ptr));
    const result = p2.pointMultiplyG(scalar) orelse return 0;
    const out = @as(*[64]u8, @ptrFromInt(out_ptr));
    cu.u256ToBytes(result.x, out[0..32]);
    cu.u256ToBytes(result.y, out[32..64]);
    return 1;
}

export fn p2_mult(scalar_ptr: u32, px_ptr: u32, py_ptr: u32, out_ptr: u32) i32 {
    const scalar = cu.bytesToU256(@ptrFromInt(scalar_ptr));
    const pt = cu.Point{
        .x = cu.bytesToU256(@ptrFromInt(px_ptr)),
        .y = cu.bytesToU256(@ptrFromInt(py_ptr)),
    };
    const result = p2.pointMultiply(scalar, pt) orelse return 0;
    const out = @as(*[64]u8, @ptrFromInt(out_ptr));
    cu.u256ToBytes(result.x, out[0..32]);
    cu.u256ToBytes(result.y, out[32..64]);
    return 1;
}

export fn p2_add(ax_ptr: u32, ay_ptr: u32, bx_ptr: u32, by_ptr: u32, out_ptr: u32) i32 {
    const a = cu.Point{ .x = cu.bytesToU256(@ptrFromInt(ax_ptr)), .y = cu.bytesToU256(@ptrFromInt(ay_ptr)) };
    const b = cu.Point{ .x = cu.bytesToU256(@ptrFromInt(bx_ptr)), .y = cu.bytesToU256(@ptrFromInt(by_ptr)) };
    const result = p2.pointAdd(a, b) orelse return 0;
    const out = @as(*[64]u8, @ptrFromInt(out_ptr));
    cu.u256ToBytes(result.x, out[0..32]);
    cu.u256ToBytes(result.y, out[32..64]);
    return 1;
}

export fn p2_det_k(priv_ptr: u32, hash_ptr: u32, attempt: u32, out_ptr: u32) void {
    p2.deterministicK(
        @ptrFromInt(priv_ptr),
        @ptrFromInt(hash_ptr),
        @intCast(attempt & 0xff),
        @ptrFromInt(out_ptr),
    );
}

export fn p2_hash_scalar(seed_ptr: u32, seed_len: u32, label_ptr: u32, label_len: u32, out_ptr: u32) void {
    p2.hashToScalar(
        cptr(seed_ptr)[0..seed_len],
        cptr(label_ptr)[0..label_len],
        @ptrFromInt(out_ptr),
    );
}

// ── Shared utilities ──────────────────────────────────────────────────────────

/// Compressed point: 0x02/0x03 || x → 33 bytes.
export fn compact_point(x_ptr: u32, y_ptr: u32, out_ptr: u32) void {
    const pt = cu.Point{
        .x = cu.bytesToU256(@ptrFromInt(x_ptr)),
        .y = cu.bytesToU256(@ptrFromInt(y_ptr)),
    };
    cu.compactPoint(pt, @ptrFromInt(out_ptr));
}
