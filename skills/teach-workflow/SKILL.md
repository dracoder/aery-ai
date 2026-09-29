---
name: teach-workflow
description: "The owner wants to teach you a repeatable task — they describe steps, say 'make this a workflow', 'automate this', 'I'll teach you', or walk you through a procedure they want repeated. Run the interview below, then produce a skill draft and a workflow proposal through the normal gates."
---

# Teach me a workflow

The owner is handing you a procedure they do by hand and want done by you. Your
job is to understand it well enough to write it down, then put it through the
two existing gates — never to start doing it right now, and never to invent the
parts they did not say.

## The shape of the result

Two artifacts, both already gated, both waiting on the owner:

1. **A skill draft** (`skill_draft`) — the PROCEDURE. How the task is done:
   steps, order, the checks between steps, what done looks like, what to do
   when a step fails. Written so a future you who has never seen this
   conversation can follow it.
2. **A workflow proposal** (`workflow_propose`) — the TRIGGER and PERMISSION.
   Its prompt says "follow the <name> skill" plus anything run-specific; its
   schedule is what the owner said; its scope is the MINIMUM lanes the steps
   actually need. The owner's Hello on the approval is the standing-order
   grant.

The split matters: the skill is knowledge (cheap to revise via a fresh draft),
the workflow is authority (every widening goes back through Hello).

## The interview

Ask in batches of at most three questions, and only what the steps they gave
do not already answer. Stop interviewing when you can write every step without
guessing. What you must know before drafting:

- **Trigger** — on a schedule? when something happens? only when asked?
- **Inputs** — what varies per run (a file, a name, a URL), and where it
  comes from. If it comes from the owner each time, the workflow is `manual`.
- **Steps** — in order, with the app or verb each one touches. Replay their
  own words back; do not improve the procedure uninvited.
- **Done** — what the owner would LOOK AT to call one run finished. This
  becomes the final check of the skill.
- **Never** — anything the task must not touch. This goes in the skill as a
  hard rule AND stays out of the scope.
- **Failure** — a step fails mid-run: stop, or fall back, or continue? When
  in doubt the answer is stop-and-say-so.

## Scope: the floor, not the ceiling

Propose the smallest scope that covers the steps. Rules that outrank
convenience:

- Steps that only read → read lanes only.
- A step that clicks or types → `talon.act`, and say so out loud in the
  proposal purpose.
- Never propose `talon.act:sensitive`, `publish.*`, or any never-scopable
  lane (`skill.*`, `hoard.learn`, `molt.*`, …) — those stay ask-every-time
  even inside an approved workflow, and asking for them is how the whole
  proposal gets rejected.
- When unsure whether a step needs a lane, LEAVE IT OUT. A missing grant
  costs one ask at run time; an extra grant is standing authority nobody
  meant to give.

## Doing it

1. Interview until the steps hold no guesses.
2. `skill_draft` the procedure. Name it after the task, not the date. In the
   description, state when a future you should reach for it.
3. `workflow_propose` referencing the skill by name, with schedule and the
   floor scope. In `purpose`, one honest sentence on what it does and what it
   touches.
4. Tell the owner both are waiting: the draft's keep is theirs (Hello, at the
   machine), the proposal's approve is theirs (Hello). Name the exact things
   you asked for so the approval is informed.
5. Do NOT run any part of the task in this conversation unless they
   separately ask. Teaching is not doing.

## Refusals that protect the owner

- The task as described needs a never-scopable lane every run → say so
  plainly and propose the closest split: the workflow does the scopable part,
  the owner keeps the gated act.
- The task is a one-off → no workflow; offer to just do it now, gated as
  usual. A workflow for a thing done once is standing authority for nothing.
- The steps contradict a standing rule (guardrails, content rules, quiet
  hours) → surface the conflict instead of encoding it.
