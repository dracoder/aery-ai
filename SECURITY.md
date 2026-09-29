# Security

Aeryx is an AI agent with real reach into your machine. This page says what the
Chain enforces, what is only convention, and what is still open. Please read it
before you give Aeryx real access.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on
this repository. Don't open a public issue for anything exploitable. Include the
revision, OS, and a reproduction. A failing invariant in
`scripts/test-invariants.mjs` is the best possible report.

## Threat model

Aeryx assumes the **model can be wrong or manipulated**, for example by
injected text on a web page, in a file, in a headline or in audio. It does
not defend against someone who already runs code as your OS user or as an
administrator.

## What is enforced

Every item below is pinned by invariants in `npm run gate`.

- **Classification is total, and there is one allow path, pinned.** Every
  tool call resolves to a risk class. Anything unrecognised asks
  (fail-to-ask), including each MCP tool separately. Exactly one place returns
  `allow`: the brain's `canUseTool`, which cannot run before `classify()`.
  There is no second door to a tool — a workflow runs through the same brain
  session and the same gate. The invariants fail if any other file returns
  `allow`. Sessions that aren't gated have no tools at all.
- **A tamper-evident audit.** Rows are hash-linked. An anchor outside the
  database catches rows removed from either end. A broken chain voids every
  standing grant.
