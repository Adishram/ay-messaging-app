// identity.js — Mnemonic-based identity (Session-like)
// 8 random words → deterministic seed → Hyperswarm keypair

const ID_DB_NAME = 'ay-identity';
const STORE      = 'keys';
const MNEMONIC_WORDS = 8;

// ── IndexedDB ────────────────────────────────────────────────────────

async function openIdentityDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ID_DB_NAME, 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Mnemonic Generation ──────────────────────────────────────────────

function generateMnemonic() {
  // Pick 8 random words from BIP-39 wordlist (2048 words)
  const indices = new Uint16Array(MNEMONIC_WORDS);
  crypto.getRandomValues(indices);
  return Array.from(indices).map(i => BIP39_WORDLIST[i % 2048]);
}

// ── Seed Derivation ──────────────────────────────────────────────────

async function mnemonicToSeed(words) {
  // words → PBKDF2 → 32-byte seed
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(words.join(' ')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const seedBuf = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode('A&Y-mnemonic-seed-v1'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 bytes
  );
  return new Uint8Array(seedBuf);
}

// ── Identity Management ──────────────────────────────────────────────

async function createNewIdentity(displayName) {
  const mnemonic = generateMnemonic();
  const seed = await mnemonicToSeed(mnemonic);
  
  // Send seed to main process, get back the Hyperswarm public key
  const pubKeyHex = await window.electronAPI.swarmInit(
    Array.from(seed) // Send as regular array (IPC serialization)
  );

  const identity = {
    mnemonic,
    seedHex: bufToHex(seed),
    pubKeyHex,
    profile: {
      name: displayName || 'Anonymous',
      avatarColor: randomColor(),
    },
  };

  // Store in IndexedDB
  const db = await openIdentityDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });

  return identity;
}

async function restoreFromMnemonic(words, displayName) {
  const seed = await mnemonicToSeed(words);

  // Send seed to main process, get back the Hyperswarm public key
  const pubKeyHex = await window.electronAPI.swarmInit(
    Array.from(seed)
  );

  const identity = {
    mnemonic: words,
    seedHex: bufToHex(seed),
    pubKeyHex,
    profile: {
      name: displayName || 'Anonymous',
      avatarColor: randomColor(),
    },
  };

  // Store in IndexedDB
  const db = await openIdentityDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });

  return identity;
}

async function getStoredIdentity() {
  const db = await openIdentityDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    tx.objectStore(STORE).get('identity').onsuccess = e => res(e.target.result || null);
    tx.onerror = e => rej(e.target.error);
  });
}

async function initExistingIdentity() {
  const identity = await getStoredIdentity();
  if (!identity) return null;

  // If the stored identity is from the old ECDH system, clear it
  if (!identity.seedHex || !identity.mnemonic) {
    console.warn('[Identity] Stale identity format detected, clearing...');
    await clearIdentity();
    return null;
  }

  // Re-initialize swarm with stored seed
  const seed = hexToBuf(identity.seedHex);
  const pubKeyHex = await window.electronAPI.swarmInit(
    Array.from(new Uint8Array(seed))
  );

  // Verify the public key matches
  if (pubKeyHex !== identity.pubKeyHex) {
    console.warn('[Identity] Public key mismatch after re-init, updating...');
    identity.pubKeyHex = pubKeyHex;
    await updateIdentityField('pubKeyHex', pubKeyHex);
  }

  return identity;
}

// Update the local identity profile (name, avatar, etc.)
async function updateIdentityProfile(updates) {
  const db = await openIdentityDB();
  const identity = await getStoredIdentity();
  if (!identity) throw new Error('No identity found');

  Object.assign(identity.profile, updates);

  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });

  return identity;
}

async function updateIdentityField(field, value) {
  const db = await openIdentityDB();
  const identity = await getStoredIdentity();
  if (!identity) return;
  identity[field] = value;
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });
}

// Clear the entire identity (for account deletion)
async function clearIdentity() {
  const db = await openIdentityDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear().onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });
}

// Completely destroy the identity database (full wipe)
async function destroyIdentityDatabase() {
  // Close any existing connection
  try {
    const db = await openIdentityDB();
    db.close();
  } catch (_) {}
  
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(ID_DB_NAME);
    req.onsuccess = () => {
      console.log('[Identity] Database destroyed');
      resolve();
    };
    req.onerror = (e) => reject(e.target.error);
    req.onblocked = () => {
      console.warn('[Identity] Database deletion blocked, forcing...');
      resolve();
    };
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

const bufToHex    = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('');
const hexToBuf    = h => new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b,16))).buffer;
const randomColor = () => `hsl(${Math.floor(Math.random()*360)},60%,50%)`;

// Format public key for display: AY-XXXX-XXXX-...-XXXX
function formatPubKeyShort(hex) {
  if (!hex) return '';
  return hex.slice(0, 8) + '…' + hex.slice(-8);
}

function formatPubKeyDisplay(hex) {
  if (!hex) return '';
  // Group into 8-char chunks
  return hex.match(/.{1,8}/g).join('-');
}
