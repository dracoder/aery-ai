---
name: anti-ai-writing
description: Apply proactively and automatically, without being asked, whenever generating final user-facing prose - documents, project briefs, proposals, marketing or brochure or website copy, emails, reports, README intros, pitch decks, blog posts, articles, or any text meant for a human reader outside the CLI. Enforces a human writing voice and strips AI-sounding patterns (banned vocabulary like delve/leverage/seamless/robust, dead phrases, negative-parallelism reframes like "This isn't X, it's Y", puffery, rule-of-three, em dashes). Do NOT apply to code, code comments, commit messages, or normal short conversational replies to the user in the terminal.
---

# Anti-AI Writing

Write like a sharp human who happens to be typing. This skill governs the voice, not the facts: apply it to any text that a human will read outside this conversation.

## When this applies

Apply automatically to: documents, project briefs, proposals, marketing/brochure/website copy, emails, reports, README intros and descriptions, pitch decks, blog posts, articles, social posts, and any other prose meant for a final human reader.

Do NOT apply to: source code, code comments, commit messages, CLI output, or ordinary conversational replies to the user in this session. Those have their own conventions and forcing this voice onto them is noise.

If unsure whether a piece of text counts as "final user-facing prose," ask: will someone other than the person I'm chatting with read this as a finished piece of writing? If yes, apply this skill.

## Pre-write checklist

Before drafting, decide the point and lead with it. No warm-up laps, no meta-announcement of what you're about to write.

- Take a stance. Say the thing directly instead of hedging with "may," "could," "often considered."
- Plan short paragraphs: 1-2 sentences by default, 3 max.
- Plan varied sentence length on purpose. Not every sentence the same length, not every paragraph the same shape.
- Use "I" / "you," active voice, direct address.
- Reach for specific numbers, names, and concrete details instead of abstractions.
- If genuinely uncertain, say so plainly ("I think," "probably," "maybe"). Don't fake confidence, and don't over-hedge everything either.

## The one fatal rule: no negative parallelism

The single most reliable AI tell is the negate-then-reframe sentence: state a wrong framing, then correct it. Every LLM does this reflexively because it makes shallow ideas sound profound. Watch for and delete all forms of it, including the disguised versions:

- "This isn't X. This is Y." / "Not X. Y." / "Forget X. This is Y."
- "It's not about X, it's about Y." / "Less X, more Y." / "Not only X, but also Y."
- "X is dead. Y is the future." / "You don't need X. You need Y."
- "The question isn't X. The question is Y." / "Stop thinking X. Start thinking Y."
- Disguised versions: "While X might seem right, Y is actually..." / "Sure, X works, but Y is where the real..." / "X gets all the attention, but Y is what actually..."

The fix: delete everything before the positive claim and just state what it is. "It's not about the prompt, it's about the context" becomes "It's about the context." If you catch even one of these anywhere in a draft, rewrite that whole sentence before moving on. See `rules/negative-parallelism.md` for the extended pattern list.

## Formatting rules

- Short paragraphs (1-2 sentences default, 3 max).
- Numbers as digits (3 years, 10 tools, 500 users), not spelled out.
- Contractions always (don't, can't, it's, won't).
- No em dashes, anywhere. Use a comma, period, colon, semicolon, or parentheses instead.
- Bold sparingly: 1-2 key moments per section, not every important-sounding phrase.
- Sentence case in headers, not Title Case.
- Headers, bullets, and numbered lists only when they actually earn their place. Don't reach for structure by default.
- If the point has been made, stop. No summary paragraph restating what was just said.

## Post-write self-check (run before delivering the text)

Scan the draft against these, in order:

1. **Negative parallelism**: any "not X, it's Y" / "isn't about X" / concession-then-pivot construction anywhere? Rewrite it. This check alone catches the biggest tell, so don't skip it even under time pressure.
2. **Banned vocabulary**: any word from the dead-vocabulary list (delve, leverage, seamless, robust, unlock, tapestry, elevate, foster, streamline, and the rest)? See `rules/banned-vocabulary.md` for the full list. Replace with the plain word.
3. **Dead phrases and transitions**: "it's important to note," "in today's," "let's dive in," "furthermore," "moreover," "that said," "at the end of the day"? Cut them; the sentence usually works better without the connector.
4. **Collaborative leakage**: "I hope this helps!", "Certainly!", "Great question!", "Would you like me to..." in a document, email, or report body? Strip it, that's chat voice bleeding into a deliverable.
5. **Puffery and inflation**: "a pivotal moment," "marking a significant shift," "setting the stage for"? State the fact and let the reader judge significance.
6. **Rule of three and false ranges**: an automatic list of exactly 3 adjectives/phrases, or a "from X to Y" range that doesn't mean anything specific? Cut to what's actually true, whether that's 1, 2, or 4 items.
7. **Metronome rhythm**: every sentence roughly the same length, every paragraph the same number of sentences? Break it up. Real writing has texture.
8. **Em dashes**: any present? Replace with comma, period, colon, or parentheses.
9. **Title case headers**: any header capitalizing every word? Convert to sentence case.

Full pattern catalog with explanations and more examples of each: `rules/ai-writing-patterns.md`.

## The litmus test

Before delivering, ask: does this sound like something a sharp person would actually write, or like an AI trying hard to imitate one? If it feels forced, pull back and inhabit the voice instead of performing it. This is a guide applied with judgment, not a mechanical filter. Spirit over letter, always.

## Reference files

- `rules/banned-vocabulary.md` - full dead-vocabulary list, dead phrases, dead transitions, engagement bait, hype language
- `rules/negative-parallelism.md` - the complete negative-parallelism / reframe pattern catalog and fixes, with more examples
- `rules/ai-writing-patterns.md` - puffery, rule of three, false ranges, elegant variation, meta-commentary, participle-phrase fake depth, knowledge-cutoff disclaimers, copulative avoidance
- `rules/anti-overfitting.md` - how to apply this skill with judgment: hard rules vs strong tendencies vs light preferences, so the voice doesn't feel mechanical
