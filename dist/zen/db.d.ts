import type { IZenInstance, IZenPair, AuthCallback, AuthResult, SignUpResult } from './types.js';
import * as crypto from './crypto.js';
export declare class DataBase {
    zen: IZenInstance;
    private _pair;
    private _pub;
    crypto: typeof crypto;
    static readonly DEFAULT_GET_TIMEOUT = 15000;
    static readonly DEFAULT_PUT_TIMEOUT = 15000;
    /**
     * Cleans a Zen public key by removing the leading tilde if present.
     */
    static cleanPub(pub: string): string;
    constructor(zen: IZenInstance);
    /**
     * Universal User Shim
     * @param pub If provided, returns a public node shim for that user.
     *            If omitted, returns the shim for the currently authenticated user.
     */
    userShim(pub?: string): any;
    get user(): any;
    get pair(): IZenPair | null;
    private readonly onAuthCallbacks;
    initialize(): Promise<void>;
    restoreSession(): Promise<AuthResult>;
    private emitAuthEvent;
    onAuth(callback: AuthCallback): () => void;
    isLoggedIn(): boolean;
    signUp(username: string, password?: string, pair?: IZenPair | null): Promise<SignUpResult>;
    login(username: string, password: string): Promise<AuthResult>;
    loginWithPair(username: string, pair: IZenPair): Promise<AuthResult>;
    logout(): void;
    getUserPub(): string | null;
    /**
     * Safe read with forced timeout to prevent relay-sync hangs
     */
    safeGet(pathOrChain: string | any, timeoutMs?: number, silent?: boolean): Promise<any>;
    private getChain;
    Get(path: string, timeoutMs?: number, silent?: boolean): Promise<any>;
    private injectAuth;
    Put(path: string, data: any, opt?: any): Promise<any>;
    Set(path: string, data: any, opt?: any): Promise<any>;
    userGet(path: string, timeoutMs?: number): Promise<any>;
    userPut(path: string, data: any, cb?: any, opt?: any): Promise<any>;
    On(path: string, callback: (data: any) => void): void;
    Off(path: string): void;
}
