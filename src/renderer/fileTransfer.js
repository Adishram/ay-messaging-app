// fileTransfer.js — Chunked P2P file transfer over simple-peer data channel

const CHUNK_SIZE = 16 * 1024;  // 16KB chunks — safe for WebRTC data channels

const incomingFiles = new Map();  // transferId → { meta, chunks, received }

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendFileP2P(peer, file, onProgress) {
  const transferId = crypto.randomUUID();
  const buf        = await file.arrayBuffer();
  const totalChunks = Math.ceil(buf.byteLength / CHUNK_SIZE);

  // 1. Send metadata first
  peer.send(JSON.stringify({
    type: 'file-meta',
    transferId,
    name:        file.name,
    size:        file.size,
    mimeType:    file.type,
    totalChunks,
  }));

  // 2. Send chunks sequentially with backpressure
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = buf.slice(start, start + CHUNK_SIZE);

    // Wait if the data channel buffer is filling up
    while (peer._channel?.bufferedAmount > 1024 * 1024) {
      await new Promise(r => setTimeout(r, 50));
    }

    // Send JSON header + raw chunk concatenated as ArrayBuffer
    const header     = JSON.stringify({ type: 'file-chunk', transferId, index: i });
    const headerBuf  = new TextEncoder().encode(header + '\n');
    const combined   = new Uint8Array(headerBuf.byteLength + chunk.byteLength);
    combined.set(new Uint8Array(headerBuf), 0);
    combined.set(new Uint8Array(chunk), headerBuf.byteLength);

    peer.send(combined.buffer);
    onProgress?.((i + 1) / totalChunks);
  }
}

// ── Receive ───────────────────────────────────────────────────────────────────

function handleFileMeta(remotePubKeyHex, meta) {
  incomingFiles.set(meta.transferId, {
    meta,
    from: remotePubKeyHex,
    chunks:   new Array(meta.totalChunks),
    received: 0,
  });
  console.log(`[file] incoming: ${meta.name} (${meta.totalChunks} chunks)`);
}

function handleFileChunk(remotePubKeyHex, rawBuf) {
  // rawBuf is an ArrayBuffer or Uint8Array: JSON header + '\n' + binary chunk
  const view       = new Uint8Array(rawBuf);
  const newlineIdx = view.indexOf(0x0a);  // '\n'
  if (newlineIdx < 0) return;

  const headerStr  = new TextDecoder().decode(view.slice(0, newlineIdx));
  const chunkData  = view.slice(newlineIdx + 1).buffer;

  let parsed;
  try { parsed = JSON.parse(headerStr); } catch { return; }
  const { transferId, index } = parsed;

  const entry = incomingFiles.get(transferId);
  if (!entry) return;

  entry.chunks[index] = chunkData;
  entry.received++;

  if (entry.received === entry.meta.totalChunks) {
    // Reassemble
    const total  = entry.chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset   = 0;
    for (const c of entry.chunks) {
      merged.set(new Uint8Array(c), offset);
      offset += c.byteLength;
    }

    const blob = new Blob([merged], { type: entry.meta.mimeType });
    const url  = URL.createObjectURL(blob);

    // Dispatch to UI
    window.dispatchEvent(new CustomEvent('file-received', {
      detail: {
        transferId,
        from: entry.from,
        name: entry.meta.name,
        size: entry.meta.size,
        mimeType: entry.meta.mimeType,
        url,
        blob,
      },
    }));

    incomingFiles.delete(transferId);
  }
}

// Make available globally for p2p.js to call
window.__fileTransfer = { handleMeta: handleFileMeta, handleChunk: handleFileChunk };
