# Deploying the Claude City backend to AWS

A runbook for the Fastify/WebSocket server. The web app stays on Vercel and
Postgres stays on Supabase. For why it is shaped this way, and the plan for
isolating agent execution, see [aws-architecture.md](aws-architecture.md).

The server already runs on an EC2 box: `deploy-aws.yml` SSHes in as
`AWS_USER@AWS_HOST`, pulls `main`, and restarts `sudo-city.service`. Steps 1–6
are how that box is built — follow them to rebuild it, to stand up a second
environment, or to check the running one against what it should be. The GitHub
section then replaces the SSH deploy with OIDC + SSM, which removes the
long-lived private key and keeps working when the ASG replaces the instance.

| Piece | Where it lives | Changes? |
| --- | --- | --- |
| `apps/web` | Vercel | No — two env vars repointed |
| Postgres | Supabase | No |
| `apps/server` | AWS: ALB → EC2 in an ASG | The box the runbook builds |
| Deploy transport | GitHub Actions → SSM | Replaces SSH, see below |
| Repo clones, `.sudocity/world.db` | EBS on the instance | Rebuildable cache, not backed up |

Why the server can't be serverless or load-balanced normally: every open
workspace is in-process memory holding a git clone, a live SQLite handle, and
Claude Agent SDK subprocesses, and each browser holds a long-lived WebSocket to
the instance that owns its workspace. So it is one stateful box (or a few with
sticky sessions), not a stateless fleet.

---

## Before you start

Generate two secrets and keep them somewhere safe:

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
```

`TOKEN_ENCRYPTION_KEY` decrypts the GitHub tokens on every session row. Lose it
and everyone is signed out; leak it next to a Supabase dump and the encryption
was pointless. Do not store it in the same place as `DATABASE_URL`.

Decide two numbers: `SUDO_CITY_MAX_BUDGET_USD` (the shared ceiling that funds
the whole server) and `SUDO_CITY_USER_MAX_BUDGET_USD` (per signed-in user,
default 10).

---

## Step 1 — Put the secrets in SSM Parameter Store

Pick a region close to your Supabase project. Everything below assumes that
same region.

```bash
for name in ANTHROPIC_API_KEY GITHUB_CLIENT_SECRET SESSION_SECRET TOKEN_ENCRYPTION_KEY DATABASE_URL; do
  aws ssm put-parameter --name "/claude-city/$name" --type SecureString --value "REPLACE_ME" --overwrite
