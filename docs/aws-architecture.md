# Claude City on AWS — architecture

What runs where, why the backend is stateful, and how agent execution is
isolated. [deploy-aws.md](deploy-aws.md) is the runbook that builds it.

## Topology

```
   browser ──── https ────► Vercel (static bundle)
      │
      └─────── wss ───────► ALB ──► EC2 (Fastify + WebSocket)
                                      │
                                      ├─► Supabase (sessions, spend)
                                      ├─► EBS (clones, world.db)
                                      ├─► github.com (clone, gh)
                                      └─► api.anthropic.com (agent runs)
```

| Layer | Runs on | Holds |
| --- | --- | --- |
| `apps/web` | Vercel | Nothing; static Vite/React/Phaser bundle |
| `apps/server` | AWS: ALB → EC2 in an ASG | All live state |
| Postgres | Supabase | Users, sessions, imported repos, spend ledger |
| Clones, `.sudocity/world.db` | EBS on the instance | Rebuildable cache, not backed up |

## Why the backend is stateful

It cannot be round-robined, because a request routed to the wrong instance
finds no workspace at all:

- Workspace state is in-process memory — `WorkspaceManager`
  ([workspaces.ts](../apps/server/src/workspaces.ts)) holds a `Map` of open
  `Workspace` objects, each owning a clone on local disk, a live SQLite handle,
  and one Agent SDK session per city.
- Clients hold long-lived WebSockets bound to the process owning their
  workspace.
- Postgres holds only sessions, imported-repo records, and spend. It is not a
  source of truth for world state.

So the deployment is one stateful box, or a few behind sticky sessions. Clones
are disposable: `cloneRepo` does `rm -rf` then a shallow clone, and eviction
deletes the directory, so losing an instance costs a re-clone and no data.

## Request paths

| Path | What happens |
| --- | --- |
| Anonymous visit | Socket opens; server sends the crew policy and the demo snapshot. The demo workspace is opened on the first request for it and then cached and never evicted, so every visit after the first costs a socket and a JSON payload. Works with zero credentials configured. |
| Sign-in | `/auth/github/start` → GitHub → `/auth/github/callback`. A session row is created and an opaque bearer token returned in the URL fragment. GitHub access and refresh tokens on that row are encrypted at rest ([token-cipher.ts](../apps/server/src/token-cipher.ts)); the bearer token carries no payload, so refreshing GitHub credentials is an in-place `UPDATE`. |
| Repo import | Shallow-clone → scan into a `WorldMap` → lay out → store the snapshot in SQLite inside the clone. The clone path is recorded in Postgres so a restart reopens from disk instead of re-cloning. |
| Dispatch | `session.prompt` → crew policy check (model, effort, demo city) → budget check → Agent SDK query with `cwd` set to the clone. SDK messages become `GameEvent`s fanned out to every socket on that workspace and city. Non-read-only tools raise `permit.requested` and block until `permit.resolve` returns. |

## Budget

An order is capped by whichever ceiling runs out first.

| Ceiling | Stored | Durable |
| --- | --- | --- |
| `SUDO_CITY_MAX_BUDGET_USD` — shared, funds the server | In-process sum over open workspaces | No — resets on restart, private per instance |
| `SUDO_CITY_USER_MAX_BUDGET_USD` — per signed-in user, default $10 | `user_spend` in Postgres, incremented in SQL | Yes — survives restarts, evictions, multiple instances |

The per-user figure loads into memory when a user's first workspace opens and
writes back after every run, so eviction never hands out a fresh allowance.

## Security model

Everything server-side runs in one process, as one OS user, on one filesystem.

Anonymous versus signed-in is enforced: with `SUDO_CITY_PUBLIC_DEPLOYMENT` set,
the shared demo city refuses orders, permit stamps, and travel to PR or issue
cities, because nobody authenticates to reach it.

Signed-in versus signed-in is enforced by the Agent SDK's sandbox, not by the
operating system. `buildSandboxSettings` ([policy.ts](../apps/server/src/policy.ts))
confines every command a crew runs on a public deployment:

