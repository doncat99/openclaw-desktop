<div align="center">
  <img src="https://raw.githubusercontent.com/openclaw/openclaw/main/ui/public/apple-touch-icon.png" width="96" alt="OpenClaw" />
  <h1>AEGIS Desktop</h1>
  <p><strong>Advanced Executive General Intelligence System</strong></p>
  <p>The desktop client that turns your OpenClaw Gateway into a full mission control center.</p>
</div>

---

![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.2.21-blueviolet)

---

## 🤔 Why AEGIS Desktop?

OpenClaw is powerful — but managing it through a terminal or basic UI leaves a lot on the table. AEGIS Desktop gives it a proper home:

- 💬 **Chat** — streaming responses, artifacts, images, voice, and multi-tab sessions
- 🔘 **Smart Quick Replies** — clickable buttons when the AI needs your decision
- 📊 **Analytics** — see exactly what you're spending and where, broken down by model and agent
- 🤖 **Agent Hub** — manage all your agents from a single panel
- ⏰ **Cron Monitor** — schedule and control jobs visually
- 🌍 **Bilingual** — full Arabic (RTL) and English (LTR) support out of the box

If you run OpenClaw, AEGIS Desktop is the UI it deserves.

---

## 📋 Table of Contents

- [Screenshots](#-screenshots)
- [Features](#-features)
- [What's New in v5.3](#-whats-new-in-v53)
- [What's New in v5.2](#-whats-new-in-v52)
- [What's New in v5.1](#-whats-new-in-v51)
- [How It Works](#-how-it-works)
- [Installation](#-installation)
- [Development](#️-development)
- [Tech Stack](#-tech-stack)

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

### 🌑 Dark Mode — All Pages
![Dark Mode](screenshots/pages-dark.gif)

### 🌕 Light Mode — All Pages
![Light Mode](screenshots/pages-light.gif)

---

## ✨ Features

### 🏠 Dashboard — Mission Control (Cost-First Design)
- **Hero Cards** — total cost, tokens, sessions, and active agents at a glance
- **Cost chart** — spending over time with model breakdown
- **Active agents** panel with live status indicators
- **Quick Actions** — heartbeat, email check, calendar, compact context
- **Live sessions** feed with recent activity
- **`Promise.allSettled`** — individual API failures don't break the page

### 💬 Chat
- **Auto-load history** — previous conversation loads automatically on connect
- **Smart Quick Replies** — AI can present clickable buttons via `[[button:Label]]` markers for quick decisions
- **Multi-tab sessions** — open multiple chats with `Ctrl+Tab` switching
- **Streaming responses** with real-time markdown rendering
- **Image support** — paste, drag & drop, or upload images (inline base64)
- **Video playback** — video URLs render as inline players with controls
- **File attachments** — non-image files sent as paths for the agent to read
- **User message markdown** — tables, code blocks, and formatting in user messages
- **Tool Intent View** — collapsible cards showing tool calls with name, params, and result (toggle in Settings)
- **Emoji Picker** with search, categories, and direction-aware positioning
- **Voice playback** — TTS audio via Edge TTS or other providers
- **Floating Chat Widget** (Intercom-style) — available on every page
- **Compaction Divider** — animated shimmer separator when context is compressed
- **Message Queue** — messages buffer during disconnect and auto-send on reconnect
- **Auto Code Detection** — syntax highlighting with `oneLight`/`oneDark` auto-switching based on theme
- **Clean history display** — injected metadata is stripped from user messages for a clean chat view

### 🎨 Artifacts Preview
- **Separate preview window** for interactive content
- **HTML** — full pages with inline CSS/JS
- **React** — JSX support via Babel standalone (React 18 pre-loaded)
- **SVG** — raw SVG markup rendering
- **Mermaid** — diagram syntax rendering
- Sandboxed iframe for security — CDN scripts allowed via CSP

### 📊 Full Analytics
- **17-file analytics suite** replacing the old Cost Tracker
- **Overview cards** — total cost, tokens, sessions with animated counters
- **Cost chart** — area chart by model over time (Recharts)
- **Model breakdown** — tokens and cost per model with progress rings
- **Agent breakdown** — per-agent usage stats
- **Token breakdown** — input/output/cache distribution
- **Daily breakdown table** — sortable rows with cost per day
- **Date Range Picker** — 6 presets + custom range with Apply/Save workflow
- **Tiered fetching** — starts with 30 days, loads more on demand (90d → 365d)
- **Export** — CSV download or copy summary to clipboard
- **Smart cache** — stale-while-revalidate in localStorage

### 🤖 Agent Hub
- **Main Agent** hero card with live status
- **Registered Agents** grid — view all configured agents
- **Agent CRUD** — create, edit, and delete agents directly from the UI
- **Active Workers** — monitor isolated sessions (cron jobs, sub-agents)
- **Smart Classification** — 10 worker types with auto-detected icons and colors

### ⏰ Cron Monitor
- **Job Dashboard** — view all scheduled jobs with status, schedule, and controls
- **Run / Pause / Resume** — manage jobs with one click
- **Run History** — expandable view showing last 10 runs per job
- **Human-readable schedules** — "Every 6h", "Daily at 9:00 PM"
- **Templates** — 4 ready-made templates (Morning Briefing, Weekly Digest, Check-In, System Health)
- **Disabled jobs visible** — uses `includeDisabled: true` to show paused jobs

### 🔧 Skills Marketplace
- **Browse** 3,286+ skills from ClawHub with vector search
- **Highlighted Skills** — curated top skills in a visual grid
- **Categories** — filter by category with pill-style chips
- **Detail Panel** — description, version, stats, and `clawhub install` command with copy button
- **My Skills** — view locally installed skills

### 💻 Integrated Terminal
- **Real shell** — PowerShell (Windows) or Bash (Linux/Mac) via xterm.js + node-pty
- **Multi-tab** — open multiple terminal tabs
- **Auto-resize** — adapts to window size
- **Clickable links** — URLs in terminal output are clickable
- **Graceful fallback** — shows "not available" message if native module isn't loaded

### 📋 Workshop (Kanban)
- **Drag & Drop** task board with Queue / In Progress / Done columns
- **Task cards** with priority badges, descriptions, and agent assignments
- **Agent commands** — any model can manage tasks via `[[workshop:add/move/delete/progress/list]]`

### 🧠 Memory Explorer
- **Two modes** — connect to a Memory API server or browse local `.md` files
- **Semantic search** (API mode) or text search (local mode)
- **Color-coded categories** — visual bars and badges by memory type
- **CRUD operations** — create, edit, and delete memories

### 🔔 Notification Center
- **Bell badge** with unread count
- **Notification history** panel
- **Chime sound** + Do Not Disturb mode

### 🎛️ Title Bar Controls
- **Model Picker** — switch models dynamically from the title bar (loaded from gateway config)
- **Thinking Picker** — change reasoning level (off / low / medium / high) on the fly
- **Token usage bar** — always visible context percentage
- **1M Context Toggle** — available in Settings for Anthropic API

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command Palette |
| `Ctrl+1` – `Ctrl+8` | Navigate to page |
| `Ctrl+,` | Open Settings |
| `Ctrl+Tab` | Switch chat tabs |
| `Ctrl+W` | Close current tab |
| `Ctrl+N` | Go to Chat |
| `Ctrl+R` | Refresh |
| `Alt+Space` | Show/hide window (global) |

### 🌓 Theme System
- **Dark Mode** — deep background with electric blue accents
- **Light Mode** — cool gray background with teal/blue accents
- **CSS Variables** — full token-based system (`--aegis-*`) across all components
- **Theme Utilities** — `themeHex()`, `themeAlpha()`, `overlay()`, `dataColor()` for charts/SVG
- **Data Palette** — 10 distinct colors for charts and graphs, both dark and light variants
- **Code blocks** auto-switch between `oneLight` and `oneDark` syntax themes
- Switch anytime from Settings with instant preview

### 🌐 Multi-Language (Full RTL/LTR)
- **Arabic (العربية)** — full RTL layout
- **English** — full LTR layout
- All pages use logical CSS properties (`ms-`, `me-`, `text-start`, `text-end`)
- Switch anytime from Settings

### 🔐 Security
- **Ed25519 Device Identity** — auto-generated keypair for gateway authentication
- **Challenge-response handshake** — secure WebSocket connection
- **`webSecurity: true` always** — Origin rewrite handles `file://` connections without disabling security
- **Sandboxed artifact preview** — CSP-protected iframe with `sandbox: true`
- **No hardcoded credentials** — token saved locally via IPC

### 🎨 Design
- **Glass morphism** with blur and transparency effects
- **Glass Pill** window controls (custom title bar)
- **Framer Motion** animations throughout
- **Splash Screen** on startup

### 🔌 Connection
- **Auto-reconnect** with exponential backoff
- **Activity-based heartbeat** — detects dead connections within 45s
- **Offline message queue** — buffers messages, auto-flushes on reconnect

---

## 🆕 What's New in v5.3

### New Features
- **Skills Page** — Browse and search 3,286+ skills from the ClawHub marketplace. Vector-powered search, category filters, detail panel with `clawhub install` command, and a My Skills view for locally installed skills.

  ![Skills](screenshots/Skills.gif)

- **Integrated Terminal** — Full PowerShell/Bash terminal inside the app, powered by xterm.js and node-pty. Multi-tab support, auto-resize, clickable links, and graceful fallback if the native module isn't available.

  ![Terminal](screenshots/Terminal.gif)

- **Pairing UX** — Auto-detects when the Gateway requires pairing. Shows clear CLI approval instructions (`openclaw pairing approve`) with automatic retry, cancel option, and manual token entry.

- **Connection Settings** — Gateway URL and Token are now editable from the Settings page. The app works for any user without requiring an external config file.

### Fixes & Improvements
- **Cron Monitor** — 12 performance fixes including ref-based caching, batched loading, responsive grid, and reduced tick interval
- **Table Overflow** — Wide markdown tables now scroll horizontally instead of breaking the chat bubble
- **CompactDivider** — Context compaction is now detected instantly from agent events instead of unreliable polling
- **CSP Fix** — Google Fonts (IBM Plex Sans Arabic) no longer blocked by Content Security Policy
- **PTY Crash Fix** — "Object has been destroyed" error on app close resolved
- **Thinking Stream UI** — Reasoning bubble ready for when Gateway adds WebSocket reasoning support

---

## 🆕 What's New in v5.2

### New Features
- **Smart Quick Reply Buttons** — AI can present clickable button chips via `[[button:Label]]` markers when it needs a decision. Works with any AI model — no gateway config required. Buttons auto-dismiss after click or manual send.

  ![Quick Replies](screenshots/quick-replies.gif)

- **Auto-load chat history** — previous conversation loads automatically when the app connects (no more blank welcome screen)
- **Clean history display** — injected Desktop context and metadata are stripped from user messages for a clean chat view
- **Dynamic version** — app version is sourced from `package.json` via Vite define plugin (single source of truth)
- **Optimized system prompt** — AEGIS Desktop context reduced by ~33% (fewer tokens per conversation start)

### Security Improvements
- **`webSecurity: true` always enabled** — previously disabled in production as a workaround for `file://` → `ws://` connections. Now uses Origin header rewriting for both WebSocket and HTTP requests, keeping `webSecurity` enabled in all environments ([Electron Security: `webSecurity`](https://www.electronjs.org/docs/latest/tutorial/security#6-do-not-disable-websecurity))
- **Broader Origin rewrite** — covers `ws://`, `wss://`, `http://`, and `https://` (previously WebSocket only). Only rewrites when Origin is `null` or `file://` (packaged app)

### Fixes & Improvements
- **Cron Monitor** — disabled/paused jobs now visible (`includeDisabled: true` parameter)
- **Full Analytics overhaul:**
  - `Promise.allSettled` — partial data still displays if one API call fails
  - Tiered fetching — starts at 30 days, loads 90d/365d on demand
  - Preset workflow — preset clicks are volatile, Apply button persists the selection
  - localStorage key versioned (`savedPreset` v2) — prevents stale values from old versions
  - Cache timestamp bug fixed (`.ts` → `.timestamp`)
  - "This Month" preset now includes day 31
  - "All Time" uses server totals directly (no `hasAllData` guard)
- **User messages in history** — noise filter now only applies to assistant messages (was incorrectly hiding user messages containing Desktop metadata)
- **Duplicate `call()` method** removed from gateway client

---

## 🆕 What's New in v5.1

### New Features
- **Dashboard rewrite** — cost-first design with hero cards, agent panel, and live sessions feed
- **Full Analytics** — 17-file analytics suite replacing Cost Tracker (date ranges, agent/model/token breakdowns, daily table, export)
- **Model Picker** — switch AI models from the title bar (dynamically loaded from gateway config)
- **Thinking Picker** — change reasoning level (off / low / medium / high) from the title bar
- **Tool Intent View** — see what tools the AI is calling with collapsible cards (toggle in Settings)
- **Light Mode** — complete light theme with custom palette, auto-switching code blocks
- **Theme System** — full CSS variable architecture (`--aegis-*` tokens), zero hardcoded colors
- **1M Context Toggle** — enable extended context window in Settings (Anthropic API)
- **`gateway.call()`** — public RPC method for direct gateway communication

### Fixes & Improvements
- **All hardcoded colors removed** — every component uses theme tokens (dark + light safe)
- **Dashboard resilience** — `Promise.allSettled` prevents single API failure from breaking the page
- **Code blocks** — auto-switch `oneLight`/`oneDark` syntax theme based on app theme
- **Model detection** — exact match (`===`) instead of `includes()` for accurate active model indicator
- **Central Store** — Zustand store with smart polling (10s/30s/120s intervals) and event listening
- **Cost Tracker removed** — fully replaced by Full Analytics at `/costs` and `/analytics`

---

## 🔌 How It Works

AEGIS Desktop is a frontend client — it doesn't store or generate any data on its own. All intelligence, sessions, and history live in your **OpenClaw Gateway**.

### Data Flow

```
OpenClaw Gateway (local or remote)
        │
        │  WebSocket (ws://)
        ▼
  AEGIS Desktop
  ├── Chat       ← sends messages, receives streaming responses
  ├── Dashboard  ← polls sessions, cost, and agent status
  ├── Analytics  ← fetches cost summary and token usage history
  ├── Agent Hub  ← reads and manages registered agents
  ├── Cron       ← lists, runs, pauses, and edits scheduled jobs
  └── Workshop   ← local Kanban board (stored in-app)
```

### Where Data Comes From

| Page | Source |
|------|--------|
| Chat history | `gateway.getHistory()` — loaded automatically on connect |
| Cost & tokens | `gateway.getCostSummary(days)` |
| Sessions | `gateway.getSessions()` |
| Agents | `gateway.getAgents()` |
| Cron jobs | `gateway.getCronJobs()` |
| Models | `config.get → agents.defaults.models` |
| Workshop tasks | Local (stored in-app via Zustand) |

### Requirements

AEGIS Desktop requires a running **OpenClaw Gateway** instance. On first launch, you'll go through a one-time pairing flow that authenticates the app with your gateway using an Ed25519 device identity.

### 🤖 Model Awareness (System Prompt)

AEGIS Desktop injects a context block at the start of each conversation so the AI model knows it's running inside the app and can use its features (artifacts, workshop commands, quick replies).

<details>
<summary>View injected context</summary>

```
[AEGIS_DESKTOP_CONTEXT]
You are connected via AEGIS Desktop — an Electron-based OpenClaw Gateway client.

CAPABILITIES:
- User can attach: images (base64), files (as paths), screenshots, voice messages
- You can send: markdown (syntax highlighting, tables, RTL/LTR auto-detection), images, videos
- The interface supports dark/light themes and bilingual Arabic/English layout

ARTIFACTS (opens in a separate preview window):
For interactive content, wrap in:
<aegis_artifact type="TYPE" title="Title">...content...</aegis_artifact>

Types: html | react | svg | mermaid

WORKSHOP (Kanban task management):
- [[workshop:add title="Task" priority="high|medium|low" description="Desc" agent="Name"]]
- [[workshop:move id="ID" status="queue|inProgress|done"]]
- [[workshop:delete id="ID"]]
- [[workshop:progress id="ID" value="0-100"]]

QUICK REPLIES (clickable buttons):
Add [[button:Label]] at the END of your message when you need a decision.
- Max 2-5 buttons. ONLY for decisions that block your next step.
[/AEGIS_DESKTOP_CONTEXT]
```

</details>

This context is injected once per conversation and not shown in the chat UI. The model uses it to render artifacts in the preview window, manage Workshop tasks via text commands, and present quick reply buttons when it needs a decision from the user.

---

## 📦 Installation

1. Download `AEGIS-Desktop-Setup-5.3.0.exe` from [Releases](../../releases)
2. Run the installer — choose your language (Arabic / English)
3. Make sure [OpenClaw](https://github.com/openclaw/openclaw) Gateway is running
4. On first launch, pair with your gateway (one-time setup)

### Portable

Download `AEGIS-Desktop-5.3.0.exe` — runs without installation.

### Requirements

- Windows 10/11
- [OpenClaw](https://github.com/openclaw/openclaw) v2026.2.21 or later
- OpenClaw Gateway running locally or remotely

---

## 🛠️ Development

```bash
npm install
npm run dev            # Vite + Electron (hot reload)
npm run dev:web        # Vite only (browser, no Electron)
npm run build          # Production build
npm run package        # NSIS Installer
npm run package:portable  # Portable exe
```

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 34 |
| UI | React 18 + TypeScript 5.7 |
| Build | Vite 6 |
| Styling | TailwindCSS + CSS Variables |
| Animations | Framer Motion |
| State | Zustand (persisted) |
| Charts | Recharts |
| Icons | Lucide React |
| i18n | react-i18next |

---

## 📄 License

[MIT](LICENSE) — free to use, modify, and distribute.
