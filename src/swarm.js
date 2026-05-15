// swarm.js — Hyperswarm P2P networking (runs in main process)
// Handles: DHT discovery, peer connections, message relay to renderer

const Hyperswarm = require('hyperswarm');
const b4a = require('b4a');
const crypto = require('crypto');

let swarm = null;
let mainWindow = null;
let myPublicKeyHex = null;

const connections = new Map();
// Track connected peer public keys
const onlinePeers = new Set();
// Buffer incoming data per peer (for JSON message framing)
const peerBuffers = new Map();

// Group Topic Handling
const activeGroups = new Set();

// ── Initialize ──────────────────────────────────────────────────────

function init(window) {
  mainWindow = window;
}

async function startSwarm(seedArray) {
  // If already running, tear down first
  if (swarm) {
    await teardown();
  }

  const seed = Buffer.from(seedArray);
  
  swarm = new Hyperswarm({ seed });
  myPublicKeyHex = b4a.toString(swarm.keyPair.publicKey, 'hex');

  console.log('[Swarm] Started with pubkey:', myPublicKeyHex.slice(0, 16) + '...');

  // Listen on a local port and announce our public key to the DHT
  // This is REQUIRED for joinPeer() to work over the internet!
  await swarm.listen();

  // Announce ourselves on a topic derived from our public key
  // so that contacts who know our pubkey can find us
  const selfTopic = crypto.createHash('sha256')
    .update(swarm.keyPair.publicKey)
    .digest();
  
  swarm.join(selfTopic, { server: true, client: false });
  swarm.flush().catch(err => console.error('DHT flush error:', err));

  // Handle incoming connections
  swarm.on('connection', (socket, peerInfo) => {
    const remotePubKeyHex = b4a.toString(peerInfo.publicKey, 'hex');
    console.log('[Swarm] Connected to peer:', remotePubKeyHex.slice(0, 16) + '...');

    // Store connection
    connections.set(remotePubKeyHex, socket);
    onlinePeers.add(remotePubKeyHex);
    peerBuffers.set(remotePubKeyHex, '');

    // Notify renderer
    sendToRenderer('swarm-peer-connected', { pubKeyHex: remotePubKeyHex });
    sendToRenderer('swarm-online-peers', Array.from(onlinePeers));

    // Handle incoming data
    socket.on('data', (data) => {
      handleIncomingData(remotePubKeyHex, data);
    });

    socket.on('error', (err) => {
      console.error('[Swarm] Peer error:', remotePubKeyHex.slice(0, 16), err.message);
    });

    socket.on('close', () => {
      console.log('[Swarm] Peer disconnected:', remotePubKeyHex.slice(0, 16) + '...');
      connections.delete(remotePubKeyHex);
      onlinePeers.delete(remotePubKeyHex);
      peerBuffers.delete(remotePubKeyHex);
      sendToRenderer('swarm-peer-disconnected', { pubKeyHex: remotePubKeyHex });
      sendToRenderer('swarm-online-peers', Array.from(onlinePeers));
    });
  });

  swarm.on('update', () => {
    // Connection state changed
    sendToRenderer('swarm-online-peers', Array.from(onlinePeers));
  });

  return myPublicKeyHex;
}

// ── Connect to a peer ────────────────────────────────────────────────