done
```

Use Supabase's **Session pooler** connection string (port 6543) for
`DATABASE_URL`, not the direct connection — this is a long-running server.

## Step 2 — Launch the instance

- AMI: Amazon Linux 2023 (arm64), instance type `m7g.2xlarge` (8 vCPU / 32 GB).
- Root volume 30 GB gp3, plus a second 200 GB gp3 volume mounted at
  `/var/lib/sudocity` for clones.
- IAM instance profile with `AmazonSSMManagedInstanceCore` plus
  `ssm:GetParameter*` on `/claude-city/*`. Nothing else.
- Security group: inbound 4100 from the ALB's security group only. No port 22.
- IMDSv2 required, hop limit 1.
- Public subnet with a NAT or an IGW route — the box must reach github.com and
  api.anthropic.com.

On the box: Node ≥ 22.5, `pnpm` 11.10.0, `git`, `gh` (PR cities shell out to
`gh` to list PRs and post reviews), and **`bubblewrap`** — the Agent SDK
needs it to confine a crew's commands on Linux, and `buildSandboxSettings` sets
`failIfUnavailable`, so a missing bubblewrap makes dispatches fail rather than
run unsandboxed under `SUDO_CITY_PUBLIC_DEPLOYMENT`. That makes it a hard
dependency on a public server. Install `socat` alongside it: the SDK's Linux
sandbox uses it for network proxying when `SUDO_CITY_SANDBOX_ALLOWED_DOMAINS`
is set. That second dependency is from the SDK's own requirements, not
something this repo asserts — confirm it against the version you deploy.

```bash
dnf install -y bubblewrap socat
```

Install Node from the official tarball rather than `dnf` — `node:sqlite`, which
the world store uses, needs 22.5 or newer. Install pnpm globally
(`npm install -g pnpm@11.10.0`) rather than via corepack: pnpm gets invoked by
three different users here (you, `sudocity` for the service, `root` for the SSM
deploy), and corepack caches per user.

Clone the repo to `/opt/claude-clan`.

Create a dedicated unprivileged user for the service and give it the clone root
only — the deploy runs as root over SSM, so it never needs to write to the
checkout, and a crew has `Bash`:

```bash
useradd --system --home /var/lib/sudocity sudocity
install -d -o sudocity -g sudocity -m 0750 /var/lib/sudocity/clones
install -d -o sudocity -g sudocity -m 0750 /var/lib/sudocity/cache
```

This is also the seam the sandbox work lands on: stage 2 of the isolation plan
runs one such user per active mayor, with `0700` clone directories, so getting
the service off `root` now is a prerequisite either way.

## Step 3 — systemd unit

`/etc/systemd/system/sudo-city.service`. The `ExecStartPre` pulls secrets at
boot so they never sit in the AMI or the repo.

```ini
[Unit]
Description=Claude City server
After=network-online.target

[Service]
User=sudocity
WorkingDirectory=/opt/claude-clan
EnvironmentFile=/run/sudo-city.env
ExecStartPre=/usr/local/bin/fetch-env.sh
ExecStart=/usr/bin/pnpm --filter @sudo-city/server start
Restart=always
Environment=NODE_OPTIONS=--max-old-space-size=8192
# `start` is `tsx src/index.ts`, and tsx writes a transpile cache. With
# ProtectSystem=strict the checkout is read-only and with ProtectHome=true the
# service user's home is gone, so without somewhere writable to point it the
# service does not start at all. Give it a directory under the one path this
# unit can write.
Environment=XDG_CACHE_HOME=/var/lib/sudocity/cache
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
# Clones and that cache only. The deploy runs as root over SSM, so the service
# user never needs to write to /opt/claude-clan -- and a crew has Bash, so
# anything writable here is writable by someone else's agent.
ReadWritePaths=/var/lib/sudocity

[Install]
WantedBy=multi-user.target
```

`fetch-env.sh` writes `/run/sudo-city.env` from SSM plus the static values:

```bash
HOST=0.0.0.0
PORT=4100
WEB_ORIGIN=https://<your-vercel-domain>
SUDO_CITY_CLONE_ROOT=/var/lib/sudocity/clones
SUDO_CITY_PUBLIC_DEPLOYMENT=1
SUDO_CITY_MAX_BUDGET_USD=<your ceiling>
SUDO_CITY_USER_MAX_BUDGET_USD=10
# Optional. Leave unset until you have watched a real dispatch and know what a
# crew actually reaches for -- setting it wrong denies everything else, which
# breaks any order that installs a dependency or runs a test suite.
# SUDO_CITY_SANDBOX_ALLOWED_DOMAINS=github.com,api.github.com,registry.npmjs.org
GITHUB_CLIENT_ID=<from the GitHub App>
GITHUB_APP_SLUG=<from the GitHub App>
# plus the five SecureStrings from Step 1
```

`HOST=0.0.0.0` matters — the `127.0.0.1` default never passes an ALB health
check. `SUDO_CITY_PUBLIC_DEPLOYMENT=1` is what disables the Opus crew, the
`xhigh`/`max` thinking levels, and orders/permits/PR-travel in the demo city.

## Step 4 — ALB

- Target group on port 4100, health check path `/health`.
- Listener on 443 with an ACM certificate for your API hostname.
- **Idle timeout 3600s.** The default 60s kills WebSockets; there is no
  server-side heartbeat yet.
- Stickiness: enable `lb_cookie`, 8 hours. Harmless at one instance, required
  the moment there are two.
- Put the instance in an ASG with min=max=1 (or 2 for launch) so a failed
  instance is replaced automatically.
- Point your API DNS record at the ALB.

## Step 5 — Update the GitHub App

In the App's settings, set the callback URL to
`https://<your-api-host>/auth/github/callback`.

## Step 6 — Vercel

Set these on the Vercel project and redeploy:

```
VITE_API_URL=https://<your-api-host>
VITE_WS_URL=wss://<your-api-host>/ws
```

`WEB_ORIGIN` on the server must exactly match the Vercel origin, or CORS and
the post-login redirect both break.

---

## GitHub side

### 1. OIDC trust (one-time, in AWS)

Add GitHub as an OIDC identity provider — URL
`https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com` —
then create a role `claude-city-deploy` trusted by it, restricted to this repo:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<owner>/<repo>:ref:refs/heads/main" }
  }
}
```

Permissions on the role: `ssm:SendCommand`, `ssm:GetCommandInvocation`,
`ec2:DescribeInstances`. That is all the deploy needs.

This replaces the SSH key entirely — no inbound port 22, no long-lived private
key in GitHub secrets, and it keeps working when the ASG replaces the instance.

### 2. Repository secrets and variables

Add these (Settings → Secrets and variables → Actions):

| Name | Kind | Value |
| --- | --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | secret | `arn:aws:iam::<account>:role/claude-city-deploy` |
| `AWS_REGION` | variable | your region |
| `API_HEALTH_URL` | variable | `https://<your-api-host>/health` |

Then delete the secrets the SSH deploy used: `AWS_HOST`, `AWS_USER`,
`AWS_SSH_PRIVATE_KEY`, `AWS_KNOWN_HOSTS`. Do that only once an SSM deploy has
gone green — they are the way back if it hasn't.

### 3. Workflow

Replace the deploy job in `.github/workflows/deploy-aws.yml`. The `test` job
and the health-check rollback are carried over from the SSH version — the
transport is the only thing changing:

```yaml
name: Deploy AWS backend

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

concurrency:
  group: deploy-aws-main
  cancel-in-progress: false

jobs:
  test:
    name: Run tests and typechecks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.10.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm test

  deploy:
    needs: test
    name: Deploy backend to AWS
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}

      - name: Deploy via SSM
        shell: bash
        run: |
          set -euo pipefail
          INSTANCE_ID=$(aws ec2 describe-instances \
            --filters "Name=tag:Name,Values=claude-city" "Name=instance-state-name,Values=running" \
            --query 'Reservations[0].Instances[0].InstanceId' --output text)
          test "$INSTANCE_ID" != "None"

          # Built as a file and passed through jq rather than inlined into the
          # --parameters JSON: the rollback needs functions and quoting, and
          # hand-escaping that into a one-line JSON array is how a deploy
          # script silently becomes a different script.
          cat > /tmp/remote-deploy.sh <<'REMOTE'
          set -euo pipefail
          cd /opt/claude-clan
          test -z "$(git status --porcelain -uno)"
          PREVIOUS=$(git rev-parse HEAD)

          build() {
            CI=true pnpm install --frozen-lockfile
            pnpm --filter "@sudo-city/server..." build
          }
          healthy() {
            for _ in $(seq 1 60); do
              curl -fsS --max-time 5 http://127.0.0.1:4100/health >/dev/null && return 0
              sleep 2
            done
            return 1
          }

          git fetch origin main
          git checkout main
          git merge --ff-only origin/main
          build
          systemctl restart sudo-city.service

          if ! healthy; then
            echo "Health check failed; rolling back to $PREVIOUS"
            git reset --hard "$PREVIOUS"
            build
            systemctl restart sudo-city.service
            healthy || echo "Rollback did not come up healthy either"
            exit 1
          fi

          systemctl is-active --quiet sudo-city.service
          printf '\nDeployed commit: '
          git rev-parse --short HEAD
          REMOTE

          COMMAND_ID=$(aws ssm send-command \
            --instance-ids "$INSTANCE_ID" \
            --document-name AWS-RunShellScript \
            --comment "Deploy ${GITHUB_SHA::7}" \
            --parameters "$(jq -n --rawfile script /tmp/remote-deploy.sh '{commands: [$script]}')" \
            --query 'Command.CommandId' --output text)

          aws ssm wait command-executed --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" || true
          aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
            --query 'StandardOutputContent' --output text
          STATUS=$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
            --query 'Status' --output text)
          test "$STATUS" = "Success"

      - name: Verify public API
        run: curl --fail --show-error --silent --max-time 20 "${{ vars.API_HEALTH_URL }}"
```

SSM runs the script as `root`, so unlike the SSH version there is no `sudo -n`
in front of `systemctl` — and the service user never needs write access to the
checkout, which is what lets Step 2 keep `/opt/claude-clan` out of a crew's
reach.

Vercel deploys the web app on its own push trigger, so there is no web step
here.

Two things this deliberately does not do. It does not drain in-flight agent
runs — a deploy kills running crews, so ship off-peak until that exists. And
with more than one instance it deploys to the first one it finds; extend the
query to loop over instances and take them out of the target group one at a
time.

---

## Verify

1. `curl https://<your-api-host>/health`
2. Load the Vercel site signed out: the demo city renders; clicking Dispatch
   opens the sign-in modal rather than doing nothing.
3. Sign in with GitHub, import a repo, dispatch one small order in `ASK MAYOR`
   mode — this proves the permit round-trip survives the ALB.
4. Check the crew picker shows Architect and the `Extra high`/`Max` levels
   greyed out.
5. Confirm the run's cost landed: `select * from user_spend;` in Supabase.
6. Confirm the sandbox is real, not silently degraded. In an order, ask the
   crew to run `ls /` and `cat /etc/hostname` via Bash and stamp the permit:
   under a working sandbox it sees a confined filesystem, not the host's. If
   dispatches fail outright instead, `bubblewrap` is missing — that is the
   fail-closed behaviour working, and the fix is Step 2.

---

## Still outstanding in the code

Not blockers for a first deploy, but each is a real gap:

- The shared ceiling is an in-memory per-process sum — it resets on restart and
  each instance would enforce a private copy. The per-user cap is durable; this
  one is not.
- No per-run cap: a single order can still draw the entire remaining ceiling.
  One `Math.min` at the `setMaxBudgetUsd` call site.
- No concurrency limit on agent runs, so a launch spike hits the Anthropic org
  rate limits as a thundering herd.
- No WebSocket heartbeat — the 3600s ALB idle timeout is the stopgap.
- No deploy drain, per above.
- Agent commands are now confined by the SDK's sandbox on a public deployment,
  but the agent still runs inside the server process, so the boundary is the
  sandbox rather than the process. Verify it on the host (step 6 above) rather
  than assuming; the stronger split is in
  [aws-architecture.md](aws-architecture.md#stages).
- Sandbox network egress is unrestricted until you set
  `SUDO_CITY_SANDBOX_ALLOWED_DOMAINS`, so a crew can still reach the internet
  from inside its confinement.

## What changes when sandboxes land

Nothing in Steps 1–6. The isolation work splits the server process into a
gateway and per-user sandboxes on the same instance
([aws-architecture.md](aws-architecture.md)), which keeps the same ALB, the
same target group, the same health check, and the same SSM deploy. What it adds
later is a container runtime on the box (stage 3) and, if you go that far,
Fargate task definitions instead of local containers (stage 5). Build this
runbook now; it survives.

## Sizing

Unverified — nothing here was benchmarked. Before trusting `m7g.2xlarge` or the
`GLOBAL_WORKSPACE_CAP = 80` / `PER_USER_WORKSPACE_CAP = 4` limits, measure RSS
per idle workspace, RSS and CPU per active agent run, and disk per clone. Also
measure the median cost of one dispatch at Sonnet/`MEDIUM` — the per-user cap
should be set from that number rather than guessed.
