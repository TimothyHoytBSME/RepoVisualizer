# Primary Instructions

Always be aware of this document. If I change a requirement or instruction, update this file to match.

## Working mode

If told to continue working until stopped, then do so. After completing any immediate request, move on to whatever you think should be done next. No reports and no stopping — only a short progress sentence after each goal or checkpoint. If you have questions, answer them yourself using your best judgement. If you still need input, ask all your questions at once, as early as possible; otherwise save them for when you are completely blocked from continuing.

Don't assume I'm reading any code or files. You own this codebase, and all the commits are yours. If you think I need to know something, tell me when I stop you or when you are completely blocked. I don't need a ton of technical jargon in updates; if I want something explained further, I'll ask.

## Work log

Track your work history at all times in dated log files inside the repo: `logs/YYYY-MM-DD.md` (one file per day, UTC). After each goal (or checkpoint within a goal), append an entry with a UTC timestamp, a short description of what was done, and any important notes (decisions, known issues, gotchas).

Keep a `## Current state` section at the top of the latest log saying where things stand and what comes next. Write it so another entity, somewhere else, can continue exactly where you left off. Don't include your whole thought process; assume the reader is extremely intelligent and can understand the codebase by reading it.

Commit and push after every goal or checkpoint, together with the log update. The working environment may be temporary, so unpushed work can be lost.

## Code style

Don't use comments unless you think you would have trouble remembering what a piece of code does.

## Workflow

Only create/run automated tests for things you have already struggled to get correct. You are very intelligent and can usually find bugs directly in the code without running tests.

Instead of the "think, iterate, test" loop, prefer this:

1. Write the code/files/changes you immediately think are correct into a minimal draft or diff file in `.drafts/` (gitignored).
2. Review that draft for mistakes, oversights, errors, and current or future problems. Write a new version if needed. Repeat until satisfied.
3. Apply the draft/diff or create the new file, then delete the draft.
4. When many features/behaviors/results are unconfirmed, test them all at once, manually or automatically. Use the findings to update your priorities. Don't re-run a test for something that already passed unless there is reason to think it would fail now.
5. Continue to the next task unless you are completely blocked or have no idea what to do next.

Small, obvious edits can skip the draft file: review them in place, then apply.

When creating a new file or performing a large edit, do it all at once, in one shot. This keeps things token efficient, reduces the number of turns, and avoids getting stuck in loops. Do everything in bulk when you can, including combining tool calls.

Be aware of context size. Use tools that find things and pull only the relevant files or lines of files.

# Target project features and goals

The following list serves as a constant reminder of all the requirements/outcomes of this project.

- A portable, serverless web app that uses the GPU to provide performant, efficient, interactive maps/graphs of various types for a given repository or project.
- Compatible with all modern devices and browsers, and fully responsive.
- Compatible with mouse, keyboard, touch, and gamepad.
- Maps are condensed, connected webs of nodes and edges that can be traversed graphically. The primary map is the code map.
- Nodes are files, directories, keywords, functions, libraries, etc. Edges are how two nodes relate (reference, dependency, etc.).
- Visually pleasant and minimalistic.
- There is always a selected node. The map can be panned without changing the selected node; click/tap/Enter/gamepad button selects a new node.
- A slider sets the connection depth (how many steps from the selected node) shown on the map, with a displayed count of the nodes and edges within that range.
- The code map's nodes are the variables/functions/constants/etc. across an entire repo, with their names visible on the map.
- Hovering/highlighting a node (mouse hover, or keyboard/gamepad focus) shows a peek of its line in its file. A selected node is displayed in context: its full source lines plus the surrounding lines in its file.
- Code map edges show an arrow for a dependency and a plain line for a reference.
- Works with a public GitHub repo or an uploaded repo (held in memory or temporary local storage).
