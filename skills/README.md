# Aeryx skill library

One directory per skill; the manifest is `SKILL.md`. Every manifest is injected
into the brain's system prompt at session start, detached from any persona —
strip `memory/persona.md` entirely and the skills still work.

A skill manifest teaches Aeryx *how to use a capability he already has* (a CLI
to shell out to, a directory convention, a procedure). It grants nothing: any
tool call a skill leads to is classified by the Chain like every other call, so
a skill can never widen permissions — only knowledge.

Adding or editing a skill is a change to Aeryx himself: `skills/` is listed in
`guardrails.json` `selfPaths`, so any write here by Aeryx is Class 3 —
always-ask, never promotable. Installing a skill is the user's act, by hand
or by approving that Class 3 prompt.

Format:

```markdown
# skill: <name>
<one-line purpose>

## When to use
## How
## Limits
```
