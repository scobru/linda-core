/**
 * Generates a cryptographically secure random integer between 0 (inclusive) and max (exclusive).
 * Uses Web Crypto API.
 */
export declare function generateSecureRandomInt(max: number): number;
/**
 * Generates a cryptographically secure random string.
 * Useful for non-critical IDs when UUID is not available.
 */
export declare function generateSecureRandomString(length?: number): string;
