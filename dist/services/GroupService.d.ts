import { DataBase } from '../zen/db.js';
export type Role = "peer" | "moderator" | "administrator";
export interface GroupMember {
    pub: string;
    role: Role;
    joinedAt: number;
    umbral_pk?: string;
    pq_pk?: string;
}
export interface GroupInfo {
    id: string;
    name: string;
    description: string;
    avatar?: string;
    adminPub: string;
    secret: string;
    encryptionMode?: 'symmetric' | 'tpre';
    communityPK?: string;
    threshold?: number;
    totalShares?: number;
    type?: 'group' | 'broadcast';
    features?: {
        callsEnabled: boolean;
        activityEnabled: boolean;
    };
    isPublic?: boolean;
    publicName?: string;
}
export interface GroupInvite {
    g: string;
    s: string;
    r: Role;
    t: number;
    u?: boolean;
    id?: string;
}
export declare class GroupService {
    private db;
    constructor(db: DataBase);
    private generateUUID;
    /**
     * Create a new encrypted group
     */
    createGroup(name: string, description: string, type?: 'group' | 'broadcast'): Promise<GroupInfo>;
    getMemberRole(groupId: string, memberPub: string): Promise<Role | null>;
    onMemberRoleChange(groupId: string, memberPub: string, callback: (role: Role | null) => void): () => void;
    onMuteStatusChange(groupId: string, memberPub: string, callback: (isMuted: boolean) => void): () => void;
    canPerform(groupId: string, action: string): Promise<boolean>;
    muteMember(groupId: string, memberPub: string, muted: boolean): Promise<void>;
    isMuted(groupId: string, memberPub: string): Promise<boolean>;
    updateGroupMeta(groupId: string, updates: Partial<Pick<GroupInfo, 'name' | 'description' | 'avatar'>>): Promise<void>;
    toggleFeature(groupId: string, feature: 'callsEnabled' | 'activityEnabled', enabled: boolean): Promise<void>;
    updateMemberRole(groupId: string, memberPub: string, newRole: Role): Promise<void>;
    getMembers(groupId: string): Promise<GroupMember[]>;
    kickMember(groupId: string, memberPub: string): Promise<void>;
    leaveGroup(groupId: string, force?: boolean): Promise<void>;
    pinMessage(groupId: string, messageId: string, pinned: boolean): Promise<void>;
    deleteMessage(groupId: string, messageId: string, senderPub: string): Promise<void>;
    reportContent(groupId: string, contentId: string, reason: string): Promise<void>;
    reportUser(groupId: string, targetPub: string, reason: string): Promise<void>;
    getReports(groupId: string): Promise<any[]>;
    resolveReport(groupId: string, reportId: string, status: "resolved" | "dismissed"): Promise<void>;
    generateInvite(groupId: string, role?: Role, singleUse?: boolean): Promise<string>;
    joinGroup(inviteB64: string): Promise<GroupInfo>;
    setGroupPublic(groupId: string, isPublic: boolean, publicName?: string): Promise<void>;
    getPublicGroup(publicName: string): Promise<string | null>;
    joinPublicGroup(publicName: string): Promise<GroupInfo>;
    getP2PGroupId(contactPub: string): Promise<string>;
    getOrCreateP2PGroup(contactPub: string): Promise<GroupInfo>;
    encryptGroupMessage(group: GroupInfo, plaintext: string): Promise<string>;
    decryptGroupMessage(group: GroupInfo, boxed: string): Promise<string>;
}
