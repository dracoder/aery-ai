---
name: teach-workflow
description: "The owner wants to teach you a repeatable task — they describe steps, say 'make this a workflow', 'automate this', 'I'll teach you', or walk you through a procedure they want repeated. Run the interview below, then produce a workflow proposal through the normal gate."
---

# Teach me a workflow

The owner is handing you a procedure they do by hand and want done by you. Your
job is to understand it well enough to write it down, then put it through the
existing gate — never to start doing it right now, and never to invent the
parts they did not say.

## The shape of the result

One artifact, gated, waiting on the owner: **a workflow proposal**
(`workflow_propose`).

- Its **prompt** is the PROCEDURE: steps, order, the checks between steps,
  what done looks like, what to do when a step fails. Written so a future you
  who has never seen this conversation can follow it.
- Its **schedule** is what the owner said.
- Its **scope** is the MINIMUM lanes the steps actually need. The owner's
  approval is the standing-order grant, and every widening goes back through
  approval.

## The interview

Ask in batches of at most three questions, and only what the steps they gave
do not already answer. Stop interviewing when you can write every step without
guessing. What you must know before proposing:

- **Trigger** — on a schedule? when something happens? only when asked?
- **Inputs** — what varies per run (a file, a name, a URL), and where it
  comes from. If it comes from the owner each time, the workflow is `manual`.
- **Steps** — in order, with the app or verb each one touches. Replay their
  own words back; do not improve the procedure uninvited.
- **Done** — what the owner would LOOK AT to call one run finished. This
  becomes the final check in the prompt.
- **Never** — anything the task must not touch. This goes in the prompt as a
  hard rule AND stays out of the scope.
- **Failure** — a step fails mid-run: stop, or fall back, or continue? When
  in doubt the answer is stop-and-say-so.

## Scope: the floor, not the ceiling

Propose the smallest scope that covers the steps. Rules that outrank
convenience:

- Steps that only read → read lanes only.
- Never propose a never-scopable lane — those stay ask-every-time even inside
  an approved workflow, and asking for them is how the whole proposal gets
  rejected.
- When unsure whether a step needs a lane, LEAVE IT OUT. A missing grant
  costs one ask at run time; an extra grant is standing authority nobody
  meant to give.

## Doing it

1. Interview until the steps hold no guesses.
2. `workflow_propose` with the procedure as the prompt, the schedule and the
   floor scope. Name it after the task, not the date. In `purpose`, one honest
   sentence on what it does and what it touches.
3. Tell the owner it is waiting: the approve is theirs. Name the exact lanes
   you asked for so the approval is informed.
4. Do NOT run any part of the task in this conversation unless they
   separately ask. Teaching is not doing.

## Refusals that protect the owner

- The task as described needs a never-scopable lane every run → say so
  plainly and propose the closest split: the workflow does the scopable part,
  the owner keeps the gated act.
- The task is a one-off → no workflow; offer to just do it now, gated as
  usual. A workflow for a thing done once is standing authority for nothing.
- The steps contradict a standing rule (guardrails, quiet hours) → surface the
  conflict instead of encoding it.
