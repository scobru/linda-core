export class GroupService {
    db;
    constructor(db) {
        this.db = db;
    }
    // Remove getThresholdService
    generateUUID() {
        if (typeof globalThis.crypto?.randomUUID === 'function')
            return globalThis.crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
    /**
     * Create a new encrypted group
     */
    async createGroup(name, description, type = 'group') {
        const groupId = this.generateUUID();
        let groupSecret = btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(32))));
        const myPub = this.db.getUserPub();
        if (!myPub)
            throw new Error("Not logged in");
        const groupInfo = {
            id: groupId,
            name,
            description,
            adminPub: myPub,
            secret: groupSecret,
            encryptionMode: 'symmetric',
            type,
            features: {
                callsEnabled: true,
                activityEnabled: true,
            }
        };
        try {
            await this.db.Put(`linda_rooms/${groupId}/meta`, groupInfo);
            await this.db.Put(`linda_rooms/${groupId}/members/${myPub}`, {
                role: "administrator",
                joinedAt: Date.now(),
            });
        }
        catch (e) {
            console.error(`[GroupService] Failed to initialize group ${groupId} nodes:`, e);
            throw new Error("Failed to initialize group nodes on GunDB");
        }
        return groupInfo;
    }
    async getMemberRole(groupId, memberPub) {
        try {
            const member = await this.db.Get(`linda_rooms/${groupId}/members/${memberPub}`);
            if (member && member.role)
                return member.role;
            const meta = await this.db.Get(`linda_rooms/${groupId}/meta`);
            if (meta && meta.adminPub === memberPub) {
                return "administrator";
            }
        }
        catch (e) { }
        return null;
    }
    onMemberRoleChange(groupId, memberPub, callback) {
        const path = `linda_rooms/${groupId}/members/${memberPub}/role`;
        const evId = `role_${groupId}_${memberPub}_${Math.random().toString(36).slice(2, 9)}`;
        this.db.On(path, (data) => {
            if (data) {
                callback(data);
            }
            else {
                this.getMemberRole(groupId, memberPub).then(callback);
            }
        }, evId);
        return () => {
            this.db.Off(evId);
        };
    }
    onMuteStatusChange(groupId, memberPub, callback) {
        const path = `linda_rooms/${groupId}/mutes/${memberPub}`;
        const evId = `mute_${groupId}_${memberPub}_${Math.random().toString(36).slice(2, 9)}`;
        this.db.On(path, (data) => {
            callback(!!data);
        }, evId);
        return () => {
            this.db.Off(evId);
        };
    }
    async canPerform(groupId, action) {
        const myPub = this.db.getUserPub();
        if (!myPub)
            return false;
        if (action === "send_message") {
            try {
                const isMuted = await this.isMuted(groupId, myPub);
                if (isMuted)
                    return false;
            }
            catch (e) { }
        }
        const role = await this.getMemberRole(groupId, myPub);
        if (action === "send_message") {
            try {
                const meta = await this.db.Get(`linda_rooms/${groupId}/meta`);
                if (meta && meta.type === "broadcast") {
                    if (!role || (role !== "administrator" && role !== "moderator")) {
                        return false;
                    }
                }
            }
            catch (e) { }
        }
        if (!role) {
            try {
                const meta = await this.db.Get(`linda_rooms/${groupId}/meta`);
                if (meta && meta.adminPub === myPub) {
                    return true;
                }
                if (meta && meta.type !== "broadcast") {
                    const peerPerms = ["send_message", "start_call", "delete_own_message", "invite_peer", "report"];
                    if (peerPerms.includes(action))
                        return true;
                }
            }
            catch (e) { }
            return false;
        }
        const permissions = {
            peer: ["send_message", "start_call", "delete_own_message", "invite_peer", "report"],
            moderator: [
                "send_message", "start_call", "delete_own_message", "invite_peer", "report",
                "update_meta", "pin_message", "delete_any_message", "mute_peer", "toggle_features", "invite_moderator", "action_reports", "kick_user"
            ],
            administrator: [
                "send_message", "start_call", "delete_own_message", "invite_peer", "report",
                "update_meta", "pin_message", "delete_any_message", "mute_peer", "toggle_features", "invite_moderator", "action_reports", "kick_user",
                "promote_moderator", "invite_admin", "promote_admin_manual"
            ]
        };
        return permissions[role].includes(action);
    }
    async muteMember(groupId, memberPub, muted) {
        if (!(await this.canPerform(groupId, "mute_peer")))
            throw new Error("Unauthorized");
        await this.db.Put(`linda_rooms/${groupId}/mutes/${memberPub}`, muted ? Date.now() : null);
    }
    async isMuted(groupId, memberPub) {
        try {
            const muted = await this.db.Get(`linda_rooms/${groupId}/mutes/${memberPub}`);
            return !!muted;
        }
        catch (e) {
            return false;
        }
    }
    async updateGroupMeta(groupId, updates) {
        if (!(await this.canPerform(groupId, "update_meta")))
            throw new Error("Unauthorized");
        try {
            const meta = await this.db.Get(`linda_rooms/${groupId}/meta`);
            await this.db.Put(`linda_rooms/${groupId}/meta`, { ...meta, ...updates });
        }
        catch (e) {
            console.error('[GroupService] Failed to update group meta:', e);
            throw new Error("Failed to update group metadata on GunDB");
        }
    }
    async toggleFeature(groupId, feature, enabled) {
        if (!(await this.canPerform(groupId, "toggle_features")))
            throw new Error("Unauthorized");
        try {
            const meta = await this.db.Get(`linda_rooms/${groupId}/meta`);
            const features = { ...meta.features, [feature]: enabled };
            await this.db.Put(`linda_rooms/${groupId}/meta`, { ...meta, features });
        }
        catch (e) {
            console.error('[GroupService] Failed to toggle feature:', e);
            throw new Error("Failed to update group features on GunDB");
        }
    }
    async updateMemberRole(groupId, memberPub, newRole) {
        const myPub = this.db.getUserPub();
        if (!myPub)
            throw new Error("Not logged in");
        const myRole = await this.getMemberRole(groupId, myPub);
        if (!myRole)
            throw new Error("Not a member");
        if (myPub === memberPub) {
            if (newRole === 'administrator')
                throw new Error("Cannot promote self to admin");
            if (myRole === 'administrator') {
                const members = await this.getMembers(groupId);
                const adminCount = members.filter(m => m.role === 'administrator').length;
                if (adminCount <= 1)
                    throw new Error("Cannot downgrade the last administrator");
            }
            await this.db.Put(`linda_rooms/${groupId}/members/${memberPub}/role`, newRole);
            return;
        }
        if (newRole === "administrator" && !(await this.canPerform(groupId, "promote_admin_manual"))) {
            throw new Error("Administrators can only be added via specific invite links");
        }
        if (newRole === "moderator" && !(await this.canPerform(groupId, "promote_moderator")))
            throw new Error("Unauthorized");
        if (newRole === "peer" && !(await this.canPerform(groupId, "kick_user")))
            throw new Error("Unauthorized");
        await this.db.Put(`linda_rooms/${groupId}/members/${memberPub}/role`, newRole);
    }
    async getMembers(groupId) {
        try {
            const meta = await this.db.Get(`linda_rooms/${groupId}/meta`);
            const membersNode = await this.db.Get(`linda_rooms/${groupId}/members`);
            const members = [];
            if (membersNode) {
                const pubs = Object.keys(membersNode).filter(pub => pub !== "_" && pub !== ">" && membersNode[pub] !== null);
                const memberData = await Promise.all(pubs.map(async (pub) => {
                    try {
                        const data = await this.db.Get(`linda_rooms/${groupId}/members/${pub}`, 3000);
                        if (data) {
                            return {
                                pub,
                                role: data.role || (meta && meta.adminPub === pub ? "administrator" : "peer"),
                                joinedAt: data.joinedAt || Date.now(),
                                umbral_pk: data.umbral_pk,
                                pq_pk: data.pq_pk,
                            };
                        }
                    }
                    catch (e) { }
                    return {
                        pub,
                        role: (meta && meta.adminPub === pub ? "administrator" : "peer"),
                        joinedAt: Date.now(),
                    };
                }));
                members.push(...memberData);
            }
            if (meta && meta.adminPub && !members.find((m) => m.pub === meta.adminPub)) {
                members.push({
                    pub: meta.adminPub,
                    role: "administrator",
                    joinedAt: Date.now(),
                });
            }
            return members;
        }
        catch (e) {
            console.warn(`[GroupService] Failed to get members for ${groupId}:`, e);
            return [];
        }
    }
    async kickMember(groupId, memberPub) {
        if (!(await this.canPerform(groupId, "kick_user")))
            throw new Error("Unauthorized");
        await this.db.Put(`linda_rooms/${groupId}/members/${memberPub}`, null);
        await this.db.Put(`linda_v3_contacts_${memberPub}/${groupId}`, null);
    }
    async leaveGroup(groupId, force = false) {
        const myPub = this.db.getUserPub();
        if (!myPub)
            throw new Error("Not logged in");
        if (!force) {
            const myRole = await this.getMemberRole(groupId, myPub);
            if (myRole === 'administrator') {
                const members = await this.getMembers(groupId);
                const adminCount = members.filter(m => m.role === 'administrator').length;
                if (adminCount <= 1) {
                    throw new Error("LAST_ADMIN_WARNING");
                }
            }
        }
        await this.db.Put(`linda_rooms/${groupId}/members/${myPub}`, null);
        await this.db.Put(`linda_v3_contacts_${myPub}/${groupId}`, null);
    }
    async pinMessage(groupId, messageId, pinned) {
        if (!(await this.canPerform(groupId, "pin_message")))
            throw new Error("Unauthorized");
        await this.db.Put(`linda_rooms/${groupId}/pins/${messageId}`, pinned ? Date.now() : null);
    }
    async deleteMessage(groupId, messageId, senderPub) {
        const myPub = this.db.getUserPub();
        const isOwn = myPub === senderPub;
        if (isOwn) {
            if (!(await this.canPerform(groupId, "delete_own_message")))
                throw new Error("Unauthorized");
        }
        else {
            if (!(await this.canPerform(groupId, "delete_any_message")))
                throw new Error("Unauthorized");
        }
        await this.db.Put(`linda_rooms/${groupId}/deleted_messages/${messageId}`, {
            deletedAt: Date.now(),
            deletedBy: myPub
        });
    }
    async reportContent(groupId, contentId, reason) {
        if (!(await this.canPerform(groupId, "report")))
            throw new Error("Unauthorized");
        const reportId = this.generateUUID();
        await this.db.Put(`linda_rooms/${groupId}/reports/${reportId}`, {
            type: "content",
            contentId,
            reason,
            reportedBy: this.db.getUserPub(),
            timestamp: Date.now(),
            status: "pending"
        });
    }
    async reportUser(groupId, targetPub, reason) {
        if (!(await this.canPerform(groupId, "report")))
            throw new Error("Unauthorized");
        const reportId = globalThis.crypto.randomUUID();
        await this.db.Put(`linda_rooms/${groupId}/reports/${reportId}`, {
            type: "user",
            targetPub,
            reason,
            reportedBy: this.db.getUserPub(),
            timestamp: Date.now(),
            status: "pending"
        });
    }
    async getReports(groupId) {
        if (!(await this.canPerform(groupId, "action_reports")))
            throw new Error("Unauthorized");
        const reportsNode = await this.db.Get(`linda_rooms/${groupId}/reports`);
        if (!reportsNode)
            return [];
        return Object.entries(reportsNode)
            .filter(([id, data]) => id !== "_" && id !== ">" && data !== null)
            .map(([id, data]) => ({ id, ...data }));
    }
    async resolveReport(groupId, reportId, status) {
        if (!(await this.canPerform(groupId, "action_reports")))
            throw new Error("Unauthorized");
        const report = await this.db.Get(`linda_rooms/${groupId}/reports/${reportId}`);
        if (!report)
            throw new Error("Report not found");
        await this.db.Put(`linda_rooms/${groupId}/reports/${reportId}/status`, status);
    }
    async generateInvite(groupId, role = "peer", singleUse = false) {
        const action = role === "administrator" ? "invite_admin" : (role === "moderator" ? "invite_moderator" : "invite_peer");
        if (!(await this.canPerform(groupId, action)))
            throw new Error("Unauthorized");
        const meta = await this.db.Get(`linda_rooms/${groupId}/meta`);
        if (!meta)
            throw new Error("Group not found");
        const inviteId = this.generateUUID();
        const invite = {
            g: groupId,
            s: meta.secret,
            r: role,
            t: Date.now() + (role === 'administrator' ? 1 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000),
            u: singleUse || role === 'administrator',
            id: inviteId
        };
        if (invite.u) {
            await this.db.Put(`linda_rooms/${groupId}/active_invites/${inviteId}`, { status: 'active' });
        }
        return btoa(unescape(encodeURIComponent(JSON.stringify(invite))));
    }
    async joinGroup(inviteB64) {
        let jsonStr = "";
        const cleanInviteB64 = inviteB64.trim().replace(/ /g, "+");
        try {
            jsonStr = decodeURIComponent(escape(atob(cleanInviteB64)));
        }
        catch (e) {
            try {
                jsonStr = atob(cleanInviteB64);
            }
            catch (e2) {
                throw new Error("Invalid invite format");
            }
        }
        const invite = JSON.parse(jsonStr);
        const myPub = this.db.getUserPub();
        if (!myPub)
            throw new Error("Not logged in");
        if (Date.now() > invite.t)
            throw new Error("Invite expired");
        const meta = await this.db.Get(`linda_rooms/${invite.g}/meta`);
        if (!meta)
            throw new Error("Group meta not found");
        await this.db.Put(`linda_rooms/${invite.g}/members/${myPub}`, {
            role: invite.r,
            joinedAt: Date.now()
        });
        return meta;
    }
    async setGroupPublic(groupId, isPublic, publicName) {
        await this.db.Put(`linda_rooms/${groupId}/meta/isPublic`, isPublic);
        if (publicName) {
            await this.db.Put(`linda_rooms/${groupId}/meta/publicName`, publicName);
            if (isPublic) {
                await this.db.Put(`linda_public_index/${publicName}`, groupId);
            }
            else {
                await this.db.Put(`linda_public_index/${publicName}`, null);
            }
        }
    }
    async getPublicGroup(publicName) {
        try {
            const groupId = await this.db.Get(`linda_public_index/${publicName}`);
            return groupId || null;
        }
        catch (e) {
            return null;
        }
    }
    async joinPublicGroup(publicName) {
        const groupId = await this.getPublicGroup(publicName);
        if (!groupId)
            throw new Error("Public group not found");
        const inviteB64 = await this.generateInvite(groupId, 'peer');
        return await this.joinGroup(inviteB64);
    }
    async getP2PGroupId(contactPub) {
        const myPub = this.db.getUserPub();
        if (!myPub)
            throw new Error("Not logged in");
        const sorted = [myPub, contactPub].sort();
        return `p2p_${sorted[0]}_${sorted[1]}`;
    }
    async getOrCreateP2PGroup(contactPub) {
        const groupId = await this.getP2PGroupId(contactPub);
        let meta = null;
        try {
            meta = await this.db.Get(`linda_rooms/${groupId}/meta`);
        }
        catch (e) { }
        if (!meta) {
            // Create a virtual meta for P2P direct chat
            meta = {
                id: groupId,
                name: "Direct Chat",
                description: "Encrypted P2P Conversation",
                adminPub: this.db.getUserPub() || "",
                secret: "", // No shared group secret needed, uses P2P ECDH via CommunicationService
                encryptionMode: 'symmetric',
                type: 'group'
            };
            await this.db.Put(`linda_rooms/${groupId}/meta`, meta);
        }
        // Proactive check: Ensure member entry exists
        try {
            const memberData = await this.db.Get(`linda_rooms/${groupId}/members/${contactPub}`);
            if (!memberData) {
                await this.db.Put(`linda_rooms/${groupId}/members/${contactPub}`, {
                    role: 'peer',
                    joinedAt: Date.now()
                });
            }
        }
        catch (e) {
            console.warn("[GroupService] Proactive member sync check failed (benign):", e);
        }
        return meta;
    }
    // Removed TPRE repair logic
    // Removed ensureUmbralPK logic
    async encryptGroupMessage(group, plaintext) {
        const groupSecret = group.secret || "";
        if (!groupSecret) {
            // If there's no group secret, return plaintext directly (used for P2P where outer envelope is encrypted)
            return plaintext;
        }
        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);
        const keyData = Uint8Array.from(atob(groupSecret), c => c.charCodeAt(0));
        const key = await window.crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["encrypt"]);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        return btoa(String.fromCharCode(...combined));
    }
    async decryptGroupMessage(group, boxed) {
        const groupSecret = group.secret || "";
        if (!groupSecret) {
            // P2P messages are decrypted externally, we just return the raw payload here
            return boxed;
        }
        if (!boxed)
            return "";
        let combined;
        try {
            combined = Uint8Array.from(atob(boxed), c => c.charCodeAt(0));
        }
        catch (e) {
            return boxed; // Might already be plaintext or external crypto
        }
        const iv = combined.slice(0, 12);
        const ciphertextArr = combined.slice(12);
        const keyData = Uint8Array.from(atob(groupSecret), c => c.charCodeAt(0));
        const key = await window.crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["decrypt"]);
        try {
            const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertextArr);
            return new TextDecoder().decode(decrypted);
        }
        catch (e) {
            return boxed; // Fallback
        }
    }
}
