export type CallStatus = 'idle' | 'calling' | 'incoming' | 'connected' | 'ended';
export interface CallSignal {
    id: string;
    type: 'offer' | 'answer' | 'candidate' | 'reject' | 'bye' | 'ringing';
    from: string;
    payload: any;
    timestamp: number;
}
export declare class CallingService {
    private myPub;
    private peerConnection;
    private localStream;
    private remoteStream;
    onStatusChange: (status: CallStatus, data?: any) => void;
    onRemoteStream: (stream: MediaStream) => void;
    onStats: (stats: any) => void;
    private currentStatus;
    private currentRecipient;
    private iceServers;
    private iceCandidateQueue;
    private seenSignals;
    private hasAttemptedIceRestart;
    constructor(myPub: string);
    triggerIceRestart(): Promise<void>;
    handleIceRestartOffer(from: string, payload: any): Promise<void>;
    private onSendSignal;
    setSignalSender(sender: (to: string, signal: CallSignal) => void): void;
    handleIncomingSignal(from: string, signal: CallSignal): Promise<void>;
    private processIceQueue;
    private sendSignal;
    initiateCall(recipientPub: string, video?: boolean): Promise<void>;
    acceptCall(offerPayload: any): Promise<void>;
    rejectCall(): void;
    endCall(sendBye?: boolean): void;
    getLocalStream(): MediaStream | null;
    getRemoteStream(): MediaStream | null;
    private startStatsLoop;
    private applyBitrateConstraints;
}
