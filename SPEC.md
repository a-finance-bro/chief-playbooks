# Playbook Pack Spec — v0.2

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
- **A superset of a skill, not a new format.** A playbook is the same envelope any
  other agent object uses (`type`, `id`, `version`) plus the few fields a playbook
  needs. A host can store playbooks next to skills and route on `type` rather than
  sniffing at the shape. Nothing here is a heavyweight DSL.

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
version: 0.2.0                   # semver
summary: Run high-signal discovery calls that end in a real commitment.
use_cases:                      # human-facing, shown in a pack picker
  - Founder validating a problem before building
  - PM running "jobs to be done" interviews
call_types:                     # machine-facing, used to classify a live call
  - customer discovery call
  - user interview
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
type: playbook       # the object kind; a playbook is a skills-superset
id: customer-discovery-call
title: Customer Discovery Call
version: 0.2.0
summary: Coach a founder through a high-signal discovery call.
tags: [discovery, product, sales]
authors: [Ansh Vasani]
lineage: []          # prior generations this was forked/improved from

pack: customer-discovery              # owning pack; filled in at load time if omitted
persona: product-manager              # optional: who receives the finished outputs
skills: [transcript-summary]          # optional: capabilities a runner may use
---
```

`type`, `pack`, `persona`, and `skills` are what make a playbook a **first-class,
addressable object** rather than a file that only means something inside this repo:
a host can store it, serve it over an API, and hand it to any agent, and the object
still says what it is, where it came from, and who its output is for.

`persona` and `skills` are advisory. A runner that has no personas ignores them and
loses nothing.

**Body** — a fixed set of `##` sections. A runner keys off these exact headings; the
content inside each is human prose.

### `## When to use`
Bulleted cues describing the conversations this playbook is for, and (prefixed with
"Not") the ones it isn't. A host classifies a call from its opening turns and offers
the matching pack, so these cues are what let the right playbook show up *before*
someone thinks to pick it — which matters, because the first minutes of a call are
exactly the part a playbook most wants to shape.

Write them as prose. They're meant to be matched by a model reading the transcript;
the reference implementation (`suggestPack`) ships a lexical baseline that reads the
same field. Exclusions carry real weight: "Not a demo or a pricing negotiation" is
far more precise than any inclusion cue.

Suggestion is a **ranking, not a decision**. A runner should offer, not silently
apply — a wrong playbook applied quietly steers a real conversation toward the wrong
objective.

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

A conformant runner MAY:
- **Classify and suggest.** Read the opening turns, rank packs by their `When to use`
  cues and `call_types`, and *offer* the best match. Offer, never auto-apply silently.
- **Dock more than one playbook at once.** Playbooks are independent objects; a
  session can run several (say a sales playbook plus a personal-operating one) and
  show each as its own panel. Nothing in this format assumes exclusivity.
- **Refresh on a cadence rather than per turn.** The reference runner steps per
  utterance because that's reproducible in a test; a live runner is expected to
  recompute the card every 10–20 seconds instead.
- **Route the outputs to a `persona`** for post-session synthesis, so a summary is
  organised around the playbook's objective rather than generic to-dos.
- Do step-advancement and output-detection with simple rules (offline) or with a
  model reading the transcript (adaptive). Both modes are demonstrated in this repo's
  reference runner; the file format is identical either way.
