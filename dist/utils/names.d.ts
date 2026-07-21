/**
 * Generates a random handle like @CyberRunner42
 * @param seed Optional string seed to make it deterministic (e.g. pubkey)
 */
export declare const generateRandomHandle: (seed?: string) => string;
export declare const truncatePub: (pub: any) => string;
export declare const getDisplayName: (id: string, profile?: {
    nickname?: string;
    uniqueUsername?: string;
}) => string;
