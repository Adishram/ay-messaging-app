// ── Video Call View Controller ────────────────────────────────────
const VideoCallView = {
    peer: null,
    localStream: null,
    screenStream: null,
    currentCallPeerId: null,
    isMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    incomingOffer: null,
    startWithScreenShare: false,

    init() {
        document.getElementById('btn-end-call').addEventListener('click', () => this.endCall());
        document.getElementById('btn-toggle-mic').addEventListener('click', () => this.toggleMic());
        document.getElementById('btn-toggle-camera').addEventListener('click', () => this.toggleCamera());
        document.getElementById('btn-screen-share').addEventListener('click', () => this.toggleScreenShare());
        document.getElementById('btn-accept-call').addEventListener('click', () => this.acceptCall());
        document.getElementById('btn-reject-call').addEventListener('click', () => this.rejectCall());
    },

    setupSocketHandlers() {
        if (!App.socket) {
            console.warn('[VideoCall] No socket available');
            return;
        }
        console.log('[VideoCall] Setting up socket handlers');

        App.socket.on('incoming-call', ({ from, offer, callerName }) => {
            console.log('[VideoCall] Incoming call from:', callerName);
            // Auto-reject if already in a call (busy)
            if (this.peer) {
                console.log('[VideoCall] Already in call, sending busy');
                App.socket.emit('call-busy', { to: from });
                return;
            }
            this.incomingOffer = { from, offer };
            this.showIncomingCall(callerName, from);
        });

        App.socket.on('call-accepted', ({ from, answer }) => {
            console.log('[VideoCall] Call accepted, signaling answer to peer');
            if (this.peer) {
                this.peer.signal(answer);
            }
            document.getElementById('call-status').textContent = 'Connected';
            document.getElementById('call-info').classList.add('hidden');
        });

        App.socket.on('call-rejected', ({ from }) => {
            document.getElementById('call-status').textContent = 'Call rejected';
            setTimeout(() => this.endCall(), 2000);
        });

        App.socket.on('call-ended', ({ from }) => {
            console.log('[VideoCall] Call ended by remote');
            document.getElementById('incoming-call-modal').classList.add('hidden');
            this.incomingOffer = null;
            this.cleanupCall();
            App.showView('main');
        });

        App.socket.on('call-error', ({ message }) => {
            document.getElementById('call-status').textContent = message;
            setTimeout(() => this.endCall(), 2000);
        });

        App.socket.on('call-busy', () => {
            document.getElementById('call-status').textContent = 'User is busy on another call';
            setTimeout(() => this.endCall(), 2000);
        });

        App.socket.on('screen-share-started', () => {
            // Remote side started screen sharing — no overlay needed,
            // the remote track replacement handles it automatically
            console.log('[VideoCall] Remote started screen sharing');
        });

        App.socket.on('screen-share-stopped', () => {
            console.log('[VideoCall] Remote stopped screen sharing');
        });
    },

    // ── Start Call (caller side) ─────────────────────────────────────

    async startCall(peerId, peerName, withScreenShare = false) {
        this.currentCallPeerId = peerId;
        this.startWithScreenShare = withScreenShare;

        App.showView('video-call');
        document.getElementById('call-peer-name').textContent = peerName;
        document.getElementById('call-status').textContent = 'Calling...';
        document.getElementById('call-info').classList.remove('hidden');

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('local-video').srcObject = this.localStream;
            console.log('[VideoCall] Local media acquired, creating peer (initiator)');

            this.peer = new SimplePeer({
                initiator: true,
                stream: this.localStream,
                trickle: false,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                    ],
                },
            });

            this.peer.on('signal', (data) => {
                console.log('[VideoCall] Sending offer to', peerId);
                App.socket.emit('call-user', {
                    to: peerId,
                    offer: data,
                    callerName: App.currentUser.name,
                });
            });

            this.peer.on('stream', (remoteStream) => {
                console.log('[VideoCall] Remote stream received!');
                document.getElementById('remote-video').srcObject = remoteStream;
                document.getElementById('call-info').classList.add('hidden');
                if (this.startWithScreenShare) {
                    this.startWithScreenShare = false;
                    setTimeout(() => this.toggleScreenShare(), 500);
                }
            });

            this.peer.on('error', (err) => {
                console.error('[VideoCall] Peer error:', err);
                document.getElementById('call-status').textContent = 'Connection failed';
                setTimeout(() => this.endCall(), 3000);
            });

            this.peer.on('close', () => {
                this.cleanupCall();
                App.showView('main');
            });
        } catch (err) {
            console.error('[VideoCall] Failed to start call:', err);
            document.getElementById('call-status').textContent = 'Camera/mic access denied';
            setTimeout(() => this.endCall(), 3000);
        }
    },

    // ── Incoming Call UI ─────────────────────────────────────────────

    showIncomingCall(callerName) {
        const initials = ContactsView.getInitials(callerName);
        document.getElementById('incoming-caller-avatar').textContent = initials;
        document.getElementById('incoming-caller-name').textContent = callerName;
        document.getElementById('incoming-call-modal').classList.remove('hidden');

        if (window.electronAPI) {
            window.electronAPI.showNotification('Incoming Video Call', `${callerName} is calling you`);
        }
    },

    // ── Accept Call (receiver side) ──────────────────────────────────

    async acceptCall() {
        document.getElementById('incoming-call-modal').classList.add('hidden');
        if (!this.incomingOffer) return;
        const { from, offer } = this.incomingOffer;
        this.currentCallPeerId = from;

        App.showView('video-call');
        document.getElementById('call-peer-name').textContent = 'Connecting...';
        document.getElementById('call-status').textContent = 'Connecting...';
        document.getElementById('call-info').classList.remove('hidden');

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('local-video').srcObject = this.localStream;
            console.log('[VideoCall] Local media acquired, creating peer (receiver)');

            this.peer = new SimplePeer({
                initiator: false,
                stream: this.localStream,
                trickle: false,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                    ],
                },
            });

            this.peer.on('signal', (data) => {
                console.log('[VideoCall] Sending answer to', from);
                App.socket.emit('call-accepted', { to: from, answer: data });
            });

            this.peer.on('stream', (remoteStream) => {
                console.log('[VideoCall] Remote stream received!');
                document.getElementById('remote-video').srcObject = remoteStream;
                document.getElementById('call-info').classList.add('hidden');
            });

            this.peer.on('error', (err) => {
                console.error('[VideoCall] Peer error:', err);
                this.endCall();
            });

            this.peer.on('close', () => {
                this.cleanupCall();
                App.showView('main');
            });

            this.peer.signal(offer);
        } catch (err) {
            console.error('[VideoCall] Failed to accept call:', err);
            this.endCall();
        }
    },

    rejectCall() {
        document.getElementById('incoming-call-modal').classList.add('hidden');
        if (this.incomingOffer) {
            App.socket.emit('call-rejected', { to: this.incomingOffer.from });
            this.incomingOffer = null;
        }
    },

    // ── Screen Sharing with Source Picker ─────────────────────────────

    async toggleScreenShare() {
        if (this.isScreenSharing) {
            this.stopScreenShare();
        } else {
            await this.startScreenShare();
        }
    },

    async startScreenShare() {
        try {
            // Use IPC source picker to let user choose what to share
            if (window.electronAPI && window.electronAPI.getDesktopSources) {
                const sources = await window.electronAPI.getDesktopSources();
                if (!sources || sources.length === 0) {
                    console.warn('[VideoCall] No screen sources available');
                    return;
                }

                const selectedSource = await this.showScreenPicker(sources);
                if (!selectedSource) return; // User cancelled

                this.screenStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: selectedSource.id,
                        },
                    },
                });
            } else {
                // Fallback for non-Electron environments
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: 'always' },
                });
            }

            this.isScreenSharing = true;
            document.getElementById('btn-screen-share').classList.add('sharing');

            if (this.peer && this.localStream) {
                const screenTrack = this.screenStream.getVideoTracks()[0];
                const sender = this.peer._pc
                    .getSenders()
                    .find((s) => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(screenTrack);
                screenTrack.onended = () => this.stopScreenShare();
            }

            if (App.socket && this.currentCallPeerId) {
                App.socket.emit('screen-share-started', { to: this.currentCallPeerId });
            }
        } catch (err) {
            console.error('[VideoCall] Screen share failed:', err);
            this.isScreenSharing = false;
        }
    },

    // Show a picker modal for the user to choose which screen/window to share
    showScreenPicker(sources) {
        return new Promise((resolve) => {
            const modal = document.getElementById('screen-picker-modal');
            const grid = document.getElementById('screen-picker-grid');
            grid.innerHTML = '';

            for (const source of sources) {
                const item = document.createElement('div');
                item.className = 'screen-picker-item';
                item.innerHTML = `
                    <img src="${source.thumbnail}" alt="${source.name}" />
                    <span>${source.name.substring(0, 30)}</span>
                `;
                item.addEventListener('click', () => {
                    modal.classList.add('hidden');
                    resolve(source);
                });
                grid.appendChild(item);
            }

            // Cancel button
            document.getElementById('btn-cancel-screen-pick').onclick = () => {
                modal.classList.add('hidden');
                resolve(null);
            };

            modal.classList.remove('hidden');
        });
    },

    stopScreenShare() {
        this.isScreenSharing = false;
        document.getElementById('btn-screen-share').classList.remove('sharing');

        if (this.screenStream) {
            this.screenStream.getTracks().forEach((t) => t.stop());
            this.screenStream = null;
        }

        if (this.peer && this.localStream) {
            const cameraTrack = this.localStream.getVideoTracks()[0];
            if (cameraTrack) {
                const sender = this.peer._pc
                    .getSenders()
                    .find((s) => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(cameraTrack);
            }
        }

        if (App.socket && this.currentCallPeerId) {
            App.socket.emit('screen-share-stopped', { to: this.currentCallPeerId });
        }
    },

    // ── End & Cleanup ────────────────────────────────────────────────

    endCall() {
        if (this.currentCallPeerId && App.socket) {
            App.socket.emit('end-call', { to: this.currentCallPeerId });
        }
        this.cleanupCall();
        App.showView('main');
    },

    cleanupCall() {
        if (this.isScreenSharing) this.stopScreenShare();

        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
        }

        document.getElementById('local-video').srcObject = null;
        document.getElementById('remote-video').srcObject = null;

        this.currentCallPeerId = null;
        this.isMuted = false;
        this.isCameraOff = false;
        this.isScreenSharing = false;
        this.incomingOffer = null;
        this.startWithScreenShare = false;

        document.getElementById('incoming-call-modal').classList.add('hidden');

        document.getElementById('icon-mic-on').classList.remove('hidden');
        document.getElementById('icon-mic-off').classList.add('hidden');
        document.getElementById('icon-cam-on').classList.remove('hidden');
        document.getElementById('icon-cam-off').classList.add('hidden');
        document.getElementById('btn-screen-share').classList.remove('sharing');
    },

    toggleMic() {
        if (!this.localStream) return;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach((t) => (t.enabled = !this.isMuted));
        document.getElementById('icon-mic-on').classList.toggle('hidden', this.isMuted);
        document.getElementById('icon-mic-off').classList.toggle('hidden', !this.isMuted);
    },

    toggleCamera() {
        if (!this.localStream) return;
        this.isCameraOff = !this.isCameraOff;
        this.localStream.getVideoTracks().forEach((t) => (t.enabled = !this.isCameraOff));
        document.getElementById('icon-cam-on').classList.toggle('hidden', this.isCameraOff);
        document.getElementById('icon-cam-off').classList.toggle('hidden', !this.isCameraOff);
    },
};
