# Playbook Pack Spec — v0.1

A **Playbook** is a plain-English operating guide for one kind of live conversation
(a customer discovery call, a 1:1, a hiring screen). A **Pack** is a bundle of
related playbooks you load before a session.

The whole point: a playbook must be **easy for a human to write and read** and
**reliable for a machine to load and run**. This spec threads that needle with one
rule — *prose for humans, a thin, conventional structure for machines.* Every field
below is readable Markdown; a runner (Chief, Claude Code, or the reference runner in
this repo) parses the frontmatter + a small set of known headings and never needs to
guess.

Design tenets:
- **Markdown-first.** No new file format, no code. A playbook opens fine in any editor
  and reads like a doc.
- **Runner-agnostic.** Nothing here is Chief-specific. The same file coaches you in
  Chief, in Claude Code, or via `playbook coach` in this repo.
- **Declarative objective, then guidance.** Every playbook states *what "great" looks
  like* first, then how to get there — so a model can always orient toward the goal.
- **Composable + versioned.** Packs compose (personal → project → team → org), and
  every playbook carries a version + lineage so improvements are traceable.

---

## File layout

```
packs/
  <pack-id>/
    pack.yaml                 # pack metadata (name, description, which playbooks)
    <playbook-id>.md          # one playbook per file
    fixtures/                 # optional sample transcripts for testing/demo
```

## `pack.yaml`

```yaml
id: customer-discovery          # kebab-case, unique
title: Customer Discovery
version: 0.1.0                   # semver
summary: Run high-signal discovery calls that end in a real commitment.
use_cases:
  - Founder validating a problem before building
  - PM running "jobs to be done" interviews
playbooks:                      # files in this pack, in suggested order
  - customer-discovery-call
authors:
  - Ansh Vasani
tags: [discovery, product, research]
```

## A playbook file (`<playbook-id>.md`)

**Frontmatter** (YAML) — machine-read metadata:

```yaml
---
id: customer-discovery-call
title: Customer Discovery Call
version: 0.1.0
summary: Coach a founder through a high-signal discovery call.
tags: [discovery, product, sales]
authors: [Ansh Vasani]
lineage: []          # prior generations this was forked/improved from
---
```

**Body** — a fixed set of `##` sections. A runner keys off these exact headings; the
content inside each is human prose.

### `## Objective`
One declarative paragraph: the end-state that makes this conversation a success.
Then a `**Success looks like:**` list of concrete, checkable criteria. This is the
star the runner steers toward at every step.

### `## Principles`
Global do/don't guidance that applies the whole call. Each line is
`- **Do:** …` or `- **Don't:** …`.

### `## Steps`
The ordered spine of the conversation. Each step is a `###` subsection with four
labeled fields:

- **Goal:** what this step is trying to get.
- **Ask:** a list of suggested questions/prompts (quoted).
- **Avoid:** things not to do here.
- **Advance when:** the human-readable signal that it's time to move on. (A runner may
  use this prose directly with a model, or match on it heuristically.)

### `## Signals`
Cross-cutting cues to listen for that *adapt* the guidance, as
`- **<signal>:** <what to listen for> → <what it implies>`.

### `## Outputs`
A Markdown checklist of the structured artifacts the call should produce — the "gold"
extracted from the conversation. `- [ ] <artifact>`.

---

## The runner contract

A conformant runner MUST:
1. Load `pack.yaml` + each referenced playbook, and validate the shape (see
   `src/schema.ts` for the canonical Zod schema).
2. Track **current step** and the **outputs checklist** as the conversation streams in.
3. Surface, at any moment, a **coaching card**: the current objective, the step's
   suggested asks + avoids, progress, and the next best action.
4. Emit the filled-in **Outputs** as structured data when the session ends.

A runner MAY do step-advancement and output-detection with simple rules (offline) or
with a model reading the transcript (adaptive). Both modes are demonstrated in this
repo's reference runner; the file format is identical either way.
