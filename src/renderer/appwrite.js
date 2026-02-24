// ── Appwrite Configuration ────────────────────────────────────────
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '699ae7eb000093672a04';

// Database & collection IDs
const DATABASE_ID = '699b051a00072365f03d';
const COLLECTIONS = {
    USERS: 'users',
    CONVERSATIONS: 'conversations',
    MESSAGES: 'messages',
};

// Storage bucket ID for file uploads
const STORAGE_BUCKET_ID = '699b09b50039797d5b07';

// File upload limits
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_FILE_TYPES = [
    ...ALLOWED_IMAGE_TYPES,
    ...ALLOWED_VIDEO_TYPES,
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/zip',
];

// ── SDK Setup ─────────────────────────────────────────────────────
let client, account, databases, avatars, storage;

function initAppwrite() {
    client = new Appwrite.Client();
    client.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);

    account = new Appwrite.Account(client);
    databases = new Appwrite.Databases(client);
    avatars = new Appwrite.Avatars(client);
    storage = new Appwrite.Storage(client);
}

// ── Auth Helpers ──────────────────────────────────────────────────

async function signUp(email, password, name) {
    // Validate password strength before sending to Appwrite
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    if (!/[A-Z]/.test(password)) throw new Error('Password must contain an uppercase letter');
    if (!/[0-9]/.test(password)) throw new Error('Password must contain a number');

    const user = await account.create(
        Appwrite.ID.unique(),
        email,
        password,
        name
    );
    await login(email, password);
    // Profile creation is handled by ensureUserProfile in onAuthSuccess
    return user;
}

async function login(email, password) {
    return await account.createEmailPasswordSession(email, password);
}

/**
 * Ensure the user has a profile document in the "users" collection.
 * If sign-up created the Auth entry but failed to create the document,
 * this will catch it and create the profile now.
 */
async function ensureUserProfile(user) {
    const existing = await getUserProfile(user.$id);

    // Always ensure the local keypair exists and matches Appwrite
    const keyPair = await Encryption.getOrCreateKeyPair(user.$id);
    const publicKeyB64 = await Encryption.exportPublicKey(keyPair.publicKey);

    if (existing) {
        if (existing.publicKey !== publicKeyB64) {
            console.log('[Auth] Public key mismatch, updating profile...');
            try {
                await databases.updateDocument(DATABASE_ID, COLLECTIONS.USERS, user.$id, {
                    publicKey: publicKeyB64,
                });
            } catch (e) {
                console.warn('[Auth] Failed to sync new public key:', e);
            }
        }
        return existing;
    }

    console.log('[Auth] User profile missing, creating now...');

    try {
        return await databases.createDocument(DATABASE_ID, COLLECTIONS.USERS, user.$id, {
            userId: user.$id,
            name: user.name,
            email: user.email,
            avatarUrl: avatars.getInitials(user.name).toString(),
            lastSeen: 'online',
            publicKey: publicKeyB64,
        });
    } catch (e) {
        console.error('[Auth] Failed to create user profile:', e);
        throw new Error('Account created but profile setup failed: ' + e.message);
    }
}

async function logout() {
    Encryption.clearCache();
    return await account.deleteSession('current');
}

async function getCurrentUser() {
    try {
        return await account.get();
    } catch {
        return null;
    }
}

// ── User Helpers ──────────────────────────────────────────────────

async function getUserProfile(userId) {
    try {
        return await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
    } catch {
        return null;
    }
}

async function searchUserByEmail(email) {
    const result = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.USERS,
        [Appwrite.Query.equal('email', email)]
    );
    return result.documents.length > 0 ? result.documents[0] : null;
}

async function updateLastSeen() {
    const user = await getCurrentUser();
    if (user) {
        try {
            await databases.updateDocument(
                DATABASE_ID,
                COLLECTIONS.USERS,
                user.$id,
                { lastSeen: 'online' }
            );
        } catch (e) {
            console.warn('Could not update lastSeen', e);
        }
    }
}

// ── Conversation Helpers ──────────────────────────────────────────

