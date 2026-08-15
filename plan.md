# Drop-a-folder: a third way into Claude City

## Context

Today there are exactly two ways in, both offered as dialogue choices by the
Architect on `LoginScreen.tsx`: **Connect my GitHub** (OAuth → clone → city) and
**See the demo city** (the repo the server itself runs from). Anyone who wants to
look at a repo that isn't on GitHub, or who doesn't want to grant a GitHub App
access just to try the thing, has no route at all.

This adds a third: **drop a folder**. It behaves differently by deployment mode,
because the two modes have genuinely different capabilities:

- **local** — the server is on the user's own machine, so the city should point
  straight at their real directory. The agent then edits the actual repo.
- **hosted** — the browser filters the folder and uploads what survives. The
  code is scratch: it lives only for the visit and is deleted the moment the
  visitor leaves.

Both are capped at **150 MB after filtering**, and that cap is extended to the
existing GitHub import, which currently has no size limit at all — only a
5-minute clone timeout.

Decisions taken with the user, recorded here because they shape the design:

| Decision | Choice |
| --- | --- |
| How local mode gets an absolute path | Native OS folder dialog, opened by the local server; paste-a-path fallback |
| `git init` on uploaded folders | **No** — they're deleted on reload anyway |
| Who may upload in production | Anyone, no sign-in |
| Where the drop zone lives | Login choice + whole-window drop target + airport board |

### The one hard constraint

**A browser cannot give you the absolute path of a dropped folder.** Not
`File.path` (Electron-only), not `webkitRelativePath` (relative), not
`webkitGetAsEntry().fullPath` (a virtual root, `/my-app/src/index.ts`), not a
`FileSystemDirectoryHandle` (`.name` only), not `text/uri-list` (stripped for
local files). This is a deliberate security boundary.

The local server has no such restriction, so local mode asks the *OS* instead of
the browser. This is why local mode's drop zone offers **Browse…** and a path
field rather than pretending the drag alone is enough.

---

## Deployment mode

There is no `NODE_ENV` branch anywhere in this codebase today; mode is inferred
from which env vars are present (`secureCookies = webOrigin.startsWith("https://")`
is the existing pattern, `auth-context.ts:20`). Make it explicit.

**`apps/server/src/index.ts`** — add:

```ts
// Explicit rather than inferred: the local-only routes below hand out a native
// file dialog and open arbitrary filesystem paths as cities. Deriving that from
// "is WEB_ORIGIN https" would turn one misconfigured env var into a directory
// -traversal hole on a public server, so it must be opted into by name.
const mode: DeployMode = process.env.SUDO_CITY_MODE === "local" ? "local" : "hosted";
```

Defaulting to `hosted` is the safe direction — a forgotten var costs a local
convenience, never a production hole. `apps/cli/src/index.ts` sets
`SUDO_CITY_MODE: "local"` in `childEnvironment` alongside the existing
`SUDO_CITY_REPO`, so `pnpm dev`/the CLI get local mode for free.

The web app must not learn this at build time — Vercel bakes `VITE_*` into a
static bundle, and the mode is a property of the server it's talking to. Add:

```
GET /api/config → { mode: "local" | "hosted", maxUploadBytes: number }
```

registered unconditionally (it must work with zero credentials, like `/health`).
`Root.tsx` fetches it alongside `fetchSession()` on mount, before `sessionChecked`
flips.

New env vars for `.env.example` and the README table (`README.md:118-130`):

```
SUDO_CITY_MODE=local            # local | hosted (default hosted)
SUDO_CITY_UPLOAD_ROOT=          # defaults to <tmpdir>/sudocity-uploads
```

---

## Shared filtering rules — `packages/protocol/src/upload.ts`

CLAUDE.md is explicit that anything two consumers must agree on lives in
`protocol` and never as a copy on each side. The browser decides what to send and
the server decides what to accept; if those disagree, either junk lands on disk or
a legitimate file is silently dropped. One module, imported by both.

