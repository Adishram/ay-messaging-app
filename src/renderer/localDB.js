// localDB.js — IndexedDB replacing Appwrite collections

const APP_DB_NAME    = 'ay-app';
const DB_VERSION = 1;

const STORES = {
  contacts:      { keyPath: 'pubKeyHex' },
  conversations: { keyPath: 'id' },
  messages:      { keyPath: 'id', autoIncrement: true },
};

let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(APP_DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      for (const [name, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, opts);
          if (name === 'messages') {
            store.createIndex('by_conv', 'conversationId', { unique: false });
            store.createIndex('by_time', 'timestamp',      { unique: false });
          }
          if (name === 'conversations') {
            store.createIndex('by_peer', 'peerPubKeyHex', { unique: false });
          }
        }
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Contacts (replaces Appwrite `users` collection) ──────────────────────────

async function upsertContact(contact) {
  // contact = { pubKeyHex, userId, profile: { name, avatarColor } }
  const db = await openDB();
  return idbPut(db, 'contacts', contact);
}

async function getContact(pubKeyHex) {
  const db = await openDB();
  return idbGet(db, 'contacts', pubKeyHex);
}

async function getAllContacts() {
  const db = await openDB();
  return idbGetAll(db, 'contacts');
}

async function deleteContact(pubKeyHex) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction('contacts', 'readwrite').objectStore('contacts').delete(pubKeyHex);
    req.onsuccess = () => res();
    req.onerror = e => rej(e.target.error);
  });
}

// ── Conversations ─────────────────────────────────────────────────────────────

async function getOrCreateConversationLocal(localPubKey, remotePubKey) {
  const db   = await openDB();
  const keys = [localPubKey, remotePubKey].sort();
  const id   = await sha256Hex(keys.join(':'));

  const existing = await idbGet(db, 'conversations', id);
  if (existing) return existing;

  const conv = {
    id,
    peerPubKeyHex: remotePubKey,
    createdAt: Date.now(),
    lastMessageAt: null,
    lastMessagePreview: null,
  };
  await idbPut(db, 'conversations', conv);
  return conv;
}

async function getConversationsLocal() {
  const db = await openDB();
  const all = await idbGetAll(db, 'conversations');
  // Sort by last message time descending
  return all.sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
}

async function updateConversationPreview(convId, preview) {
  const db   = await openDB();
  const conv = await idbGet(db, 'conversations', convId);
  if (!conv) return;
  Object.assign(conv, { lastMessageAt: Date.now(), lastMessagePreview: preview });
  return idbPut(db, 'conversations', conv);
}

async function deleteConversation(convId) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction('conversations', 'readwrite').objectStore('conversations').delete(convId);
    req.onsuccess = () => res();
    req.onerror = e => rej(e.target.error);
  });
}

// ── Messages ──────────────────────────────────────────────────────────────────

async function saveMessage(msg) {
  // msg = { id, conversationId, senderId, content, timestamp, status, type }
  const db = await openDB();
  return idbPut(db, 'messages', { ...msg, timestamp: msg.timestamp || Date.now() });
}

async function getMessagesLocal(conversationId, limit = 100) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('by_conv');
    const range = IDBKeyRange.only(conversationId);
    const msgs  = [];
    index.openCursor(range, 'prev').onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor || msgs.length >= limit) { resolve(msgs.reverse()); return; }
      msgs.push(cursor.value);
      cursor.continue();
    };
    tx.onerror = e => reject(e.target.error);
  });
}

async function updateMessageStatus(msgId, status) {
  const db  = await openDB();
  const msg = await idbGet(db, 'messages', msgId);
  if (!msg) return;
  msg.status = status;
  return idbPut(db, 'messages', msg);
}

async function deleteAllMessages(conversationId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const index = store.index('by_conv');
    const range = IDBKeyRange.only(conversationId);
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { resolve(); return; }
      cursor.delete();
      cursor.continue();
    };
    tx.onerror = e => reject(e.target.error);
  });
}

// Clear all stores (for account deletion)
async function clearAllData() {
  const db = await openDB();
  await Promise.all(['contacts', 'conversations', 'messages'].map(store =>
    new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear().onsuccess = res;
      tx.onerror = e => rej(e.target.error);
    })
  ));
}

// ── IDB helpers ───────────────────────────────────────────────────────────────

function idbGet(db, store, key) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = e => res(e.target.result ?? null);
    req.onerror   = e => rej(e.target.error);
  });
}
function idbGetAll(db, store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
function idbPut(db, store, val) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(val);
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
function idbAdd(db, store, val) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).add(val);
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
async function sha256Hex(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2,'0')).join('');
}
