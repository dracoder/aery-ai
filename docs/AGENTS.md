# Agents

Named specialists Aeryx can delegate to. `agents/` ships with one example, `code-reviewer`.

Add one by asking Aeryx: he proposes it with `agent_propose` and it joins the
roster when you approve it in the Lair. You can also write a file in `agents/` yourself,
one Markdown file per agent with frontmatter:

```markdown
---
name: code-reviewer
description: Reviews a diff for correctness bugs. Use after a change is made.
tools: Read, Grep, Glob
---

What the agent is for, how it works, and what it must not do.
```

`agents/` is part of Aeryx himself. When Aeryx writes here it is Class 3,
because an agent decides what work gets handed to and what that work is told.
Every tool call an agent makes still passes the Chain.
