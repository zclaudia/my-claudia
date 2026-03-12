# MyClaudia

A cross-platform UI for Code CLI (Claude Code / Cursor / Codex / Gemini), built with Tauri + React.

## Features

- **Multi-Provider Support**: Works with Claude Code, Cursor, Codex, OpenCode, and more
- **Cross-Platform**: Desktop (macOS/Windows/Linux) and mobile web
- **Project Management**: Organize conversations by project
- **Supervision**: AI-powered project orchestration and task management
- **Local-First**: All data stored locally with SQLite

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 8+
- Rust (latest stable)
- For desktop build: Xcode (macOS) or Visual Studio (Windows)

### Development

```bash
# Install dependencies
pnpm install

# Start Tauri dev mode (default)
pnpm dev

# Or start standalone mode (frontend + backend separately)
pnpm --filter @my-claudia/server run dev  # Backend
pnpm --filter @my-claudia/desktop run dev # Frontend
```

### Build

```bash
# Build macOS app
bash scripts/build/macos.sh

# Build Windows app
bash scripts/build/windows.ps1

# Build Linux app
bash scripts/build/linux.sh
```

## Architecture

```
my-claudia/
├── apps/desktop/     # Tauri desktop app (React + TypeScript)
├── server/           # Backend server (Node.js + TypeScript)
├── gateway/          # WebSocket relay for remote access
├── shared/           # Shared types
└── docs/             # Design documents
```

## License

MIT
