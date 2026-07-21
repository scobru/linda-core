import type { IZenInstance } from '../zen/types.js';
export declare const WormholeStatus: {
    readonly CHECKING_RELAY: "checking-relay";
    readonly ENCRYPTING: "encrypting";
    readonly UPLOADING: "uploading";
    readonly PINNING: "pinning";
    readonly SENT: "sent";
    readonly UNPINNING: "unpinning";
    readonly UNPINNED: "unpinned";
    readonly COMPLETED: "completed";
    readonly CONNECTING: "connecting";
    readonly FOUND: "found";
    readonly DOWNLOADING: "downloading";
    readonly DECRYPTING: "decrypting";
    readonly DOWNLOADED: "downloaded";
    readonly ERROR: "error";
    readonly NOTICE: "notice";
};
export type WormholeStatus = typeof WormholeStatus[keyof typeof WormholeStatus];
export interface WormholeProgress {
    progress: number;
    loaded: number;
    total: number;
}
export interface WormholeMetadata {
    version: number;
    algorithm: string;
    iv: string;
    salt: string;
    iterations: number;
    keyLength: number;
    hash: string;
    encryptedFilename: string;
    originalName: string;
}
export declare class WormholeService {
    private gun;
    onStatusChange: (data: {
        code: string;
        status: WormholeStatus;
        message: string;
        metadata?: any;
        fileData?: any;
    }) => void;
    onProgress: (data: WormholeProgress & {
        code: string;
    }) => void;
    constructor(gun: IZenInstance);
    send({ file, filename, size, type, relayUrl, authToken }: {
        file: File | Blob;
        filename: string;
        size: number;
        type: string;
        relayUrl: string;
        authToken: string;
        lastModified?: number;
    }): Promise<string>;
    receive(code: string, relayUrl: string): Promise<void>;
    /**
     * Cleans up transfers that have been pending for too long without completion.
     */
    cleanupStaleTransfers(relayUrl: string, authToken: string, maxAgeMs?: number): Promise<void>;
}