async function getOrCreateConversation(currentUserId, otherUserId) {
    // Sort participant IDs deterministically to prevent duplicates (P2 #6)
    const sortedParticipants = [currentUserId, otherUserId].sort();

    const existing = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.CONVERSATIONS,
        [
            Appwrite.Query.contains('participants', sortedParticipants[0]),
            Appwrite.Query.limit(100),
        ]
    );

    const found = existing.documents.find(
        (doc) =>
            doc.participants.includes(sortedParticipants[0]) &&
            doc.participants.includes(sortedParticipants[1])
    );

    if (found) return found;

    return await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.CONVERSATIONS,
        Appwrite.ID.unique(),
        {
            participants: [currentUserId, otherUserId],
            lastMessage: '',
            createdAt: new Date().toISOString(),
            type: 'private',          // enum: private | group | broadcast
            isRead: false,
            messageCount: 0,
        }
    );
}

async function getConversations(userId) {
    const result = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.CONVERSATIONS,
        [
            Appwrite.Query.contains('participants', userId),
            Appwrite.Query.orderDesc('$updatedAt'),
        ]
    );
    return result.documents;
}

/**
 * Increment message count and update last message preview
 */
async function updateConversationOnMessage(conversationId, preview) {
    try {
        const conv = await databases.getDocument(
            DATABASE_ID,
            COLLECTIONS.CONVERSATIONS,
            conversationId
        );
        await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.CONVERSATIONS,
            conversationId,
            {
                lastMessage: preview.substring(0, 200),
                messageCount: (conv.messageCount || 0) + 1,
                isRead: false,
            }
        );
    } catch (e) {
        console.warn('updateConversationOnMessage error:', e);
    }
}

// ── Encryption Helpers ────────────────────────────────────────────

/**
 * Get the shared encryption key for a conversation with a specific user.
 * Uses ECDH: my private key + their public key = shared secret.
 */
async function getConversationEncryptionKey(myUserId, theirUserId) {
    const keyPair = await Encryption.getOrCreateKeyPair(myUserId);
    const theirProfile = await getUserProfile(theirUserId);

    if (!theirProfile || !theirProfile.publicKey) {
        console.warn('Peer has no public key — messages will not be encrypted');
        return null;
    }

    return await Encryption.getSharedKey(keyPair.privateKey, theirProfile.publicKey);
}

// ── Message Helpers ───────────────────────────────────────────────

async function sendMessage(conversationId, senderId, content, type = 'text', fileUrl = '', fileName = '', fileSize = 0, recipientId = null, replyTo = '', replyPreview = '') {
    let encryptedContent = content;
    let isEncrypted = false;

    // Encrypt text messages if we have a recipient
    if (type === 'text' && recipientId) {
        try {
            const sharedKey = await getConversationEncryptionKey(senderId, recipientId);
            if (sharedKey) {
                encryptedContent = await Encryption.encryptMessage(sharedKey, content);
                isEncrypted = true;
            }
        } catch (e) {
            console.warn('Encryption failed, sending unencrypted:', e);
        }
    }

    const docData = {
        conversationId,
        senderId,
        content: encryptedContent,
        type,
        fileUrl,
        fileName,
        fileSize,
        isEncrypted,
        createdAt: new Date().toISOString(),
        readBy: senderId,
    };

    // Only include reply fields if they have values
    if (replyTo) docData.replyTo = replyTo;
    if (replyPreview) docData.replyPreview = replyPreview;

    const message = await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.MESSAGES,
        Appwrite.ID.unique(),
        docData
    );

    // Update conversation with new message preview + increment count
    let preview = isEncrypted ? '🔒 Encrypted message' : content.substring(0, 100);
    if (type === 'image') preview = '📷 Photo';
    if (type === 'video') preview = '🎬 Video';
    if (type === 'file') preview = `📎 ${fileName}`;

    await updateConversationOnMessage(conversationId, preview);

    // Return the message with the ORIGINAL content for local display
    message._decryptedContent = content;
    return message;
}

/**
 * Mark a conversation as read (when user opens it).
 */
async function markConversationRead(conversationId) {
    try {
        await databases.updateDocument(
            DATABASE_ID,
            COLLECTIONS.CONVERSATIONS,
            conversationId,
            { isRead: true }
        );
    } catch (e) {
        console.warn('markConversationRead error:', e);
    }
}

