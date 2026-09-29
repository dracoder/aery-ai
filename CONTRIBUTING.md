# Contributing

Thanks for looking. A few rules keep a safety-critical codebase safe.

## Before you start

- Open an issue for anything bigger than a small fix, so we can agree on the
  shape first.
- Read [SECURITY.md](SECURITY.md). Anything that touches `src/chain/`,
  `guardrails.json`, `src/daemon/auth.ts`, `src/daemon/peer.ts` or the brain's
  `canUseTool` is a change to the safety boundary, and it's reviewed as one.

## The rules

1. **`npm run gate` must be green.** It runs the typecheck and the invariant
   suite. Quote the real count in your pull request.
2. **Add the invariant first.** A change to the Chain comes with the invariant
   that would fail without it, and it arrives in the same pull request.
3. **Never add a path that skips `classify()`.** Every tool call is
   classified. Nothing new returns `allow` beyond the one existing allow path (the brain's `canUseTool`).
4. **Tighten freely, loosen deliberately.** A change that makes something
   *less* guarded needs a written reason in the pull request.
5. **Honest UI.** Demo data is labelled. Don't claim a capability that has no
   proof.
6. **Keep the code quiet.** Comments explain *why* when the code can't. Don't
   narrate changes in comments; that belongs in the commit message.

## Setup

```bash
nvm use            # Node 20
npm install && npm install --prefix lair
npm run gate
npm run build && npm run build:lair && npm run daemon
```

Live proofs (`scripts/test-*-live.mjs`) need a real model, microphone or Windows
session, so they aren't part of the gate. If your change affects one, say
which proof you ran and what it printed.

## Licence

Contributions are accepted under the [CLA](CLA.md). The code is AGPL-3.0. The
name and dragon artwork are not; see [TRADEMARKS.md](TRADEMARKS.md).
