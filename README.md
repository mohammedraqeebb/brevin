# Brevin

**Understand what you build.** A skill for Claude Code and Codex that works *with* you, not around you.

AI can build an app in a day. The catch: a month later you don't know how your own app works.
Brevin keeps the AI fast on chores and slows down only on the decisions that shape what you're
building, until you've shown you understand them. The goal: you understand at least 90% of
what you build.

## Install

```
npm i -g brevin
brevin install
```

That's it. Brevin is on in every Claude Code and Codex session from now on.

## What it does

- **Gets to know you first.** 3 short questions the first time, so it can match how it
  explains things to what you already know.
- **Sorts work by stakes.** Chores (renames, formatting) just get done. Decisions that shape
  your app (logic, data, security, money) get talked through like a teammate would.
- **Plans you can read.** Every big plan has the same headings: Goal, Logic, Flow (a diagram
  of how data moves), Math, Implementation (file, what changes, why), Edge cases, Trade-offs,
  and what users will see. Each one is saved to `docs/decisions/`, so you can find the logic
  again a month later.
- **Checks you followed.** Up to 3 questions per task that the plan doesn't answer for you:
  what breaks if a step goes, a case it didn't list, the math with new numbers. Get them
  right and it stops asking about that idea. Miss one and it explains again, differently.
  It never blocks.

## Modes

| Mode | How | What happens |
|---|---|---|
| **Learn** (default) | `/brevin learn` | The full loop: your take, the plan, check questions |
| **Quick** | `/brevin quick` | The plan, then one question at the end |
| **Outsource** | `/brevin outsource` | No questions this session |

Saying "skip" or "just build" skips the questions for that one task.

## Commands

```
brevin off       switch Brevin off (your profile and log are kept)
brevin on        switch it back on
brevin status    whether it's on
brevin report    this project's checks over the last 30 days
brevin remove    undo everything install did
```

## Your files

Brevin keeps a profile (what you know, with the evidence) and a log of check results in
`~/.brevin/`. Plain text you can read, edit or delete.

---

Made by [Brevin](https://www.getbrevin.com), a humane personal assistant.