- **Standing autonomy needs an explicit yes.** Class 3 and the lanes marked
  `neverPromote` are never promoted automatically. Standing orders (a
  workflow's scope) take effect only after a local, second-factor approval, and
  only while the workflow is active. Editing a workflow's prompt or scope
  demotes it. No standing order covers a tainted lane.
- **Provenance:**
  - Content from the web, from inbound folders (Downloads, Desktop, temp, and
    Aeryx's own inbound folder) and from `curl`/`git clone` taints the session.
  - After that, the shell, file writes, subagents, further fetches and
    workflow runs all ask.
  - Reading credentials always asks and is never promoted: `~/.ssh`, `~/.aws`,
    `~/.claude`, `.env`, key files, Aeryx's config and secrets.
- **Self-protection:**
  - Aeryx's source, build output, dependencies, config, memory, skills, agents
    and plugin files are Class 3 to write, including through a symlink.
  - This build ships no path by which Aeryx changes his own code. A write to
    any of those paths is an ordinary Class 3 tool call: it asks, it needs the
    second factor at the machine, and it is never promoted to a standing grant.
  - The brain refuses to start a session whose plugin root could load a hook or
    an MCP server outside the Chain.
- **The control plane:**
  - The daemon binds to loopback.
  - Mutating requests must be `application/json`, so a form post from a web
    page can't reach them.
  - Unknown `Host` names and cross-site origins are refused, which blocks DNS
    rebinding.
  - URLs the daemon fetches itself (the news feeds and their pages)
    resolve DNS first, refuse private/loopback/reserved addresses, and
    re-check every redirect hop. The brain's built-in WebFetch runs inside the
    Agent SDK. The Chain classifies it (Class 1, taints the session; later
    fetches ask; refused in local-only mode), but Aeryx does not check the
    address it fetches.
- **Secrets:**
  - Model keys are kept by `src/daemon/secretstore.ts`: the macOS Keychain, a
    Windows DPAPI (CurrentUser) blob under `secrets/`, or a plaintext `0600`
    file under `secrets/` on Linux. Never in `aeryx.config.json`. `secrets/` is
    a selfPaths entry (writes are Class 3 `self.modify`) and a sensitive read
    dir.
  - The daemon's token for the brain travels over stdin, never the environment.
  - Audit rows are redacted for common secret shapes.
- **Fail closed off Windows.** Windows Hello doesn't exist on macOS or Linux,
  so every action that needs the second factor is refused there: Class-3 tool
  calls, standing orders, adding an MCP server and setting the remote PIN.
  `"helloClass3": false` opts into UI-only
  approval for Class-3 tool calls only (the audit row records `:ui-only`). The
  daemon's own second-factor actions stay refused whatever it is set to.

## What is convention, not a boundary

- **Class 1 shell is powerful.** In the default mode (`brain.runAs: "self"`) the
  brain runs as *your* OS user. Nothing at the OS level separates its shell
  from your browser or your files. The Chain decides what runs silently, but
  a Class 1 command that slips past the patterns runs with your full rights.
  The real boundary is `runAs: "warden"` (Windows only), which runs the brain
  as a separate low-privilege account.
- **Pattern lists are heuristics.** The shell's self-modify, credential and
  "dangerous command" checks are regular expressions. Someone who builds a
  path or URL at runtime can get past them.
- **The audit chain is unkeyed.** It is tamper-*evident* against a process that
  can't run as you. The brain can.
- **Model keys are visible to the brain's own process tree.** The SDK needs
  them in its environment, and a Class 1 shell runs inside that tree. Commands
  that dump the environment ask, but see the previous point.
- **DNS can change between the check and the connect** in the fetch guard.

## Known open issues

- **Warden data permissions (Windows).** `scripts/setup-os-boundary.ps1` grants
  the brain account Modify on all of `data\`. That lets a compromised brain
  edit the workflow and agent databases directly and arm a standing order
  without approval. The fix is to split `data\` so the brain can write only its
  own subfolder. It is not done yet because it needs verification on a real
  Windows install.
- **Windows live proofs.** The Windows-specific proofs (Hello, the warden and
  the microphone) have passed in development, but not yet on
  this public release candidate. The CI gate runs on Windows; the live proofs
  need a real desktop session.

- **Port 23799 is trusted by whoever reaches it first.** The Lair and the
  `aeryx` command talk to whatever answers on `127.0.0.1:23799`. On a
  machine shared with other users, another account could start a look-alike
  first and show a fake setup page. Aeryx is designed for a single-user
  machine. A signed handshake with the daemon's session token is planned.
- **Releases are signed; GitHub is still the channel.** Node is checked
  against nodejs.org's checksums. Everything else a release installs is
  checked against the release's `SHA256SUMS`. That file is signed (Ed25519),
  and the installers and `aeryx update` verify the signature against a
  public key pinned in them
  (`BrGv7gJgfFwCNYb+Bv1SHoBiVkkIHLUvzhuQT4RC05Q=`). A release without a
  valid signature is refused. So someone who can only upload files to a
  release can't swap them, but the signing key's holder can. When no release
  exists yet, the installers fall back to the unsigned development branch and
  say so.
- **The desktop app is not code-signed yet** (beta). Downloads made by the
  installers don't trigger Gatekeeper or SmartScreen. A browser download
  does, once. Verify it against `SHA256SUMS` (and `SHA256SUMS.sig`).
- **The shell classifier matches command text.** Classification of shell
  commands is pattern-based, so it can be evaded by construction. That is why
  anything touching Aeryx's own files or install is Class 3 and never
  promotable, and why running the brain under its own account (the warden) is
  the real boundary on Windows.

## If something looks wrong

To halt (stops the brain, the scheduler and every unprompted notice; survives a
restart; local-only).
The daemon refuses any POST that is not `application/json`:

```
# macOS / Linux
curl -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:23799/halt
# Windows PowerShell
Invoke-RestMethod -Method Post -ContentType application/json -Body '{}' -Uri http://127.0.0.1:23799/halt
```

To restore the newest verified backup (it refuses a backup whose chain is broken):

1. Stop Aeryx first with `aeryx stop`. Restore replaces `data/aeryx.db`, which a
   running brain holds open.
2. In the install's app folder (`~/.aeryx/app`, or
   `%LOCALAPPDATA%\Aeryx\runtime\app` on Windows):
   - macOS / Linux: `../node/bin/node scripts/restore.mjs --list`, then
     `../node/bin/node scripts/restore.mjs [file]`
   - Windows: `..\node\node.exe scripts\restore.mjs --list`, then
     `..\node\node.exe scripts\restore.mjs [file]`
3. Run `aeryx start`.

From a source checkout: `npm run restore -- --list` / `npm run restore`, also
after stopping the daemon. The database being replaced is kept beside it as
`aeryx.db.replaced-<time>`.

The Operations log in the Lair and `GET /audit` show every tool call and every decision.
