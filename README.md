# sudo-city

Turn a codebase into an isometric city, then run it as the mayor: type a
command, a Claude agent crew picks it up, and the city reacts live — cranes
rise over files being edited, buildings grow with the code, and a quest log
tracks what the crew is doing.

- **Districts** are directories, sized by a treemap over lines of code.
- **Buildings** are files, colored by language.
- **Streets and traffic** are derived from import edges between files.
- **The crew** is one or more Claude Agent SDK sessions, driven by mayor
  commands typed in the HUD.

## How it works

| Package | Responsibility |
| --- | --- |
| `packages/worldgen` | Scans a repository (files, imports, external deps, git churn) into a `WorldMap`. |
| `packages/layout` | Turns a `WorldMap` into a laid-out `WorldSnapshot` (treemap districts, plots, streets). |
| `packages/world` | Persists world state to SQLite (`.sudocity/world.db` in the target repo). |
| `packages/agent` | Wraps `@anthropic-ai/claude-agent-sdk` sessions and turns SDK messages into `GameEvent`s. |
| `packages/protocol` | Shared zod schemas/types for world state, game events, and mayor commands. |
| `apps/server` | Fastify + WebSocket server: scans the repo, serves world snapshots, relays mayor commands to the agent, streams events. |
| `apps/web` | Vite + React + Phaser client: renders the isometric city and the mayor HUD (chat, quest log, HUD stats). |
| `apps/cli` | `sudo-city <path>` — boots the server and web app together against a target repository and opens the browser. |

## Requirements

- Node.js >= 22.5.0
- pnpm 11.10.0 (see `packageManager` in `package.json`)
- Claude access: either `ANTHROPIC_API_KEY` in your environment (or a `.env`
  file in the repository you point sudo-city at) or an existing local Claude
  Code login, which the agent falls back to.

## Getting started

```bash
pnpm install

# run the server + web app against the current repo
pnpm dev

# or point it at any repository via the CLI
pnpm --filter @sudo-city/cli start -- ../some-other-repo
```

The web app defaults to `http://127.0.0.1:5173` and connects to the server's
WebSocket at `ws://127.0.0.1:4100/ws` (override with `VITE_WS_URL`). The
server listens on `HOST`/`PORT` (defaults `127.0.0.1:4100`) and reads the
target repository from `SUDO_CITY_REPO` (defaults to the current working
directory).

## Development

```bash
pnpm build       # build all workspace packages/apps
pnpm typecheck   # typecheck all workspace packages/apps
pnpm test        # run vitest in every package that has tests
```

Each package/app also exposes its own `build`, `dev`, `test`, and
`typecheck` scripts if you want to run one in isolation, e.g.
`pnpm --filter @sudo-city/web test`.

## Project layout

```
apps/
  cli/      sudo-city CLI: boots server + web, opens the browser
  server/   Fastify/WebSocket server: scan, snapshot, agent relay
  web/      Vite/React/Phaser isometric city client
packages/
  agent/    Claude Agent SDK session wrapper
  layout/   Treemap/plot layout for the world map
  protocol/ Shared zod schemas and types
  world/    SQLite-backed world state persistence
  worldgen/ Repository scanner (files, imports, deps, churn)
fixtures/
  repos/    Sample repositories used for local testing
```