| Control | What it stops |
| --- | --- |
| `denyRead` the clone root, `allowRead` this workspace only | Reading a neighbouring mayor's checkout — clones are siblings under one root |
| `denyRead` the server checkout and `SYSTEM_SECRET_PATHS` (`/run`, `/etc/systemd`, `/root`, …) | Reading the env file systemd wrote, unit files, daemon config |
| `credentials.envVars` deny for `SECRET_ENV_VARS` | `printenv` reaching `ANTHROPIC_API_KEY`, `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET` |
| `failIfUnavailable: true` | The SDK's own default, which warns and runs *unsandboxed* — a control that silently isn't there |

Egress is deny-by-default. `SANDBOX_BASELINE_DOMAINS` — github.com and the
hosts `gh` and `git` reach — is always allowed, because a crew that cannot
clone, push, or call `gh` cannot do the job; `SUDO_CITY_SANDBOX_ALLOWED_DOMAINS`
extends that list for whatever a repo's toolchain needs. The baseline is not a
convenience: an enabled sandbox with no network config resolves to an *empty*
allowlist, not open egress, which silently blocked a crew from pushing a commit
on the deployed server while the same order worked locally, where the sandbox
is off entirely.

What it does not do is separate processes. The agent runs inside the server
process as the server's OS user, so the boundary is the sandbox rather than the
kernel's process and user separation: a sandbox escape is a compromise of every
account, not one. Moving the boundary from a sandbox flag to a process is the
target below.

---

## Target: gateway and per-user sandboxes

The boundary that matters is between users, and `Workspace`
([workspace.ts](../apps/server/src/workspace.ts)) is already that unit — it
owns the clone, the world store, the city registry, and the agent sessions. So
the split runs along the class that already exists.

Isolating per *run* instead would be worse: an agent needs a working tree, so a
per-dispatch sandbox must re-clone each order, mount over EFS, or ship
snapshots — all expensive on the hot path, to separate runs by one user that
never needed separating.

```
        browser
           │ WebSocket (MayorCommand / ServerMessage)
           ▼
    ┌──────────────┐     Supabase (sessions, spend)  ← gateway only
    │   Gateway    │──── Anthropic egress proxy ─────┐
    │ auth, WS,    │                                 │
    │ routing,     │  same protocol, per-user link   │
    │ budget       │─────────┬──────────┬────────────┘
    └──────────────┘         ▼          ▼
                        ┌────────┐  ┌────────┐
                        │sandbox │  │sandbox │   one per active user
                        │ user A │  │ user B │   clone + world.db + agent
                        └────────┘  └────────┘
```

| Module | Lands in |
| --- | --- |
| WS handling and client map (`index.ts`), `auth-context.ts`, `db.ts`, `routes/` | Gateway |
| `workspaces.ts` — becomes a manager of sandboxes | Gateway |
| `workspace.ts`, `clone.ts`, `worldgen`, `layout`, `world`, `cities`, `agent` | Sandbox |
| `protocol` | Both — it becomes the gateway↔sandbox wire format |

`MayorCommand` and `ServerMessage` are already a command/event stream over a
socket, so a sandbox speaks the protocol it implements today and the gateway
becomes an authenticating router: validate session, apply policy and budget,
forward, fan events back. Permits need no redesign — `permit.requested` is
already an event and `permit.resolve` a command; the promise gating
`canUseTool` simply lives in the sandbox.

### Secrets

| Secret | In the sandbox |
| --- | --- |
| `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET` | Never — the gateway owns all persistence |
| The user's GitHub token | Yes — their own sandbox, their own token |
| `ANTHROPIC_API_KEY` | Never |

