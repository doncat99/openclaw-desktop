<div align="center">
  <img src="https://raw.githubusercontent.com/openclaw/openclaw/main/ui/public/apple-touch-icon.png" width="96" alt="OpenClaw" />
  <h1>AEGIS Desktop</h1>
  <p><strong>The desktop client that turns your OpenClaw Gateway into a full mission control center.</strong></p>
</div>

---

![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.2.21+-blueviolet)
![License](https://img.shields.io/badge/License-MIT-green)

---

OpenClaw runs your AI agents — AEGIS Desktop lets you see and control everything from one window. Chat, analytics, agent management, cron jobs, skills marketplace, and a built-in terminal. Dark and light themes, full Arabic RTL support, and keyboard-driven navigation.

---

## 📸 Screenshots

### 💬 Chat
![Chat](screenshots/chat.gif)

### 🔘 Smart Quick Reply Buttons
![Quick Replies](screenshots/quick-replies.gif)

### 🔧 Skills Marketplace
![Skills](screenshots/Skills.gif)

### 💻 Integrated Terminal
![Terminal](screenshots/Terminal.gif)

### 🌑 Dark Mode
![Dark Mode](screenshots/pages-dark.gif)

### 🌕 Light Mode
![Light Mode](screenshots/pages-light.gif)

---

## ✨ Features

### 💬 Chat & Communication
- Streaming markdown with syntax highlighting and theme-aware code blocks
- Multi-tab sessions with `Ctrl+Tab` switching
- Smart Quick Reply Buttons — AI presents clickable `[[button:Label]]` chips
- Image paste/drag/upload, file attachments, video playback, voice messages
- Artifacts preview — interactive HTML, React, SVG, and Mermaid in a sandboxed window
- Message queue with auto-send on reconnect

### 📊 Monitoring & Analytics
- **Dashboard** — cost, tokens, sessions, and active agents at a glance
- **Full Analytics** — date ranges, model/agent/token breakdowns, daily table, CSV export
- **Agent Hub** — create/edit/delete agents, monitor sub-agents and workers
- **Cron Monitor** — schedule, run, pause jobs with run history and templates

### 🔧 Tools
- **Skills Marketplace** — browse and search 3,286+ skills from ClawHub
- **Integrated Terminal** — PowerShell/Bash via xterm.js with multi-tab support
- **Workshop** — Kanban board manageable by AI via text commands
- **Memory Explorer** — semantic search and CRUD for agent memories

### 🎨 Interface
- Dark and light themes with full CSS variable system (`--aegis-*`)
- Arabic (RTL) and English (LTR) with logical CSS properties
- Command Palette (`Ctrl+K`), keyboard shortcuts, global hotkey (`Alt+Space`)
- Model and reasoning level pickers in the title bar
- Glass morphism design with Framer Motion animations
- Ed25519 device identity with challenge-response authentication

---

## 📦 Installation

Download from [Releases](../../releases):

| File | Type |
|------|------|
| `AEGIS-Desktop-Setup-X.X.X.exe` | Windows installer |
| `AEGIS-Desktop-X.X.X.exe` | Portable (no install) |

### Requirements

- Windows 10/11
- [OpenClaw](https://github.com/openclaw/openclaw) Gateway running locally or remotely

On first launch, you'll pair with your Gateway — a one-time setup using Ed25519 device authentication.

---

## 🔌 How It Works

AEGIS Desktop is a frontend client — it doesn't run AI or store data. Everything lives in your OpenClaw Gateway.

```
OpenClaw Gateway (local or remote)
        │
        │  WebSocket
        ▼
  AEGIS Desktop
  ├── Chat       ← messages + streaming responses
  ├── Dashboard  ← sessions, cost, agent status
  ├── Analytics  ← cost summary + token history
  ├── Agent Hub  ← registered agents + workers
  ├── Cron       ← scheduled jobs
  ├── Skills     ← ClawHub marketplace
  └── Terminal   ← shell via node-pty
```

---

## 🛠️ Development

```bash
npm install
npm run dev              # Electron + Vite (hot reload)
npm run dev:web          # Browser only (no Electron)
npm run build            # Production build
npm run package          # NSIS installer
npm run package:portable # Portable exe
```

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 34 |
| UI | React 18 + TypeScript 5.7 |
| Build | Vite 6 |
| Styling | Tailwind CSS + CSS Variables |
| Animations | Framer Motion |
| State | Zustand |
| Charts | Recharts |
| Terminal | xterm.js + node-pty |
| Icons | Lucide React |
| i18n | react-i18next |

---

<details>
<summary><strong>⌨️ Keyboard Shortcuts</strong></summary>

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command Palette |
| `Ctrl+1` – `Ctrl+8` | Navigate pages |
| `Ctrl+,` | Settings |
| `Ctrl+Tab` | Switch chat tabs |
| `Ctrl+W` | Close tab |
| `Ctrl+N` | New chat |
| `Ctrl+R` | Refresh |
| `Alt+Space` | Show/hide window (global) |

</details>

---

## 📚 Documentation

- [Changelog](CHANGELOG.md) — version history and release notes
- [Contributing](CONTRIBUTING.md) — how to contribute
- [Security](SECURITY.md) — vulnerability reporting
- [Code of Conduct](CODE_OF_CONDUCT.md) — community guidelines

---

## 📄 License

[MIT](LICENSE)
