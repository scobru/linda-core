import ZEN from 'zen';
import { type IZenPair } from './types.js';

// WASM acceleration tracking
let wasmAcceleratedState = false;

/**
 * Non-breaking helper to initialize WebAssembly crypto acceleration (pen.wasm / crypto.wasm).
 * If WASM is unavailable or fails, gracefully falls back to JS crypto without throwing.
 */
export async function initWasmCrypto(
  wasmUrl?: string,
  zenInstance?: any,
): Promise<boolean> {
  try {
    const zen = getZenLibrary(zenInstance);
    if (zen && zen.WASM && typeof zen.WASM.load === 'function') {
      await zen.WASM.load(wasmUrl || 'pen.wasm');
      wasmAcceleratedState = true;
      return true;
    }
    if (typeof window !== 'undefined') {
      const w = window as any;
      if (w.Zen?.WASM?.load) {
        await w.Zen.WASM.load(wasmUrl || 'pen.wasm');
        wasmAcceleratedState = true;
        return true;
      }
    }
  } catch (e: any) {
    console.warn('[Crypto] WASM acceleration skipped, using standard JS crypto:', e?.message || e);
  }
  return false;
}

/**
 * Returns whether WASM crypto acceleration is currently active.
 */
export function isWasmCryptoAccelerated(zenInstance?: any): boolean {
  if (wasmAcceleratedState) return true;
  const zen = getZenLibrary(zenInstance);
  return Boolean(zen && (zen.WASM?.loaded || zen.SEA?.WASM || zen.crypto?.WASM));
}

/**
 * Helper to get the best available Zen cryptographic methods.
 */
const getZenLibrary = (zenInstance?: any) => {
  const candidates: any[] = [];
  
  if (zenInstance) {
    candidates.push(zenInstance);
    if (zenInstance.constructor) candidates.push(zenInstance.constructor);
    if (zenInstance.SEA) candidates.push(zenInstance.SEA);
    if (zenInstance.constructor && zenInstance.constructor.SEA) {
      candidates.push(zenInstance.constructor.SEA);
    }
    if (zenInstance.crypto) candidates.push(zenInstance.crypto);
    if (zenInstance.constructor && zenInstance.constructor.crypto) {
        candidates.push(zenInstance.constructor.crypto);
    }
  }
  
  candidates.push(ZEN);
  if (ZEN && (ZEN as any).SEA) candidates.push((ZEN as any).SEA);
  
  if (typeof window !== 'undefined') {
    const w = window as any;
    const variants = ['Zen', 'ZEN', 'Gun', 'GUN', 'zen', 'gun'];
    for (const v of variants) {
      if (w[v]) {
        candidates.push(w[v]);
        if (w[v].SEA) candidates.push(w[v].SEA);
        if (w[v].crypto) candidates.push(w[v].crypto);
      }
    }
  }

  for (const cand of candidates) {
    if (cand && (typeof cand.pair === 'function' || typeof cand.encrypt === 'function')) {
      return cand;
    }
  }
  
  return ZEN;
};

export async function encrypt(
  data: any,
  key: string | IZenPair,
  zenInstance?: any,
): Promise<any> {
  const zen = getZenLibrary(zenInstance);
  return await zen.encrypt(data, key);
}

export async function decrypt(
  encryptedData: any,
  key: string | IZenPair,
  zenInstance?: any,
): Promise<any> {
  const zen = getZenLibrary(zenInstance);
  return await zen.decrypt(encryptedData, key);
}

export async function sign(data: any, pair: IZenPair, zenInstance?: any) {
  const zen = getZenLibrary(zenInstance);
  return await zen.sign(data, pair);
}

export async function verify(data: any, pub: string, zenInstance?: any) {
  const zen = getZenLibrary(zenInstance);
  return await zen.verify(data, pub);
}

export async function secret(epub: string, pair: IZenPair, zenInstance?: any) {
  const zen = getZenLibrary(zenInstance);
  return await zen.secret(epub, pair);
}

export async function certify(
  who: string | string[],
  policy: any,
  pair: IZenPair,
  zenInstance?: any,
) {
  const zen = getZenLibrary(zenInstance);
  
  if (!zen || typeof zen.certify !== 'function') {
    console.error('[Crypto] zen.certify is unavailable');
    return null;
  }

  // Zen-native explicitly rejects wildcards (*) for security.
  if (who === '*') {
    console.warn('[Crypto] Wildcard (*) certification is explicitly unsupported in Zen-native.');
    return null;
  }

  try {
    const result = await zen.certify(who, policy, pair);
    return result || null;
  } catch (e: any) {
    console.error('[Crypto] Certification failed:', e?.message || e);
    return null;
  }
}



export async function generatePairFromSeed(
  seedPhrase: string,
  salt?: string | null,
  zenInstance?: any,
): Promise<IZenPair> {
  const zen = getZenLibrary(zenInstance);
  const result = await zen.pair(null, { seed: seedPhrase });
  if (!result) {
    const derivedPassword = await zen.hash(
      seedPhrase,
      salt || 'shogun-seed-salt',
      null,
      { name: 'SHA-256' },
    );
    return await zen.pair(null, { password: derivedPassword });
  }
  return result;
}

export async function pair(zenInstance?: any): Promise<IZenPair> {
  const zen = getZenLibrary(zenInstance);
  return await zen.pair();
}