Giving a sandbox the shared Anthropic key would leave the budget enforced by
code inside the thing being contained. Instead the sandbox's SDK points at an
egress proxy on the gateway (`ANTHROPIC_BASE_URL`) that injects the real key,
refuses requests once a user is over cap, and meters spend from responses
rather than trusting a `session.usage` event the sandbox reported. This depends
on the Agent SDK honouring `ANTHROPIC_BASE_URL` including streaming — verify
that early; the fallback is a short-lived key per sandbox, with the cap back to
advisory and the gateway killing the sandbox to enforce it.

### Lifecycle

Sandboxes start on a user's first `repo.select` — not at login, since most
visitors never dispatch — and stop after an idle period with no running agent
(`hasRunningAgent()` already answers that question for eviction). Existing caps
carry over: `PER_USER_WORKSPACE_CAP` becomes repos per sandbox,
`GLOBAL_WORKSPACE_CAP` becomes concurrent sandboxes.

Teardown must not simply discard the clone. A restart today preserves clones on
disk and reopens them, so a crew's uncommitted edits survive a deploy; only LRU
eviction destroys them, and only under cap pressure. An idle timeout that
`rm -rf`s the tree would turn that rare loss into a routine one — every user
who steps away for an hour comes back to their work gone. Whatever the sandbox
does on stop, the working tree has to outlive it: a per-user cache volume, or
pushing dirty state to a scratch branch before teardown. This is a prerequisite
for stage 2, not a later refinement.

Because sandboxes exist only while someone is working, steady-state cost tracks
active users rather than registered ones.

### Where sandboxes run

| | Containers on the ASG instances | Fargate task per user |
| --- | --- | --- |
| Isolation | Namespaces + cgroups; shared kernel | VM per task |
| IAM | Shared instance role | Task role per sandbox |
| Start latency | ~1s | ~10–30s |
| Ops | Docker on the box | No hosts to manage |

Containers first: they turn the sandbox's read denials into filesystem and
process namespaces, so the confinement no longer depends on one SDK flag being
honoured. Fargate when signed-in users include people you do not know.

### Stages

| # | Stage | Effect |
| --- | --- | --- |
| 1 | `WorkspaceHost` interface between `WorkspaceManager` and `Workspace` | No behaviour change; the only stage touching existing code broadly |
| 2 | Sandbox as a separate process per user, own OS user, `0700` clone dirs | Backs the SDK sandbox's read denials with OS permissions, so an escape lands somewhere with nothing to read |
| 3 | Containerize the sandbox | Adds filesystem and process namespaces |
| 4 | Egress proxy for the Anthropic key | Makes the budget cap authoritative |
| 5 | Fargate | Removes the shared kernel |

Stage 2 carries the security payoff — today's boundary is a sandbox flag
inside the process it contains; 3–5 harden it. Stage 1 precedes all.

### Residual risks

Sandbox escape until stage 2 lands, and kernel escape on the container flavour
after it (Fargate removes that). The gateway becomes
the single trusted component holding every secret — though it does much less
and has no `Bash`. A sandbox can still spend its own user's budget within their
cap, which is intended. Egress is already deny-by-default, but github.com is on
the baseline allowlist and a crew has push rights to its own repo, so it can
still move its own repository's contents to a place its user controls.

## Failure modes

| What fails | Effect |
| --- | --- |
| The instance | Every session drops; clones re-cloned on the replacement. No data lost. |
| Supabase | Login and spend accounting fail; the demo city keeps serving. |
| A deploy | Kills in-flight crews — there is no drain yet. |
| Anthropic rate limit | Dispatches fail; browsing is unaffected. |
| ALB idle timeout too low | Sockets drop and the client reconnects, so it presents as flapping rather than an outage. |

## Scaling axes

| Population | Bounded by | Notes |
| --- | --- | --- |
| Spectators — anonymous, demo city | WebSocket fan-out | Cheapest; one box absorbs a large spike |
| Builders — signed-in, own repo | Instance memory and disk | Bounded by `GLOBAL_WORKSPACE_CAP` and clone size |
| Executors — dispatching a crew | CPU and the Anthropic ceiling | The scarce one, and the reason for the caps |