async function connectToPeer(remotePubKeyHex) {
  if (!swarm) throw new Error('Swarm not initialized');
  if (connections.has(remotePubKeyHex)) {
    console.log('[Swarm] Already connected to', remotePubKeyHex.slice(0, 16));
    return { status: 'connected' };
  }

  const remotePubKey = b4a.from(remotePubKeyHex, 'hex');

  // Join the topic derived from the remote peer's public key
  // This lets the DHT find them
  const peerTopic = crypto.createHash('sha256')
    .update(remotePubKey)
    .digest();

  swarm.join(peerTopic, { server: false, client: true });

  // Also try direct peer connection
  swarm.joinPeer(remotePubKey);

  console.log('[Swarm] Looking for peer:', remotePubKeyHex.slice(0, 16) + '...');
  
  // Wait for the DHT lookup with a 30-second timeout
  // Over the internet, hole-punching can take time or fail silently
  const CONNECT_TIMEOUT_MS = 30000;

  try {
    await Promise.race([
      swarm.flush(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out')), CONNECT_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    console.warn('[Swarm] Flush timeout/error for peer:', remotePubKeyHex.slice(0, 16), err.message);
  }

  // Wait up to 3 seconds for socket to actually form (fixes 3-tries bug)
  for (let i = 0; i < 6; i++) {
    if (connections.has(remotePubKeyHex)) {
      return { status: 'connected' };
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Not connected yet — peer may come online later
  console.log('[Swarm] Peer not found yet, will keep trying in background:', remotePubKeyHex.slice(0, 16));
  return { status: 'pending' };
}

async function disconnectPeer(remotePubKeyHex) {
  const remotePubKey = b4a.from(remotePubKeyHex, 'hex');
  swarm.leavePeer(remotePubKey);
  
  const socket = connections.get(remotePubKeyHex);
  if (socket) {
    socket.destroy();
    connections.delete(remotePubKeyHex);
    onlinePeers.delete(remotePubKeyHex);
  }
}

// ── Send data to a peer ──────────────────────────────────────────────

function sendToPeer(remotePubKeyHex, message) {
  const socket = connections.get(remotePubKeyHex);
  if (!socket || socket.destroyed) {
    console.warn('[Swarm] No connection to', remotePubKeyHex.slice(0, 16));
    return false;
  }

  try {
    // Send JSON + newline delimiter
    const data = JSON.stringify(message) + '\n';
    socket.write(data);
    return true;
  } catch (err) {
    console.error('[Swarm] Send failed:', err.message);
    return false;
  }
}

// ── Handle incoming data ─────────────────────────────────────────────

function handleIncomingData(remotePubKeyHex, rawData) {
  // Data comes as Buffer, might be partial or multiple messages
  const dataStr = rawData.toString('utf-8');
  let buffer = (peerBuffers.get(remotePubKeyHex) || '') + dataStr;

  // Split by newline delimiter
  const lines = buffer.split('\n');
  // Last element might be incomplete — keep it in buffer
  peerBuffers.set(remotePubKeyHex, lines.pop());

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      // Forward to renderer
      sendToRenderer('swarm-message', {
        from: remotePubKeyHex,
        message: msg,
      });
    } catch (err) {
      console.error('[Swarm] Failed to parse message from', remotePubKeyHex.slice(0, 16), err.message);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function isPeerConnected(remotePubKeyHex) {
  const socket = connections.get(remotePubKeyHex);
  return socket && !socket.destroyed;
}

function getOnlinePeers() {
  return Array.from(onlinePeers);
}

function getPublicKeyHex() {
  return myPublicKeyHex;
}

async function teardown() {
  if (swarm) {
    for (const [key, socket] of connections) {
      try { socket.destroy(); } catch (_) {}
    }
    connections.clear();
    onlinePeers.clear();
    peerBuffers.clear();
    activeGroups.clear();
    
    await swarm.destroy();
    swarm = null;
    myPublicKeyHex = null;
    console.log('[Swarm] Torn down');
  }
}

async function joinGroup(topicHex) {
  if (!swarm) return;
  const topic = b4a.from(topicHex, 'hex');
  swarm.join(topic, { server: true, client: true });
  activeGroups.add(topicHex);
  await swarm.flush();
}

function broadcastGroup(topicHex, message) {
  // Simple broadcast to all connected peers
  for (const [pubKey, socket] of connections.entries()) {
    try {
      const data = JSON.stringify({ ...message, groupTopic: topicHex }) + '\n';
      socket.write(data);
    } catch (err) {
      console.warn('[Swarm] Group broadcast failed to', pubKey.slice(0, 16), err.message);
    }
  }
}

module.exports = {
  init,
  startSwarm,
  connectToPeer,
  disconnectPeer,
  sendToPeer,
  isPeerConnected,
  getOnlinePeers,
  getPublicKeyHex,
  teardown,
  joinGroup,
  broadcastGroup,
};
