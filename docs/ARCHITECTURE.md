# Architecture

## Processes

```
 Lair (your browser)     ──HTTP+SSE──▶  aeryxd (daemon, 127.0.0.1:23799)
                                          │  stores: data/*.db (workflows, agents, hoard, …)
                                          │  supervises, restarts with backoff
                                          ├──stdin/stdout JSON──▶  brain  (Claude Agent SDK session; writes data/aeryx.db, the audit chain)
                                          │                           every tool call → canUseTool → classify()
                                          └──stdin/stdout JSON──▶  voice  (Windows: mic, wake word, whisper)
```

- **The daemon** (`src/daemon/aeryxd.ts`) owns every store except `data/aeryx.db`
  (the audit chain and conversation log, which only the brain writes; the daemon
  reads it read-only), plus the HTTP API, the scheduler, news and the notices
  that tell you something is waiting. It never runs a model itself.
- **The brain** (`src/brain/brain.ts`) is one long-lived Agent SDK session,
  pointed at the provider you chose (`src/brain/providers.ts`). It keeps the
  hash-linked audit log, and every tool call passes `canUseTool`.
- **The Lair** (`lair/`) is a static Next.js export served by the daemon. It
  holds no state of its own.

## The Chain

`src/chain/gateway.ts` → `classify(tool, input, guardrails, state)` returns a
lane and a risk class:

| Class | Meaning | Example |
|---|---|---|
| 0 | read | `Read`, `Grep` |
| 1 | ordinary work, runs | a shell command in the workspace, a proposal |
| 2 | asks you | writes outside the workspace, outward tools, anything after taint |
| 3 | changes Aeryx himself; asks, plus a second factor | editing `src/`, `guardrails.json`, `skills/`; running `aeryx update`/`uninstall` or setting `AERYX_*` overrides |

After classification:

- **The ladder** (`src/chain/ladder.ts`) can stop asking about a Class-2 lane
  after repeated yeses in one session. A standing grant needs your explicit
  yes. Some lanes (`neverPromote`) never climb.
- **Scopes** let an approved, active workflow act unattended in the lanes you
  named. The lanes in `NEVER_SCOPABLE`, and any tainted lane, can never be
  covered.
- **The audit** (`src/chain/audit.ts`) hash-links every row and anchors the
  head outside the database. Grants are replayed from it at every start, so a
  broken chain voids every grant.

## Model providers

Every provider drives the same SDK session, so the Chain is the same whatever
the model. A provider only sets where Messages API requests go and which key
they carry. Keys are held by `src/daemon/secretstore.ts` (Keychain on macOS,
DPAPI on Windows, a 0600 file on Linux) and handed to
the brain over its stdin at boot. Every SDK session runs with the SDK's
telemetry, error reporting and other non-essential traffic switched off
(`PRIVACY_ENV`), so the provider you chose is the only place your asks go.

## State

| Path | What |
|---|---|
| `data/aeryx.db` | the audit chain |
| `data/*.db` | workflows, agents, hoard notices, MCP servers |
| `backups/` | verified daily snapshots and the chain anchor |
| `memory/` | persona (tracked), plus what Aeryx learns about you (local, never committed) |
| `aeryx.config.json` | your switches (local, `0600`, never committed) |
| `secrets/` | Windows/Linux key files (local, never committed) |

## In progress

These exist and are being hardened. They'll ship in a later release:

- **Advanced reflexes:** a faster brain layer that answers the obvious
  instantly and gets quicker the more you use it.
- **Self-growth:** proposing changes to its own code and learning new skills,
  landed only on your approval.
- **Talons:** hands on the screen.
