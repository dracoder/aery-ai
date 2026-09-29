# Changelog

## 0.1.0 — first public source release

- The Chain: total classification (0–3), a hash-linked audit with an external
  anchor, the autonomy ladder, standing orders that need a local second factor.
- A live 3D character in the Lair: a core, a dragon and a masked humanoid, as
  Aeryx or Aeri (three.js, no WebGL needed to use the Lair: a still stands in).
  It follows the cursor, mirrors the brain's state and plays gestures. Aeri
  brings her own red theme: the whole Lair, the HUD, Lens and Status switch
  with her.
- First-run onboarding in the Lair: pick a persona, connect a model (local Ollama,
  Claude, OpenRouter, or Codex via OpenRouter) with a live test call, and a
  tour of what the Chain asks.
- Model keys are stored outside the config (DPAPI, macOS Keychain, or a 0600
  file on Linux).
- Conversation with a long-lived brain session, over a local Ollama model,
  Claude, OpenRouter, or Codex via OpenRouter. Every provider drives the same
  session, so the Chain is the same whatever the model.
- The Hoard, Aeryx's own memory: plain files on your disk. What you tell it,
  what it learns about you (kept only when you approve it) and who it is.
  Notices tell you when something is waiting.
- Workflows and agents: it proposes a recurring job, you arm it. A workflow
  acts unattended only in the lanes you approved, and only while it is active.
- The news board and the globe: public RSS feeds, spun by region and topic.
- Continuity across a restart: the journal is written before every brain exit
  and read at the next start, so a reboot no longer costs the thread.
- Voice and speech on Windows: wake word, microphone modes and spoken replies.
- Skins: extra characters load on top of Aeryx and Aeri, validated on load,
  never replacing the built-in pair.
- Remote access over Tailscale, off by default, behind a PIN set at the machine.
- An OS account boundary for the brain on Windows (`runAs: "warden"`), so it
  runs as a separate low-privilege account instead of as you.
- Daily verified backups with the chain anchor, and a restore that refuses a
  backup whose chain is broken.
- Provenance rules:
  - credential reads always ask;
  - inbound files and downloads taint the session;
  - a tainted session loses its silent exits;
  - no standing order covers a tainted lane.
- Runs on macOS for the core; Linux is untested until the CI install job is
  green. Features that need Windows are refused there rather than failing open.
- One-line install on macOS, Linux and Windows with a private, checksum-verified
  Node. `aeryx` runs the install: start, stop, status, update (which keeps your
  data), autostart, report, and uninstall (optionally keeping data).
- Installs and updates come from the release's source archive, checked against
  its `SHA256SUMS`.
- **Desktop app (beta, unsigned)** for macOS and Windows:
  - a native window and tray, with Ctrl+Shift+Space to show or hide Aeryx;
  - a floating orb that stays on screen when the window is closed, shows what
    Aeryx is doing, and counts pending approvals;
  - on Windows, F8 push-to-talk and the HUD.
- **Bug reports:** `aeryx report` (or **report a bug** in the Lair) writes diagnostics with keys, paths and your user name masked, then
  opens a prefilled issue.
- **No telemetry:** the Agent SDK runs with telemetry and error reporting off.
- **Local-only mode:** one switch. Cloud providers, the brain's web tools and
  known outward shell commands, online speech and news are refused.
- **Today's usage:** tokens and estimated cost today, in the Lair's Today card.
  Local models are free; OpenRouter prices vary by model, so its cost shows as "varies".
- **Setup suggests a local model sized to this computer's memory.**
- **Desktop beta:** notifications (an approval waiting, a long task done),
  quick ask (double-click the orb), Send feedback…, and a changeable shortcut.
- Commands that act on Aeryx itself (update, uninstall, autostart, the
  `AERYX_*` overrides) are Class 3 when the brain runs them, and are never
  promotable.
