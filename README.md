# A&Y - Privacy-First Peer-to-Peer Messaging

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()

A completely open-source, serverless, peer-to-peer messaging and video calling application for macOS and Windows. 

A&Y is built on the philosophy that **privacy is the default**. There are no accounts, no central databases, and no middlemen. Your identity is a cryptographic key pair generated locally on your device.

## ✨ Core Features

- 🚫 **Zero Servers**: Messages and files travel directly between peers using WebRTC Data Channels. There is no central server permanently storing your data.
- 🔒 **Pure Privacy (E2E Encrypted)**: Every message is encrypted using **AES-256-GCM**. Keys are derived using Elliptic-Curve Diffie-Hellman (ECDH) key exchanges entirely on-device.
- 💾 **Local-First Storage**: All your contacts, conversations, and messages are stored securely on your local machine using IndexedDB. 
- 🎭 **Decentralized Identity**: Your ID is purely cryptographic. No email, phone number, or username is ever required.
- 📁 **P2P File Transfer**: Send files of any size over encrypted local-network or WAN WebRTC connections using automatic chunking and backpressure control.
- 📹 **High-Quality Video Calling**: Unmonitored, ultra-low latency audio and video streams routed peer-to-peer.

## 🚀 Download & Installation

The easiest way to get started is to download the pre-compiled application for your operating system.

### Option 1: Official Website
Visit our official website for the beautiful download experience and more information about our privacy protocols:
[👉 Download A&Y from the Official Website](https://adishram.github.com/ay-website)

### Option 2: GitHub Releases
You can download the latest binaries directly from our GitHub Releases page:
- **macOS (Apple Silicon / M-Series)**: Download `A&Y-Mac-Silicon.zip`
- **macOS (Intel)**: Download `A&Y-Mac-Intel.zip`
- **Windows**: Download `A&Y-Windows.exe`

📥 **[Download the latest release here](https://github.com/Adishram/ay-messaging-app/releases/latest)**

---

## 🏗️ Architecture & Tech Stack

A&Y leverages a fully modern, serverless Electron architecture:
- **Frontend**: Vanilla JS, HTML, TailwindCSS (for maximum performance and transparency).
- **Desktop Environment**: [Electron](https://www.electronjs.org/).
- **Networking/WebRTC**: [Simple-Peer](https://github.com/feross/simple-peer).
- **Signaling**: A minimal Node.js / Socket.io relay is used *strictly* for the initial exchange of WebRTC SDP offers and ICE candidates. After the connection is established, the signaling server is completely bypassed.
- **Cryptography**: Native Web Crypto API (`P-256`, `AES-GCM`).

## 🛠️ Contributing & Development

A&Y is open-source and we welcome contributions from developers, designers, and privacy advocates. Transparency is our ultimate security.

If you are a developer and want to build the application from source, follow these steps:

### Prerequisites
- Node.js (v18+)
- npm

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Adishram/ay-messaging-app.git
   cd ay-messaging-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the application (Development Mode):**
   ```bash
   npm start
   ```

### Building for Release

To compile the application into native executables for your operating system:

**For macOS:**
```bash
npm run build:mac
```
*(Note: Building for both Apple Silicon and Intel is supported with `electron-builder`.)*

**For Windows:**
```bash
npm run build:win
```

## 🐛 Issues & Feature Requests
If you find a bug or have a feature request, please [open an issue](https://github.com/Adishram/ay-messaging-app/issues). Pull requests are always welcome!

## 📜 License

This project is licensed under the [MIT License](LICENSE).
