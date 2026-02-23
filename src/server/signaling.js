const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, Users } = require('node-appwrite');

function startSignalingServer(port) {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: { origin: '*' },
    });

    // ── Appwrite Server SDK for JWT verification (1.1) ──────────────
    const appwriteClient = new Client()
        .setEndpoint('https://sgp.cloud.appwrite.io/v1')
        .setProject('699ae7eb000093672a04');

    // ── Multi-Session Presence ──────────────────────────────────────
    const onlineUsers = new Map(); // userId -> Set<socketId>

    function addUserSocket(userId, socketId) {
        if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
        onlineUsers.get(userId).add(socketId);
    }

    function removeUserSocket(userId, socketId) {
        const sockets = onlineUsers.get(userId);
        if (sockets) {
            sockets.delete(socketId);
            if (sockets.size === 0) onlineUsers.delete(userId);
        }
    }

    function getOnlineUserIds() {
        return Array.from(onlineUsers.keys());
    }

    function getAnySocketForUser(userId) {
        const sockets = onlineUsers.get(userId);
        if (sockets && sockets.size > 0) return sockets.values().next().value;
        return null;
    }

    function emitToUser(userId, event, data) {
        const sockets = onlineUsers.get(userId);
        if (sockets) {
            for (const sid of sockets) io.to(sid).emit(event, data);
        }
    }

    // ── Block List Cache ────────────────────────────────────────────
    // In production, query Appwrite. For now, track in-memory per session.
    const blockedBy = new Map(); // userId -> Set<blockedUserId>

    function isBlocked(fromUser, toUser) {
        const blocked = blockedBy.get(toUser);
        return blocked ? blocked.has(fromUser) : false;
    }

    // ── Rate Limiting (1.5) ─────────────────────────────────────────
    const rateLimits = new Map(); // socketId -> { event: { count, resetAt } }

    const RATE_LIMITS = {
        'call-user': { max: 5, windowMs: 60000 },       // 5 calls/min
        'message': { max: 60, windowMs: 60000 },          // 60 msgs/min
        'add-contact': { max: 10, windowMs: 60000 },      // 10 adds/min
        'typing': { max: 30, windowMs: 10000 },            // 30 typing events/10s
    };

    function checkRateLimit(socketId, eventName) {
        const limit = RATE_LIMITS[eventName];
        if (!limit) return true; // no limit configured

        if (!rateLimits.has(socketId)) rateLimits.set(socketId, {});
        const socketLimits = rateLimits.get(socketId);

        const now = Date.now();
        if (!socketLimits[eventName] || now > socketLimits[eventName].resetAt) {
            socketLimits[eventName] = { count: 1, resetAt: now + limit.windowMs };
            return true;
        }

        socketLimits[eventName].count++;
        if (socketLimits[eventName].count > limit.max) {
            return false; // rate limited
        }
        return true;
    }

    // ── Verify Appwrite JWT ─────────────────────────────────────────
    async function verifyJWT(jwt) {
        try {
            // Create a client authenticated with the user's JWT
            const userClient = new Client()
                .setEndpoint('https://sgp.cloud.appwrite.io/v1')
                .setProject('699ae7eb000093672a04')
                .setJWT(jwt);

            const users = new Users(userClient);
            // The JWT itself encodes the user ID — we use Account to get it
            const { Account } = require('node-appwrite');
            const accountService = new Account(userClient);
            const user = await accountService.get();
            return user.$id; // Return verified user ID
        } catch (err) {
            console.warn('[Signaling] JWT verification failed:', err.message);
            return null;
        }
    }

    io.on('connection', (socket) => {
        console.log(`[Signaling] Client connected: ${socket.id}`);

        // Register with JWT verification (1.1)
        socket.on('register', async (userId, jwt) => {
            if (!userId || typeof userId !== 'string') {
                socket.emit('auth-error', { message: 'Invalid user ID' });
                return;
            }

            // Verify JWT if provided
            if (jwt && jwt !== 'session-token') {
                const verifiedId = await verifyJWT(jwt);
                if (!verifiedId) {
                    socket.emit('auth-error', { message: 'Invalid authentication token' });
                    return;
                }
                if (verifiedId !== userId) {
                    socket.emit('auth-error', { message: 'Token does not match user ID' });
                    return;
                }
                console.log(`[Signaling] User verified via JWT: ${userId}`);
            } else {
                // Fallback: accept without verification (dev mode)
                console.log(`[Signaling] User registered (unverified): ${userId}`);
            }

            addUserSocket(userId, socket.id);
            socket.userId = userId;
            io.emit('online-users', getOnlineUserIds());
        });

        // Update block list from client
        socket.on('update-block-list', (blockedUserIds) => {
            if (!socket.userId) return;
            blockedBy.set(socket.userId, new Set(blockedUserIds));
        });

        // ── Call Events ──────────────────────────────────────────────

        socket.on('call-user', ({ to, offer, callerName }) => {
            if (!socket.userId) return;
            if (!checkRateLimit(socket.id, 'call-user')) {
                socket.emit('call-error', { message: 'Too many call attempts. Please wait.' });
                return;
            }
            if (isBlocked(socket.userId, to)) {
                socket.emit('call-error', { message: 'Cannot call this user' });
                return;
            }
            const targetSocket = getAnySocketForUser(to);
            if (targetSocket) {
                io.to(targetSocket).emit('incoming-call', {
                    from: socket.userId,
                    offer,
                    callerName,
                });
            } else {
                socket.emit('call-error', { message: 'User is offline' });
            }
        });

        socket.on('call-accepted', ({ to, answer }) => {
            if (!socket.userId) return;
            emitToUser(to, 'call-accepted', { from: socket.userId, answer });
        });

        socket.on('call-rejected', ({ to }) => {
            if (!socket.userId) return;
            emitToUser(to, 'call-rejected', { from: socket.userId });
        });

        socket.on('ice-candidate', ({ to, candidate }) => {
            if (!socket.userId) return;
            emitToUser(to, 'ice-candidate', { from: socket.userId, candidate });
        });

        socket.on('end-call', ({ to }) => {
            if (!socket.userId) return;
            emitToUser(to, 'call-ended', { from: socket.userId });
        });

        socket.on('call-busy', ({ to }) => {
            if (!socket.userId) return;
            emitToUser(to, 'call-busy', { from: socket.userId });
        });

        // ── Presence Events ──────────────────────────────────────────

        socket.on('typing-start', ({ to }) => {
            if (!socket.userId) return;
            if (!checkRateLimit(socket.id, 'typing')) return;
            emitToUser(to, 'typing-start', { from: socket.userId });
        });

        socket.on('typing-stop', ({ to }) => {
            if (!socket.userId) return;
            emitToUser(to, 'typing-stop', { from: socket.userId });
        });

        // ── Screen Share ─────────────────────────────────────────────

        socket.on('screen-share-started', ({ to }) => {
            if (!socket.userId) return;
            emitToUser(to, 'screen-share-started', { from: socket.userId });
        });

        socket.on('screen-share-stopped', ({ to }) => {
            if (!socket.userId) return;
            emitToUser(to, 'screen-share-stopped', { from: socket.userId });
        });

        // ── Message delivery relay ───────────────────────────────────

        socket.on('message-delivered', ({ to, messageId }) => {
            if (!socket.userId) return;
            emitToUser(to, 'message-delivered', { from: socket.userId, messageId });
        });

        socket.on('message-read', ({ to, messageId }) => {
            if (!socket.userId) return;
            emitToUser(to, 'message-read', { from: socket.userId, messageId });
        });

        // ── Disconnect ──────────────────────────────────────────────

        socket.on('disconnect', () => {
            if (socket.userId) {
                removeUserSocket(socket.userId, socket.id);
                io.emit('online-users', getOnlineUserIds());
                rateLimits.delete(socket.id);
                console.log(`[Signaling] Disconnected: ${socket.userId} (remaining: ${(onlineUsers.get(socket.userId) || new Set()).size})`);
            }
        });
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[Signaling] Port ${port} in use — another instance running.`);
        } else {
            console.error('[Signaling] Server error:', err);
        }
    });

    server.listen(port, () => {
        console.log(`[Signaling] Server listening on port ${port}`);
    });

    return server;
}

module.exports = { startSignalingServer };