```ts
export const UPLOAD_MAX_BYTES = 150 * 1024 * 1024;
export const UPLOAD_MAX_FILES = 20_000;
export const UPLOAD_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const UPLOAD_BATCH_BYTES = 6 * 1024 * 1024;
```

### `ALWAYS_IGNORED`

A default-deny list applied **before and regardless of `.gitignore`** — this is
the user's explicit requirement that `node_modules` never uploads even in a repo
that forgot to ignore it. Grouped by ecosystem, one comment per group naming what
it keeps out:

- **Everything** — `.git/`, `.hg/`, `.svn/`, `.sudocity/`, `.DS_Store`,
  `Thumbs.db`, `*.log`, `.env*` (secrets — never leave the user's machine)
- **JS/TS** — `node_modules/`, `bower_components/`, `.pnpm-store/`, `.yarn/cache/`,
  `dist/`, `build/`, `out/`, `.next/`, `.nuxt/`, `.svelte-kit/`, `.astro/`,
  `.angular/`, `.output/`, `.turbo/`, `.parcel-cache/`, `.vite/`, `.cache/`,
  `coverage/`
- **Python** — `venv/`, `.venv/`, `__pycache__/`, `*.pyc`, `*.egg-info/`,
  `site-packages/`, `.tox/`, `.mypy_cache/`, `.pytest_cache/`, `.ruff_cache/`
- **Rust / Go / JVM** — `target/`, `vendor/`, `.gradle/`, `*.class`, `*.jar`
- **Ruby / PHP / .NET** — `.bundle/`, `vendor/bundle/`, `bin/`, `obj/`
- **Apple / mobile** — `.build/`, `DerivedData/`, `Pods/`, `Carthage/`,
  `.dart_tool/`, `.pub-cache/`
- **Other** — `_build/`, `deps/` (Elixir), `Library/`, `Temp/` (Unity),
  `.terraform/`, `.serverless/`
- **Bulk binaries** — `*.zip *.tar *.gz *.7z *.rar *.dmg *.iso *.mp4 *.mov
  *.avi *.mp3 *.wav *.psd *.sketch *.sqlite *.db`

> Worth stating plainly: `dist/`, `build/`, `target/`, `vendor/` and `bin/` are
> occasionally real source directories. Excluding them is the same bet every
> deploy tool makes, and the UI shows a skipped-file count so the loss is never
> silent. This is a knob to revisit, not a law.

### The matcher

```ts
export function createUploadFilter(): {
  addGitignore(dirRelPath: string, contents: string): void;
  shouldSkip(relPath: string, isDirectory: boolean): boolean;
};
```

Built on the `ignore` package, already a `worldgen` dependency and browser-safe
(add it to `protocol`'s deps). Two layers, checked in order:

1. `ALWAYS_IGNORED` — wins unconditionally, so a repo's `!node_modules` negation
   cannot re-admit it.
2. Per-directory `.gitignore`s, scoped to their own subtree. This is *better*
   than worldgen's `walkFallback`, which reads only the root `.gitignore`.

Directories are tested with a trailing `/`, matching `walkFallback`'s existing
convention (`packages/worldgen/src/index.ts:282`).

### `sanitiseUploadPath(rel): string | undefined`

Rejects absolute paths, `..` segments, backslashes, NUL and control characters,
and Windows reserved names. Used on **both** sides — the client to avoid sending
nonsense, the server because a client is not a trust boundary.

---

## Hosted mode: the upload

### Transport

Batched, not one giant POST. Three reasons: production traffic reaches the API
through a Vercel rewrite whose body limit is not something to bet 150 MB on; a
single request gives no progress to animate; and one dropped connection at 140 MB
should not restart the whole thing.

```
POST /api/uploads              → { uploadId }        (uploadId is the bearer secret)
POST /api/uploads/:id/files    → multipart, ≤ 6 MB per request, 3 in flight
POST /api/uploads/:id/finalise → { repoKey: "upload:<id>", name }
POST /api/uploads/:id/discard  → 204   (also sent via navigator.sendBeacon)
```

Needs `@fastify/multipart` — the only new server dependency. The `uploadId` is
32 bytes of `randomBytes`, held **in memory only** on the client. Not
localStorage, not sessionStorage: a refresh must genuinely lose the city, which
is precisely the semantics the user asked to warn about.

### `apps/server/src/upload-store.ts`

Deliberately **no Postgres row** — "delete the code and any metadata" then reduces
to `rm -rf` plus a `Map.delete`, with nothing to leak or forget.

```ts
interface PendingUpload {
  dir: string;        // <uploadRoot>/<uploadId>
  rootName: string;   // sanitised folder name — the city's name comes from this
  bytes: number; files: number;
  createdAt: number; lastSeenAt: number;
  finalised: boolean;
}
```

Files land at `<uploadRoot>/<uploadId>/<rootName>/<relPath>`. Nesting the folder
name one level down is what makes the city name work for free: `Workspace`'s
`repoPath` ends in the folder name, and `cityNameFromRepo`
(`apps/web/src/lib/app-utils.ts:62`) already titles the last path segment. No new
naming plumbing on the happy path.

Server-side validation on every part, because the client is untrusted:

- `sanitiseUploadPath`, then `resolve()` and assert the result is still under
  `dir` — belt and braces against traversal
- re-apply `ALWAYS_IGNORED` (a hand-rolled POST cannot smuggle `node_modules` in)
- running byte and file counters checked **mid-stream**, aborting the request and
  deleting the whole upload the moment either cap is crossed, so a lying
  `Content-Length` cannot fill the disk

### Deletion — four independent paths

The user's requirement is that leaving deletes everything. One mechanism is not
enough, because "leaving" has several shapes:

1. **`discard` beacon** on `pagehide` — the common case, closing the tab.
2. **WS close** — `socket.once("close")` in `index.ts:211` already removes the
   client. Extend it: if the closing socket was the last one whose
   `workspaceKey` is `upload:<id>`, schedule deletion after a **60 s grace**
   (a reconnect is a normal event — `use-game-state.ts` backs off 1 s → 15 s —
   and must not destroy the city underneath itself).
3. **Idle sweep** — a 30-minute `lastSeenAt` TTL, catching uploads abandoned
   before finalise and any beacon that never arrived.
4. **Process shutdown** — the existing `app.addHook("onClose")` (`index.ts:166`)
   gains an `uploads.disposeAll()`.

Deletion is `workspace.dispose()` then `rm(dir, { recursive: true, force: true })`.
`.sudocity/world.db` lives inside `dir`, so it goes with it.

### No `git init`

Per the user's decision. This is safe and already handled:

- `worldgen`'s `listRepositoryFiles` fails on `git ls-files` and falls through to
  `walkFallback` (`packages/worldgen/src/index.ts:240`) — and the tree is already
  filtered, so the root-only `.gitignore` limitation costs nothing.
- `readRevision` returns `"working-tree"`, `readChurn` returns empty — both
  already have `catch` fallbacks.
- `refreshRoster` catches everything and logs *"only the main city is
  available"* (`workspace.ts:475`), so PR and issue cities are simply absent
  rather than broken. `pruneWorktrees` is `.catch()`ed at `workspace.ts:535`.

Verify these degrade cleanly rather than assuming — a `Workspace.open` on a
git-less directory is the single riskiest untested path in this plan.

---

## Local mode: the real directory

Registered **only when `mode === "local"`**, in `apps/server/src/routes/local.ts`:

```
POST /api/local/pick  → { path, name } | { unavailable: true }
POST /api/local/open  → { path } → { repoKey: "local:<hash>", name }
```

`pick` shells out to the OS folder dialog:

| Platform | Command |
| --- | --- |
| darwin | `osascript -e 'POSIX path of (choose folder with prompt "…")'` |
| linux | `zenity --file-selection --directory` |
| win32 | PowerShell `FolderBrowserDialog` |

A non-zero exit means cancelled or no GUI (SSH, headless) — return
`{ unavailable: true }` and let the UI fall back to the paste field. Give it a
90 s timeout with `GIT_TERMINAL_PROMPT`-style hardening in spirit: a dialog
nobody answers must not hang a request forever, the same lesson `clone.ts:42`
records.

`open` validates the path is an existing directory, resolves it, and calls
`workspaces.openLocal(path)`. **No path allowlist** — local mode is the user's own
machine and the whole point is opening their own directories; the protection is
that these routes do not exist in hosted mode at all.

Local workspaces are *not* deleted on exit — they're the user's real files. Only
the LRU eviction in `workspaces.ts` applies, and `evict()` must **skip the
`rm -rf`** for local workspaces. Getting this wrong deletes a user's repo, so it
deserves a test and a comment naming that consequence.

---

## Workspace keys

`WorkspaceManager` gains `openUpload(uploadId, dir)` and `openLocal(path)`,
returning keys `upload:<id>` and `local:<sha256(path).slice(0,16)>`. Both reuse
the existing `pendingOpens` dedup and `buildWorkspace`.

`repo.select` in `apps/server/src/index.ts:278` gains two branches ahead of the
GitHub one. Neither needs `session.auth`: possession of the unguessable
`uploadId` *is* the authorisation for an upload, and local mode is single-user by
definition.

`writeStoredActiveRepo` (`apps/web/src/auth/gate.ts`) must **refuse** to persist
an `upload:` key. Restoring a deleted city on the next visit would show a broken
world; and it is the whole point that a refresh loses it.

---

## 150 MB on the GitHub import too

GitHub's repo list already returns `size` (KB, of the packed repo). Thread it
through:

1. `packages/cities/src/index.ts` — `accessibleRepos` keeps `size`.
2. `packages/protocol/src/index.ts:131` — `RepoSummarySchema` gains
   `sizeKb: z.number().int().nonnegative().optional()`. Optional, because a
   persisted-but-unrefreshed summary must not fail validation.
3. `apps/server/src/routes/repos.ts` — `POST /api/repos/import` rejects oversize
   repos with **413** and the copy *"Sorry, we only support repos up to 150 MB."*
   Check this **before** `openUserRepo`, so an oversize repo never starts a
   multi-minute clone.
4. `RepoPicker.tsx` — an oversize row renders disabled with `TOO LARGE / 150MB
   MAX` in place of `IMPORT & BOARD`, in both the boxed and airport skins.

> Note in a comment: GitHub's `size` is the packed `.git` size, which is not the
> same as a checkout. It is an approximation deliberately chosen over cloning
> first and measuring — it is the only number available before paying the clone.

The limit is stated in the UI where it can actually be read, not only in an error:
under the drop zone (*"up to 150 MB after we strip dependencies and build
output"*) and in the airport board's description line.

---

## Web

### Traversal — `apps/web/src/upload/walk.ts`

`DataTransferItem.webkitGetAsEntry()` recursion (Chrome, Firefox and Safari all
support it; `showDirectoryPicker` is Chromium-only and buys nothing here). The
critical property: **prune before descending.** A `node_modules` with 40 000 files
must never be enumerated, only skipped — enumerating it is most of the wall-clock
cost of a naive implementation, and `<input webkitdirectory>` gives no way to
avoid it. That input remains as the click-to-choose fallback.

Reads `.gitignore` at each directory level as it descends, feeding
`createUploadFilter().addGitignore()`.

Returns `{ rootName, files: {path, file}[], totalBytes, skippedFiles, skippedBytes }`,
so the ceremony can show *what* was left behind, not just a bar.

### Client — `apps/web/src/upload/client.ts`

Batches into ≤ 6 MB requests, 3 concurrent, `onProgress(sentBytes, totalBytes)`.
Registers the `pagehide` beacon. Files over `UPLOAD_MAX_FILE_BYTES` are skipped
and counted, not failed — one stray 40 MB asset should not block a repo.

### Unload guard — `apps/web/src/upload/use-unload-guard.ts`

There is no `beforeunload` anywhere in the codebase today; this is the first.
Active while an upload is in flight **or** an upload city is on screen:

```ts
event.preventDefault();
event.returnValue = "";   // browsers show their own copy; ours is ignored
```

Because the browser's dialog cannot be styled or worded, the *real* warning is
in-app and always visible: a persistent amber HUD strip reading
**`TEMPORARY CITY · CLOSING OR RELOADING DELETES THIS UPLOAD`**, plus a confirm
step on the in-app exits (logout, sign-in, airport departure) that a
`beforeunload` never sees.

### The ceremony — `apps/web/src/upload/UploadCeremony.tsx`

The aesthetic is fixed and specific: Space Mono at 7–10 px via `.retro`, amber
(`--primary`, `oklch(0.79 0.16 74)`) on deep blue-black, square corners
(`--radius: 0rem`), scanlines, and an airport metaphor already carrying the
repo-switch flow. The drop should read as **an airlift arriving at the terminal**,
not as a generic progress bar — a cargo manifest being surveyed, loaded and
cleared for construction.

Four stages, each with its own line in a departures-board-style manifest:

```
┌ CCX · LOCAL CARGO TERMINAL ─────────────────────┐
│                                                 │
│   ▸ SURVEY     1 284 files · 41.2 MB            │
│   ▸ MANIFEST   9 331 skipped · node_modules ✕   │
│   ▸ AIRLIFT    ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░  62%        │
│   ▸ GROUNDWORK laying districts…                │
│                                                 │
│   ████ ████ ████ ████ ████ ████ ████            │  ← airport-runway-bar
└─────────────────────────────────────────────────┘
```

- **SURVEY** — traversal. A live file counter climbing; `hud-sweep` (the existing
  1.4 s scanline in `styles.css`) runs under the row.
- **MANIFEST** — the filter's verdict. Skipped groups tick past as pixel "crates"
  stamped and set aside: `node_modules ✕  dist ✕  .venv ✕`. This is the moment
  that earns trust, so it is shown rather than summarised.
- **AIRLIFT** — the byte bar, driven by real `onProgress`. Reuse
  `airport-import-sweep` (1.8 s diagonal shimmer) on the active row and
  `.airport-runway-bar`'s marker lights, sequencing them as the bar advances.
- **GROUNDWORK** — server-side scan and layout, driven by the existing
  `repo.status` message, which **already carries `percent`**
  (`packages/protocol/src/index.ts:341`). Add `"uploading"` to
  `RepoStatusPhaseSchema`.

Then hand off to the transition that already exists: set `activeRepoKey`, let
`login-transition-cover--exiting` fade over 700 ms while the Phaser world runs its
staged reveal. **Do not build a second reveal.** New CSS goes in `styles.css`
beside the existing `login-*` and `airport-*` blocks, using
`--hud-ease`/`--hud-edge`/`--hud-shade`, every animation guarded by
`prefers-reduced-motion` as all the others are.

### Entry points (all three)

1. **Login screen third choice** — `> Drop in a folder` as a third
   `login-screen__choice` in the Architect's dialogue, opening the full-screen
   drop surface.
2. **Whole-window drop target** — a `dragenter`/`dragover`/`dragleave` listener on
   the login stage lighting up a full-window overlay. Track a counter, not a
   boolean: `dragleave` fires on every child crossing and a naive flag flickers
   the overlay on every mouse move.
3. **Airport board** — a `CHARTER FLIGHT · LOCAL CARGO` panel below the
   destination list in `RepoPicker.tsx`'s dialog skin, so a folder can be dropped
   without leaving the city.

All three funnel into one `<DropSurface>` so the ceremony exists once.

---

## Files

**New**

| Path | Purpose |
| --- | --- |
| `packages/protocol/src/upload.ts` | Caps, `ALWAYS_IGNORED`, `createUploadFilter`, `sanitiseUploadPath` |
| `apps/server/src/upload-store.ts` | In-memory registry, disk writes, the four deletion paths |
| `apps/server/src/routes/uploads.ts` | create / files / finalise / discard |
| `apps/server/src/routes/local.ts` | `pick` + `open`, local mode only |
| `apps/web/src/upload/walk.ts` | Pruning `webkitGetAsEntry` traversal |
| `apps/web/src/upload/client.ts` | Batched upload + beacon |
| `apps/web/src/upload/use-unload-guard.ts` | `beforeunload` + in-app confirms |
| `apps/web/src/upload/DropSurface.tsx` | Drop target, local-mode Browse…/paste |
| `apps/web/src/upload/UploadCeremony.tsx` | The four-stage airlift |

**Modified** — `apps/server/src/index.ts` (mode, `/api/config`, `repo.select`
branches, WS-close deletion, `onClose`), `apps/server/src/workspaces.ts`
(`openUpload`/`openLocal`, no `rm -rf` for local), `apps/server/src/routes/repos.ts`
(413), `packages/protocol/src/index.ts` (`sizeKb`, `"uploading"` phase),
`packages/cities/src/index.ts` (`size`), `apps/web/src/Root.tsx` (config fetch,
upload city state, guard), `apps/web/src/auth/gate.ts` (never persist `upload:`),
`apps/web/src/components/LoginScreen.tsx` (third choice), `RepoPicker.tsx`
(charter panel, oversize rows), `apps/web/src/lib/app-utils.ts` (name for
`upload:`/`local:` keys), `apps/web/src/styles.css`, `apps/cli/src/index.ts`
(`SUDO_CITY_MODE`), `.env.example`, `README.md`.

---

## Verification

`pnpm typecheck && pnpm test` are the only gates — CLAUDE.md is explicit that
there is no linter. Note `apps/web/vitest.config.ts` includes only
`src/**/*.test.ts`, not `.tsx`, and runs in `environment: "node"`; keep the
testable logic out of components accordingly.

**Unit**

- `packages/protocol/test/upload.test.ts` — properties, not tuned numbers, per
  CLAUDE.md: *`node_modules/` is skipped even when `.gitignore` says
  `!node_modules`*; *a nested `.gitignore` only affects its own subtree*; *every
  traversal-escaping path is rejected* (`../`, `/etc/passwd`, `a\\..\\b`, NUL).
- `apps/web/src/upload/walk.test.ts` — fake `FileSystemEntry` tree; assert
  *a pruned directory's `createReader` is never called* (the property that makes
  a 40 000-file `node_modules` free rather than merely filtered).
- `apps/server/test/upload-store.test.ts` — cap enforcement mid-stream; deletion
  removes the directory; the 60 s grace survives a reconnect; **a local
  workspace is never `rm -rf`'d**.

**End to end**, via the `run` skill rather than an invented launch sequence:

1. `SUDO_CITY_MODE=local pnpm dev` → login screen shows the third choice → drop a
   folder → Browse… opens the native dialog → pick this repo → city renders with
   the folder's name.
2. Unset the mode → drop a mid-size repo → watch SURVEY/MANIFEST/AIRLIFT/GROUNDWORK
   → city renders → check `<tmpdir>/sudocity-uploads/<id>` exists → close the tab
   → confirm the directory is gone.
3. Reload mid-city → browser warns → confirm → the city is gone and the disk is
   clean.
4. Drop a folder with a large `node_modules` → confirm the skipped count and that
   the byte total reflects only what shipped.
5. Sign in and confirm an oversize GitHub repo shows `TOO LARGE` and that
   `POST /api/repos/import` returns 413 without starting a clone.

## Out of scope

Resumable uploads across a reload, uploading via a zip, PR/issue cities on upload
folders (no git, by decision), and per-IP rate limiting. Worth noting for later:
anonymous uploads can spend the shared agent budget, which is
`SUDO_CITY_MAX_BUDGET_USD` and currently **$1 globally**.
