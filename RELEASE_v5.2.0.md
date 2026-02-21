# AEGIS Desktop v5.2.0

## 🔘 Smart Quick Reply Buttons

The headline feature of v5.2 — AI models can now present clickable button chips when they need your decision. No gateway configuration required, works with **any AI model**.

![Smart Quick Reply Buttons](https://raw.githubusercontent.com/rshodoskar-star/openclaw-desktop/main/screenshots/quick-replies.gif)

**How it works:**
- The AI adds `[[button:Label]]` markers in its response when it needs you to choose
- AEGIS Desktop strips the markers and renders them as clickable chips above the input field
- Click a button → sends the text as your message → buttons dismiss automatically
- Works universally — the instruction is part of the Desktop's context injection, so any connected model learns it instantly

---

## ✨ New Features

- **Smart Quick Reply Buttons** — clickable decision chips, powered by `[[button:Label]]` syntax
- **Auto-load chat history** — conversation loads automatically on connect (no more blank screen on launch)
- **Clean history display** — Desktop metadata and context blocks are stripped from user messages
- **Dynamic version** — single source of truth from `package.json` via Vite define plugin
- **Optimized system prompt** — Desktop context injection reduced by ~33% (saves tokens every conversation)

## 🔐 Security Improvements

- **`webSecurity` always enabled** — previously set to `false` in production as a `file://` → `ws://` workaround. Now uses smart Origin header rewriting instead, keeping Chromium's web security fully active in all environments
  - Reference: [Electron Security Best Practices — Do not disable `webSecurity`](https://www.electronjs.org/docs/latest/tutorial/security#6-do-not-disable-websecurity)
- **Broader Origin rewrite** — now covers HTTP requests in addition to WebSocket (`ws://`, `wss://`, `http://`, `https://`). Only activates when the Origin is `null` or `file://` (packaged Electron app)

## 🛠️ Fixes & Improvements

### Cron Monitor
- Disabled/paused cron jobs are now visible in the dashboard (`includeDisabled: true`)

### Full Analytics — Major Overhaul
- **`Promise.allSettled`** — partial data still renders if one API call fails
- **Tiered fetching** — starts with 30 days, loads 90 → 365 days on demand
- **Preset workflow redesigned** — clicking a preset is temporary; the Apply button persists your selection
- **localStorage key versioned** (`savedPreset` v2) — prevents stale values from previous versions forcing "All Time" on load
- **Cache bug fixed** — timestamp field was incorrectly named `.ts` instead of `.timestamp`
- **"This Month" preset** — now includes day 31 (was capped at 30)
- **"All Time" mode** — uses server-side totals directly, removing the `hasAllData` dependency

### Chat
- **User messages restored in history** — the noise filter was incorrectly hiding user messages that contained Desktop-injected metadata. Now only filters assistant messages
- **Metadata stripping** — `[AEGIS_DESKTOP_CONTEXT]` blocks, `Conversation info` JSON, and UTC timestamps are cleaned from user messages for a tidy chat view

### Code Quality
- Removed duplicate `call()` method in gateway client
- All version references unified (TitleBar, Settings, gateway userAgent, Electron main/preload)

---

## 📦 Download

| File | Description |
|------|-------------|
| `AEGIS-Desktop-Setup-5.2.0.exe` | Windows installer (NSIS) |
| `AEGIS-Desktop-5.2.0.exe` | Portable — no installation needed |

### Requirements
- Windows 10/11
- [OpenClaw](https://github.com/openclaw/openclaw) v2026.2.19 or later

---

**Full Changelog**: [`v5.1.0...v5.2.0`](../../compare/v5.1.0...v5.2.0)
