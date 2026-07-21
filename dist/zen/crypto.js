import ZEN from 'zen';
/**
 * Helper to get the best available Zen cryptographic methods.
 */
const getZenLibrary = (zenInstance) => {
    const candidates = [];
    if (zenInstance) {
        candidates.push(zenInstance);
        if (zenInstance.constructor)
            candidates.push(zenInstance.constructor);
        if (zenInstance.SEA)
            candidates.push(zenInstance.SEA);
        if (zenInstance.constructor && zenInstance.constructor.SEA) {
            candidates.push(zenInstance.constructor.SEA);
        }
        if (zenInstance.crypto)
            candidates.push(zenInstance.crypto);
        if (zenInstance.constructor && zenInstance.constructor.crypto) {
            candidates.push(zenInstance.constructor.crypto);
        }
    }
    candidates.push(ZEN);
    if (ZEN && ZEN.SEA)
        candidates.push(ZEN.SEA);
    if (typeof window !== 'undefined') {
        const w = window;
        const variants = ['Zen', 'ZEN', 'Gun', 'GUN', 'zen', 'gun'];
        for (const v of variants) {
            if (w[v]) {
                candidates.push(w[v]);
                if (w[v].SEA)
                    candidates.push(w[v].SEA);
                if (w[v].crypto)
                    candidates.push(w[v].crypto);
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
export async function encrypt(data, key, zenInstance) {
    const zen = getZenLibrary(zenInstance);
    return await zen.encrypt(data, key);
}
export async function decrypt(encryptedData, key, zenInstance) {
    const zen = getZenLibrary(zenInstance);
    return await zen.decrypt(encryptedData, key);
}
export async function sign(data, pair, zenInstance) {
    const zen = getZenLibrary(zenInstance);
    return await zen.sign(data, pair);
}
export async function verify(data, pub, zenInstance) {
    const zen = getZenLibrary(zenInstance);
    return await zen.verify(data, pub);
}
export async function secret(epub, pair, zenInstance) {
    const zen = getZenLibrary(zenInstance);
    return await zen.secret(epub, pair);
}
export async function certify(who, policy, pair, zenInstance) {
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
    }
    catch (e) {
        console.error('[Crypto] Certification failed:', e?.message || e);
        return null;
    }
}
export async function generatePairFromSeed(seedPhrase, salt, zenInstance) {
    const zen = getZenLibrary(zenInstance);
    const result = await zen.pair(null, { seed: seedPhrase });
    if (!result) {
        const derivedPassword = await zen.hash(seedPhrase, salt || 'shogun-seed-salt', null, { name: 'SHA-256' });
        return await zen.pair(null, { password: derivedPassword });
    }
    return result;
}
export async function pair(zenInstance) {
    const zen = getZenLibrary(zenInstance);
    return await zen.pair();
}
