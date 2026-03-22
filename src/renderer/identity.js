// identity.js — Local-first identity using ECDH keypairs

const ID_DB_NAME = 'ay-identity';
const STORE   = 'keys';

async function openIdentityDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ID_DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function getOrCreateIdentity() {
  const db = await openIdentityDB();
  const get = () => new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    tx.objectStore(STORE).get('identity').onsuccess = e => res(e.target.result);
    tx.onerror = e => rej(e.target.error);
  });

  let identity = await get();
  if (identity) return identity;

  // Generate ECDH keypair
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,  // extractable
    ['deriveKey', 'deriveBits']
  );

  const [pubKeyRaw, privKeyRaw] = await Promise.all([
    crypto.subtle.exportKey('raw', keypair.publicKey),
    crypto.subtle.exportKey('pkcs8', keypair.privateKey),
  ]);

  // Hash the public key to create a short, shareable user ID
  const hashBuf = await crypto.subtle.digest('SHA-256', pubKeyRaw);
  const userId  = bufToHex(hashBuf).slice(0, 16);  // 16-char ID

  identity = {
    userId,
    pubKeyHex:  bufToHex(pubKeyRaw),
    privKeyB64: bufToBase64(privKeyRaw),
    profile: { name: 'Anonymous', avatarColor: randomColor() },
  };

  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });

  return identity;
}

// Update the local identity profile (name, avatar, etc.)
async function updateIdentityProfile(updates) {
  const db = await openIdentityDB();
  const identity = await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    tx.objectStore(STORE).get('identity').onsuccess = e => res(e.target.result);
    tx.onerror = e => rej(e.target.error);
  });

  if (!identity) throw new Error('No identity found');

  Object.assign(identity.profile, updates);

  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });

  return identity;
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

// Produce a shareable connection string: ay://add/<pubKeyHex>
function makeConnectionString(identity) {
  return `ay://add/${identity.pubKeyHex}`;
}

// Parse a connection string pasted by the other user
function parseConnectionString(str) {
  const match = str.trim().match(/^ay:\/\/add\/([0-9a-f]{130})$/i);
  if (!match) throw new Error('Invalid connection string');
  return match[1];  // pubKeyHex of remote peer
}

// Helpers
const bufToHex    = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('');
const bufToBase64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const base64ToBuf = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
const hexToBuf    = h => new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b,16))).buffer;
const randomColor = () => `hsl(${Math.floor(Math.random()*360)},60%,50%)`;
