# Lessons

A lesson shows a user how something works by doing it in their own window
while they watch. It is played by the agent's hands (`client/web/lib/agent-ui`)
and authored as a page.

## Where lessons live

- A lesson is a page in the pages tree's top-level folder named **Lessons**.
  Keep that folder homed in Admin, and share it with Write off to the
  workspaces whose users should see the lessons.
- Every login finds them in the profile menu under **Lessons**.
- A link can offer one: `/?lesson=<page id>`. The user still has to press
  Start, and only a page in the Lessons folder plays.
- Only the page's published body is read, never a draft.
- A login that is not an Admin user is not played a lesson it may change.

## The format

The page holds one fenced block with the language `lesson`. Write it as YAML:

````markdown
```lesson
title: Add a task
steps:
  - say: Tasks live on the Tasks screen.
    do:
      - go: /tasks
    check: { route: /tasks }
  - say: New task opens an empty task.
    point: { role: button, name: New task }
    do:
      - click: { role: button, name: New task }
      - type: { target: { role: textbox, name: Title }, text: Buy milk }
    check: { visible: { role: textbox, name: Title } }
```
````

Each step has these parts:

- `say` (required, up to 400 characters): what the card says.
- `point` (optional): the control to spotlight, with `say` beside it.
- `do` (optional, up to 8 actions): what **Show me** does:
  - `go: /path` opens an app path. No query or hash is allowed.
  - `click: <control>` presses a control.
  - `type: { target: <control>, text: ..., replace: false? }` types into a
    field. No key is pressed, so Enter never sends.
  - `select: { target: <control>, option: ... }` picks an option.
  - `wait: { target: <control>?, ms: 3000 }` waits for the screen to settle.
- `check` (optional): what must be true before the step counts as done.
  Use `route: /path` and/or `visible: <control>`.
  **Let me try** is offered only when a step has a check.

A control is named in one of three ways:

- `{ role, name }`: the role and the words a screen reader would read.
- `{ id }`: a `data-agent` or tour id, such as `nav:/tasks`.
- `{ id: row:<item id> }`: a list row.

A lesson has at most 30 steps. When a lesson is broken, the app lists every
problem in words instead of playing it.

## What a lesson cannot do

The hands guard every lesson as they guard any agent:

- A request that deletes, sends, shares, publishes or changes a setting
  waits for the user's **Allow once**.
- A confirm button in an alert dialog, and a control marked
  `data-agent-risk`, are the user's to press. The step then becomes the
  user's to do, and its check confirms it.
- The hands never type into a password or other secret field, and never act
  inside an app's frame.
- A real click or key press by the user pauses the lesson. **Stop** (or Esc)
  ends it.
