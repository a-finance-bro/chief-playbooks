# Playbook Packs

**Open-source operating playbooks that coach you in real time during a live call —
and turn the conversation into structured output.**

A *playbook* is a plain-English guide for one kind of conversation (a customer
discovery call, a 1:1, a hiring screen). It states what "great" looks like, the steps
to get there, what to ask, what to avoid, and the artifacts the call should produce.

A *runner* loads a playbook and coaches you live: where you are, what to ask next, and
which outputs you've captured — then hands you the structured result at the end.

This repo is **runner-agnostic**. The same playbook file works in [Chief](https://chief.bot),
in Claude Code, or via the small reference runner included here. The format is the
contract; see **[SPEC.md](./SPEC.md)**.

> Status: v0.2 — the spec, one flagship pack (**Customer Discovery Call**), pack
> suggestion from a call's opening, import/export + lint tooling, and a reference
> runner (offline rules + optional model-driven coaching). Built by Ansh Vasani;
> contributions welcome.

## See it running

**[chief-playbooks.vercel.app](https://chief-playbooks.vercel.app)** — the coaching loop,
pack suggestion, the playbook, and the raw Markdown file it all comes from.

## Try it (no API key needed)

```bash
npm install

# a web view of the whole loop — open http://localhost:4000
npm run web
```

To share that with other people (no account, no signup):

```bash
npx -y cloudflared tunnel --url http://localhost:4000
```

The server holds **no session state**: it computes a transcript's whole timeline in one
shot and the browser scrubs through it locally. So several people can open the same
link at once, each with an independent playhead, and nobody's scrubbing moves anyone
else's screen.

```bash

# validate a pack against the spec
npm run validate packs/customer-discovery

# from a call's opening lines, rank which pack should be offered
npx tsx src/cli.ts suggest packs --transcript packs/customer-discovery/fixtures/sample-transcript.txt

# check the rules the schema doesn't enforce (will it actually coach anyone?)
npx tsx src/cli.ts lint packs/customer-discovery

# replay a sample discovery call and watch the live coaching + captured outputs
npm run demo
```

`npm run demo` replays a real-ish discovery call turn by turn and prints the evolving
coaching card (current step, suggested questions, what to avoid) plus the structured
outputs it captured — entirely offline.

For adaptive, model-driven coaching (what a production runner like Chief would do):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run coach packs/customer-discovery -- --transcript packs/customer-discovery/fixtures/sample-transcript.txt --llm
```

## Move playbooks in and out

A playbook is a portable object, not a file that only means something in this repo.

```bash
# export a playbook a host can store, serve over an API, and hand to any agent
npx tsx src/cli.ts export packs/customer-discovery --format json

# write it back out as a spec-shaped Markdown file
npx tsx src/cli.ts export packs/customer-discovery --format md --out playbook.md

# turn an existing doc (an exported Google Doc, a wiki page) into a playbook draft
npx tsx src/cli.ts import ./some-operating-doc.md --out packs/my-pack/my-playbook.md
```

The round trip is tested, not just claimed: parse → export → re-parse produces the
identical object. Import is deliberately honest — anything it can't infer is left as
an explicit `TODO` and reported, because a confidently-wrong playbook is worse than an
obviously-unfinished one.

## Use it as a library

```ts
import { loadPack, initState, parseTranscript, stepRules, finalize } from "chief-playbooks";

const { playbooks } = loadPack("packs/customer-discovery");
const pb = playbooks[0];
const state = initState(pb);
for (const u of parseTranscript(myTranscript)) stepRules(pb, state, u); // or model mode
console.log(finalize(pb, state)); // structured outputs
```

## How it maps to Chief's Live Sessions

The idea: before a Live Session you load a **playbook pack** (the same way you'd load a
label pack), or the session classifies the call from its opening turns and offers the
right pack for you. During the call a coaching panel shows the playbook's objective and the
next best question, adapts as the conversation moves, and produces the pack's outputs
(commitments, next steps, a decision summary) when you're done — turning conversation
"dirt" into structured "gold." This repo is where those packs live and get better
through community PRs; a runner (Chief, Claude Code, or the CLI here) executes them.

## Layout

```
SPEC.md                       # the playbook + pack format (the contract)
packs/customer-discovery/     # flagship pack: pack.yaml + the CDC playbook + a fixture
src/                          # reference runner (parse, coach, llm, cli)
test/                         # tests
```

## Contributing

Playbooks are plain Markdown — improve one, add a new pack, submit a PR. Each playbook
carries a `version` and `lineage` so improvements are traceable across generations.
See `SPEC.md` for the format. Before opening a PR, run `npm run validate` (will it
load?) and `playbook lint` (will it actually coach anyone?).

## License

MIT © Ansh Vasani
