import { DataBase } from '../zen/db.js';
/**
 * CommunicationService
 *
 * Bridges shogun-core DataBase with Zen-based encryption.
 * Replaces the complex libsignal-protocol with native Zen-native encrypt/decrypt.
 *
 * Uses 'epub' (exchange public key) to derive a shared secret
 * for secure 1:1 messaging.
 */
export declare class CommunicationService {
    private db;
    private isInitialized;
    private initPromise;
    private pubkeyCache;
    private epubCache;
    private secretCache;
    private inboxCertCache;
    myPair: any;
    private cryptoMutex;
    private pubkeyPromises;
    private epubPromises;
    private inboxCertPromises;
    constructor(db: DataBase);
    get initialized(): boolean;
    /**
     * Waits for the service to be fully initialized.
     */
    waitReady(): Promise<void>;
    /**
     * Initializes the Zen-based messaging session by publishing the user's bundle.
     */
    initSession(username: string, uniqueUsername?: string): Promise<void>;
    /**
     * Publishes the user's public 'epub' to GunDB so others can derive a shared secret.
     */
    private publishBundle;
    /**
     * Persists the user's alias and unique username for discovery.
     */
    private persistAlias;
    /**
     * Resolves a human-readable username or unique username to a GunDB public key.
     */
    getPubKeyFromUsername(username: string): Promise<string>;
    /**
     * Retrieves the 'epub' (Exchange Public Key) for a given GunDB pubkey.
     */
    getEpubFromPub(pub: string): Promise<string>;
    /**
     * Initializes the user's Zen certificate for their secure linda_inbox
     * allowing anyone (or specific peers) to write signals to ~${pub}/linda_inbox
     */
    regenerateCertificate(force?: boolean): Promise<void>;
    /**
     * Issues a specific Zen certificate for a peer.
     */
    issueCertificate(peerPub: string): Promise<string>;
    /**
     * Revokes a specific certificate for a peer.
     */
    revokeCertificate(peerPub: string): Promise<void>;
    /**
     * Retrieves the Zen certificate allowing writes to a peer's linda_inbox
     */
    getInboxCertificate(pub: string): Promise<string>;
    /**
     * Clears the cached certificate for a specific pubkey.
     * Call this when GunDB reports "Certificate verification fail" so we refetch a fresh cert.
     */
    clearCertCache(pub: string): void;
    /**
     * Encrypts a message using Zen secret and Zen encrypt.
     * Returns a format compatible with existing messaging hooks.
     */
    encryptMessage(recipientUsernameOrPub: string, message: string): Promise<{
        type: number;
        body: string;
    }>;
    /**
     * Decrypts a message using Zen secret and Zen decrypt.
     */
    decryptMessage(senderUsernameOrPub: string, ciphertext: {
        type: number;
        body: string;
    }, _senderEpub?: string): Promise<string | undefined>;
    /**
     * Force republish the user's bundle. Useful for fixing synchronization issues.
     */
    republishBundle(): Promise<void>;
    /**
     * Reset session (No-op in stateless Zen mode, kept for API compatibility).
     */
    resetSession(contactUsernameOrPub: string): Promise<void>;
}
