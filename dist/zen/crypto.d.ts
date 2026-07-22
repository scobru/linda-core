import { type IZenPair } from './types.js';
/**
 * Non-breaking helper to initialize WebAssembly crypto acceleration (pen.wasm / crypto.wasm).
 * If WASM is unavailable or fails, gracefully falls back to JS crypto without throwing.
 */
export declare function initWasmCrypto(wasmUrl?: string, zenInstance?: any): Promise<boolean>;
/**
 * Returns whether WASM crypto acceleration is currently active.
 */
export declare function isWasmCryptoAccelerated(zenInstance?: any): boolean;
export declare function encrypt(data: any, key: string | IZenPair, zenInstance?: any): Promise<any>;
export declare function decrypt(encryptedData: any, key: string | IZenPair, zenInstance?: any): Promise<any>;
export declare function sign(data: any, pair: IZenPair, zenInstance?: any): Promise<any>;
export declare function verify(data: any, pub: string, zenInstance?: any): Promise<any>;
export declare function secret(epub: string, pair: IZenPair, zenInstance?: any): Promise<any>;
export declare function certify(who: string | string[], policy: any, pair: IZenPair, zenInstance?: any): Promise<any>;
export declare function generatePairFromSeed(seedPhrase: string, salt?: string | null, zenInstance?: any): Promise<IZenPair>;
export declare function pair(zenInstance?: any): Promise<IZenPair>;
