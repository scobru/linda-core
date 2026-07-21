import type { IZenInstance } from '../zen/types.js';
export type TransferStatus = 'idle' | 'offering' | 'incoming' | 'signaling' | 'transferring' | 'completed' | 'failed' | 'offered';
export interface FileSignal {
    type: 'file_offer' | 'file_answer' | 'file_candidate' | 'file_reject' | 'file_bye';
    from: string;
    clientId?: string;
    payload: any;
    timestamp: number;
}
export declare class FileTransferService {
    private myPub;
    private clientId;
    private pc;
    private dc;
    private remoteCandidates;
    private processedCandidates;
    onStatusChange: (status: TransferStatus, progress?: number, data?: any) => void;
    onFileReceived: (blob: Blob, name: string, mimeType: string, metaId?: string) => void;
    onStats: (stats: {
        bitrate: number;
        bufferedAmount: number;
    }) => void;
    private currentStatus;
    private currentMetaId;
    private timeoutId;
    private readonly TIMEOUT_MS;
    private pendingOps;
    private heartbeatInterval;
    private hasAttemptedIceRestart;
    private iceServers;
    constructor(_zen: IZenInstance, myPub: string);
    /**
     * Returns true if the given metaId was initiated by this specific instance/tab.
     */
    isMyOwnTransfer(metaId: string): boolean;
    getClientId(): string;
    private startTimeout;
    private clearTimeout;
    handleIncomingSignal(from: string, signal: FileSignal): void;
    handleIceRestartOffer(senderPub: string, offer: any): Promise<void>;
    private onSendSignal;
    setSignalSender(sender: (to: string, signal: FileSignal) => void): void;
    private handleAnswer;
    private sendSignal;
    offerFile(recipientPub: string, file: File, metaId: string): Promise<void>;
    private triggerIceRestart;
    acceptFile(senderPub: string, offer: any): Promise<void>;
    private startSending;
    private setupReceiver;
    private updateProgress;
    private startHeartbeat;
    private stopHeartbeat;
    private cleanup;
}
