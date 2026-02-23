# Changelog

All notable changes to AEGIS Desktop are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/).

---

## [5.3.0] — 2026-02-22

### Added
- **Skills Page** — browse and search 3,286+ skills from ClawHub with vector search, categories, and detail panel
- **Integrated Terminal** — PowerShell / Bash via xterm.js + node-pty, multi-tab, auto-resize, clickable links
- **Pairing UX** — auto-detects when Gateway requires pairing, shows CLI instructions with auto-retry
- **Connection Settings** — Gateway URL and Token editable in Settings (no config file needed)
- **Thinking Stream UI** — reasoning bubble for future Gateway WebSocket reasoning support

### Fixed
- **Cron Monitor** — 12 fixes: ref-based caching, batched loading, responsive grid, reduced tick interval
- **Table Overflow** — wide markdown tables scroll horizontally instead of breaking chat bubbles
- **CompactDivider** — context compaction detected from agent events instead of polling
- **CSP** — Google Fonts (IBM Plex Sans Arabic) no longer blocked
- **PTY Crash** — "Object has been destroyed" on app close resolved

---

## [5.2.1] — 2026-02-21

### Fixed
- **Command Palette i18n** — all entries translated correctly
- **Pairing error** — clearer error message + auto-detect system language

---

## [5.2.0] — 2026-02-20

### Added
- **Smart Quick Reply Buttons** — AI presents clickable chips via `[[button:Label]]` for decisions. Works with any model, no gateway config needed
- **Auto-load chat history** — conversation loads on connect (no blank screen)
- **Clean history display** — Desktop metadata stripped from user messages
- **Dynamic version** — single source of truth from `package.json`
- **Optimized system prompt** — context injection reduced ~33%

### Security
- **`webSecurity` always enabled** — Origin header rewriting replaces the old workaround of disabling Chromium web security
- **Broader Origin rewrite** — covers WS + HTTP protocols (previously WebSocket only)

### Fixed
- **Cron Monitor** — disabled/paused jobs now visible
- **Full Analytics** — `Promise.allSettled` for resilience, tiered fetching (30d → 90d → 365d), preset workflow redesign, cache bug fix, "This Month" day-31 fix, "All Time" uses server totals
- **Chat** — user messages restored in history (noise filter was over-filtering)
- Removed duplicate `call()` method in gateway client

---

## [5.1.0] — 2026-02-17

### Added
- **Dashboard** — rewritten with cost-first design, hero cards, agent panel, live sessions feed
- **Full Analytics** — 17-file suite replacing Cost Tracker (date ranges, model/agent/token breakdowns, daily table, CSV export)
- **Model Picker** — switch AI models from the title bar
- **Thinking Picker** — change reasoning level (off / low / medium / high)
- **Tool Intent View** — collapsible cards showing tool calls with params and results
- **Light Mode** — complete theme with custom palette
- **Theme System** — CSS variable architecture (`--aegis-*`), zero hardcoded colors
- **1M Context Toggle** — extended context for Anthropic API
- **`gateway.call()`** — public RPC method for direct gateway communication

### Fixed
- All hardcoded colors replaced with theme tokens
- Code blocks auto-switch between `oneLight` and `oneDark` syntax themes
- Model detection uses exact match instead of `includes()`
- Central Zustand store with smart polling intervals (10s / 30s / 120s)
- Cost Tracker removed — fully replaced by Full Analytics

---

## [5.0.0] — 2026-02-16

### Added
- **Artifacts Preview** — HTML, React, SVG, and Mermaid in a sandboxed window
- **Video playback** — inline video players for URL attachments
- **Workshop** — Kanban board manageable by AI via text commands
- **RTL/LTR overhaul** — logical CSS properties throughout

---

## [4.0.0] — 2026-02-09

### Added
- **Mission Control Dashboard** — agent monitoring and status overview
- **Bilingual UI** — Arabic (RTL) and English (LTR) with logical CSS
- **Notification Center** — bell badge, history panel, chime sound
- **Memory Explorer** — browse and search agent memories
- **Emoji Picker** — categories, search, and direction-aware positioning
- **Ed25519 device identity** — auto-generated keypair for gateway authentication
- **Challenge-response handshake** — secure WebSocket connection