async function getMessages(conversationId) {
    const result = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.MESSAGES,
        [
            Appwrite.Query.equal('conversationId', conversationId),
            Appwrite.Query.orderAsc('createdAt'),
            Appwrite.Query.limit(100),
        ]
    );
    return result.documents;
}

/**
 * Decrypt a message if it was encrypted.
 */
async function decryptMessageContent(msg, myUserId) {
    if (!msg.isEncrypted || msg.type !== 'text') return msg.content;

    try {
        const peerId = msg.senderId === myUserId ? null : msg.senderId;
        if (!peerId) return msg.content; // Can't decrypt own messages without peer context
        const sharedKey = await getConversationEncryptionKey(myUserId, peerId);
        if (!sharedKey) return '[Encryption key unavailable]';
        return await Encryption.decryptMessage(sharedKey, msg.content);
    } catch (e) {
        console.warn('Decryption failed:', e);
        return '[Could not decrypt message]';
    }
}

async function markMessageRead(messageId, userId) {
    try {
        const msg = await databases.getDocument(DATABASE_ID, COLLECTIONS.MESSAGES, messageId);
        if (!msg) return;

        const currentReaders = msg.readBy || '';

        // If it's already a string and includes the ID, done
        if (typeof currentReaders === 'string') {
            if (currentReaders.includes(userId)) return;
            const updated = currentReaders ? `${currentReaders},${userId}` : userId;

            if (App.socket && App.socket.connected) {
                await databases.updateDocument(
                    DATABASE_ID,
                    COLLECTIONS.MESSAGES,
                    messageId,
                    { readBy: updated }
                );
            }
        }
    } catch (e) {
        console.warn('markMessageRead error', e);
    }
}

// ── File Upload Helpers ───────────────────────────────────────────

