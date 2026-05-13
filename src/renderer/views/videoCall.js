// ── Video Call View Controller ────────────────────────────────────
// Uses WebRTC (SimplePeer) for video/audio, signaling via Hyperswarm streams
const VideoCallView = {
    peer: null,
    localStream: null,
    screenStream: null,
    currentCallPeerId: null,
    isMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    startWithScreenShare: false,
    pendingSignals: [], // Buffer signals before peer is created

    init() {
        document.getElementById('btn-end-call').addEventListener('click', () => this.endCall());
        document.getElementById('btn-toggle-mic').addEventListener('click', () => this.toggleMic());
        document.getElementById('btn-toggle-camera').addEventListener('click', () => this.toggleCamera());
        document.getElementById('btn-screen-share').addEventListener('click', () => this.toggleScreenShare());
        document.getElementById('btn-accept-call').addEventListener('click', () => this.acceptCall());
        document.getElementById('btn-reject-call').addEventListener('click', () => this.rejectCall());

        // Set up P2P call signal handler — buffers signals if peer not ready
        P2P.onCallSignal = ({ from, data }) => {
            if (this.peer && this.currentCallPeerId === from && !this.peer.destroyed) {
                this.peer.signal(data);
            } else if (this.currentCallPeerId === from) {
                // Buffer signals until peer is created (receiver hasn't accepted yet)
                console.log('[VideoCall] Buffering signal from', from.slice(0, 12));
                this.pendingSignals.push(data);
            }
        };
    },

    // Called by P2P when a call-request message arrives
    handleIncomingCall(from, callerName) {
        console.log('[VideoCall] Incoming call from:', callerName);
        if (this.peer || this.localStream || this.currentCallPeerId) {
            P2P.sendCallBusy(from);
            return;
        }
        this.currentCallPeerId = from;
        this.pendingSignals = []; // Clear old signals
        this.showIncomingCallUI(callerName);
    },

    handleCallAccepted(from) {
        console.log('[VideoCall] Call accepted by', from.slice(0, 12));
        document.getElementById('call-status').textContent = 'Connected';
        document.getElementById('call-info').classList.add('hidden');
    },

    handleCallRejected(from) {
        document.getElementById('call-status').textContent = 'Call rejected';
        setTimeout(() => this.endCall(), 2000);
    },

    handleCallEnded(from) {
        console.log('[VideoCall] Call ended by remote');
        document.getElementById('incoming-call-modal').classList.add('hidden');
        this.cleanupCall();
        App.showView('main');
    },

    handleCallBusy(from) {
        document.getElementById('call-status').textContent = 'User is busy on another call';
        setTimeout(() => this.endCall(), 2000);
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

            this.peer = new SimplePeer({
                initiator: true,
                stream: this.localStream,
                trickle: true,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ],
                },
            });

            this.peer.on('signal', (data) => {
                // Send call request with first offer, then signal data for ICE
                if (data.type === 'offer') {
                    P2P.sendCallRequest(peerId, App.currentUser.profile.name);
                }
                // Send all signal data (offer, answer, ICE candidates)
                P2P.sendCallSignal(peerId, data);
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

    showIncomingCallUI(callerName) {
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
        if (!this.currentCallPeerId) return;
        const from = this.currentCallPeerId;

        App.showView('video-call');
        document.getElementById('call-peer-name').textContent = 'Connecting...';
        document.getElementById('call-status').textContent = 'Connecting...';
        document.getElementById('call-info').classList.remove('hidden');

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('local-video').srcObject = this.localStream;

            this.peer = new SimplePeer({
                initiator: false,
                stream: this.localStream,
                trickle: true,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ],
                },
            });

            this.peer.on('signal', (data) => {
                P2P.sendCallSignal(from, data);
                if (data.type === 'answer') {
                    P2P.sendCallAccepted(from);
                }
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

            // Replay any buffered signals (offer + ICE candidates that arrived before accept)
            console.log('[VideoCall] Replaying', this.pendingSignals.length, 'buffered signals');
            for (const sig of this.pendingSignals) {
                this.peer.signal(sig);
            }
            this.pendingSignals = [];
        } catch (err) {
            console.error('[VideoCall] Failed to accept call:', err);
            this.endCall();
        }
    },

    rejectCall() {
        document.getElementById('incoming-call-modal').classList.add('hidden');
        if (this.currentCallPeerId) {
            P2P.sendCallRejected(this.currentCallPeerId);
            this.currentCallPeerId = null;
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
            if (window.electronAPI) {
                if (window.electronAPI.checkScreenPermission) {
                    const hasPerm = await window.electronAPI.checkScreenPermission();
                    if (!hasPerm) {
                        window.electronAPI.showNotification(
                            'Permission Required',
                            'Please allow Screen Recording in System Settings -> Privacy & Security.'
                        );
                        return;
                    }
                }

                if (window.electronAPI.getDesktopSources) {
                    const sources = await window.electronAPI.getDesktopSources();
                    if (!sources || sources.length === 0) {
                        console.warn('[VideoCall] No screen sources available');
                        return;
                    }

                    const selectedSource = await this.showScreenPicker(sources);
                    if (!selectedSource) return;

                    this.screenStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                            }
                        },
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: selectedSource.id,
                                maxWidth: 1920,
                                maxHeight: 1080,
                                maxFrameRate: 30
                            },
                        },
                    });
                }
            } else {
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
        } catch (err) {
            console.error('[VideoCall] Screen share failed:', err);
            this.isScreenSharing = false;
        }
    },

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
    },

    // ── End & Cleanup ────────────────────────────────────────────────

    endCall() {
        if (this.currentCallPeerId) {
            P2P.sendCallEnded(this.currentCallPeerId);
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
        this.startWithScreenShare = false;
        this.pendingSignals = [];

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
