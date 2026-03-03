# Contributing to OntoSynth Desktop

Thank you for your interest in contributing! Here's how to get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/openclaw-desktop.git`
3. Install dependencies: `npm install`
4. Start the dev server: `npm run dev`

## Requirements

- Node.js 18+
- A running [OpenClaw](https://github.com/openclaw/openclaw) Gateway instance

## Making Changes

- Create a new branch: `git checkout -b feature/your-feature-name`
- Make your changes
- Test locally with `npm run dev`
- Commit with a clear message (e.g. `feat: add dark mode toggle`)

## Submitting a Pull Request

1. Push your branch to your fork
2. Open a Pull Request against the `master` branch
3. Describe what you changed and why
4. Reference any related issues

## Code Style

- TypeScript for all new code
- Use logical CSS properties (`ms-`, `me-`, `text-start`) — no physical properties
- Theme colors via `themeHex()` / `themeAlpha()` utilities — no hardcoded hex values
- Keep components focused and small

## Reporting Bugs

Open an [issue](../../issues/new?template=bug_report.md) with steps to reproduce.

## Suggesting Features

Open an [issue](../../issues/new?template=feature_request.md) with your idea and use case.