function validateFile(file) {
    if (file.size > MAX_FILE_SIZE) {
        return { valid: false, error: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` };
    }
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        return { valid: false, error: 'File type not supported.' };
    }
    return { valid: true };
}

function getFileType(mimeType) {
    if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return 'image';
    if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return 'video';
    return 'file';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadFile(file) {
    // Workaround for Electron Chromium `Failed to fetch` bug with local files
    // Convert the DOM File object into a pure in-memory File bypassing path restrictions
    const buffer = await file.arrayBuffer();
    const safeFile = new File([buffer], file.name, { type: file.type });

    const result = await storage.createFile(
        STORAGE_BUCKET_ID,
        Appwrite.ID.unique(),
        safeFile
    );
    const fileUrl = storage.getFileView(STORAGE_BUCKET_ID, result.$id).toString();
    return {
        fileId: result.$id,
        fileUrl,
        fileName: file.name,
        fileSize: file.size,
        fileType: getFileType(file.type),
    };
}

function getFileDownloadUrl(fileId) {
    return storage.getFileDownload(STORAGE_BUCKET_ID, fileId).toString();
}

// ── Realtime Subscriptions ────────────────────────────────────────

function subscribeToMessages(conversationId, callback) {
    return client.subscribe(
        `databases.${DATABASE_ID}.collections.${COLLECTIONS.MESSAGES}.documents`,
        (response) => {
            const payload = response.payload;
            if (payload.conversationId === conversationId) {
                callback(response.events, payload);
            }
        }
    );
}

function subscribeToConversations(userId, callback) {
    return client.subscribe(
        `databases.${DATABASE_ID}.collections.${COLLECTIONS.CONVERSATIONS}.documents`,
        (response) => {
            const payload = response.payload;
            if (payload.participants && payload.participants.includes(userId)) {
                callback(response.events, payload);
            }
        }
    );
}

// ── Settings / Account Helpers ────────────────────────────────────

async function updateUserName(newName) {
    // Update Appwrite account name
    await account.updateName(newName);
    // Update user profile document
    const user = await getCurrentUser();
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.USERS, user.$id, {
        name: newName,
    });
}

async function updateUserAvatar(avatarUrl) {
    const user = await getCurrentUser();
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.USERS, user.$id, {
        avatarUrl,
    });
}

async function uploadProfilePicture(file) {
    // Upload to storage
    const result = await storage.createFile(
        STORAGE_BUCKET_ID,
        Appwrite.ID.unique(),
        file
    );
    const fileUrl = storage.getFileView(STORAGE_BUCKET_ID, result.$id).toString();
    // Update user profile
    await updateUserAvatar(fileUrl);
    return fileUrl;
}

async function updatePassword(oldPassword, newPassword) {
    return await account.updatePassword(newPassword, oldPassword);
}

async function deleteUserAccount() {
    const user = await getCurrentUser();
    const userId = user.$id;

    // ── Cascade delete all user data (P1 #3) ─────────────────────

    // 1. Delete all messages sent by this user
    try {
        let hasMore = true;
        while (hasMore) {
            const msgs = await databases.listDocuments(
                DATABASE_ID,
                COLLECTIONS.MESSAGES,
                [
                    Appwrite.Query.equal('senderId', userId),
                    Appwrite.Query.limit(100),
                ]
            );
            for (const msg of msgs.documents) {
                await databases.deleteDocument(DATABASE_ID, COLLECTIONS.MESSAGES, msg.$id);
            }
            hasMore = msgs.documents.length === 100;
        }
    } catch (e) {
        console.warn('Could not delete user messages', e);
    }

    // 2. Delete all conversations involving this user
    try {
        let hasMore = true;
        while (hasMore) {
            const convos = await databases.listDocuments(
                DATABASE_ID,
                COLLECTIONS.CONVERSATIONS,
                [
                    Appwrite.Query.contains('participants', userId),
                    Appwrite.Query.limit(100),
                ]
            );
            for (const convo of convos.documents) {
                // Delete all messages in this conversation
                let moreMessages = true;
                while (moreMessages) {
                    const cMsgs = await databases.listDocuments(
                        DATABASE_ID,
                        COLLECTIONS.MESSAGES,
                        [
                            Appwrite.Query.equal('conversationId', convo.$id),
                            Appwrite.Query.limit(100),
                        ]
                    );
                    for (const m of cMsgs.documents) {
                        await databases.deleteDocument(DATABASE_ID, COLLECTIONS.MESSAGES, m.$id);
                    }
                    moreMessages = cMsgs.documents.length === 100;
                }
                await databases.deleteDocument(DATABASE_ID, COLLECTIONS.CONVERSATIONS, convo.$id);
            }
            hasMore = convos.documents.length === 100;
        }
    } catch (e) {
        console.warn('Could not delete user conversations', e);
    }

    // 3. Delete user profile document
    try {
        await databases.deleteDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
    } catch (e) {
        console.warn('Could not delete user profile document', e);
    }

    // 4. Clear local encryption keys
    localStorage.removeItem(`ay_privkey_${userId}`);
    localStorage.removeItem(`ay_pubkey_${userId}`);

    // 5. Delete all sessions (logs out everywhere)
    await account.deleteSessions();
}

// ── Block & Mute Helpers (1.4) ────────────────────────────────────

async function blockUser(userId, targetUserId) {
    const profile = await getUserProfile(userId);
    const blockedUsers = profile?.blockedUsers || [];
    if (!blockedUsers.includes(targetUserId)) {
        blockedUsers.push(targetUserId);
        await databases.updateDocument(DATABASE_ID, COLLECTIONS.USERS, userId, { blockedUsers });
    }
    return blockedUsers;
}

async function unblockUser(userId, targetUserId) {
    const profile = await getUserProfile(userId);
    const blockedUsers = (profile?.blockedUsers || []).filter((id) => id !== targetUserId);
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.USERS, userId, { blockedUsers });
    return blockedUsers;
}

async function isUserBlocked(userId, targetUserId) {
    const profile = await getUserProfile(userId);
    return (profile?.blockedUsers || []).includes(targetUserId);
}

async function muteConversation(conversationId, muted = true) {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.CONVERSATIONS, conversationId, {
        isMuted: muted,
    });
}

// ── Message Delivery Status (1.2) ─────────────────────────────────

async function updateMessageStatus(messageId, status) {
    try {
        await databases.updateDocument(DATABASE_ID, COLLECTIONS.MESSAGES, messageId, { status });
    } catch (e) {
        console.warn('Failed to update message status:', e);
    }
}
