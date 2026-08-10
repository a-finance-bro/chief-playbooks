import { PlaybookSchema, type Playbook } from "./schema.js";
import { parsePlaybook } from "./parse.js";

// Import / export. Two directions, one requirement: a playbook has to survive the
// trip.
//
// EXPORT gives a host a canonical JSON object it can store, serve over an API, and
// hand to an agent that has never seen this repo. MARKDOWN export writes that object
// back out as a spec-shaped file, so a playbook edited through an API can return to
// being a doc a human reviews in a pull request.
//
// The round trip is the actual contract, and it's tested: parse → export → parse must
// produce the same object. Without that, "playbooks are open and portable" is a claim
// rather than a property, and a host that stores them starts quietly owning them.

export const SCHEMA_VERSION = "0.2";

export type PlaybookObject = Playbook & { schema_version: string };

// A playbook as a portable object. Field order is fixed so exports diff cleanly.
export function toObject(pb: Playbook): PlaybookObject {
  return {
    schema_version: SCHEMA_VERSION,
    type: "playbook",
    id: pb.id,
    title: pb.title,
    version: pb.version,
    summary: pb.summary,
    tags: pb.tags,
    authors: pb.authors,
    lineage: pb.lineage,
    pack: pb.pack,
    persona: pb.persona,
    skills: pb.skills,
    whenToUse: pb.whenToUse,
    objective: pb.objective,
    successCriteria: pb.successCriteria,
    principles: pb.principles,
    steps: pb.steps,
    signals: pb.signals,
    outputs: pb.outputs,
  };
}

export function toJSON(pb: Playbook, pretty = true): string {
  return JSON.stringify(toObject(pb), null, pretty ? 2 : 0);
}

export function fromObject(raw: unknown): Playbook {
  const o = raw as Record<string, unknown>;
  // schema_version is envelope metadata, not part of the playbook itself.
  const { schema_version: _ignored, ...rest } = o;
  return PlaybookSchema.parse(rest);
}

const yamlList = (xs: string[]): string => `[${xs.join(", ")}]`;

// Serialize back to a spec-shaped Markdown file.
export function toMarkdown(pb: Playbook): string {
  const fm: string[] = [
    "---",
    "type: playbook",
    `id: ${pb.id}`,
    `title: ${pb.title}`,
    `version: ${pb.version}`,
  ];
  // Quote the summary: it routinely contains a colon, which would otherwise make
  // the line parse as a nested YAML mapping.
  if (pb.summary) fm.push(`summary: ${JSON.stringify(pb.summary)}`);
  if (pb.tags.length) fm.push(`tags: ${yamlList(pb.tags)}`);
  if (pb.authors.length) fm.push(`authors: ${yamlList(pb.authors)}`);
  fm.push(`lineage: ${yamlList(pb.lineage)}`);
  if (pb.pack) fm.push(`pack: ${pb.pack}`);
  if (pb.persona) fm.push(`persona: ${pb.persona}`);
  if (pb.skills.length) fm.push(`skills: ${yamlList(pb.skills)}`);
  fm.push("---", "");

  const out: string[] = [...fm];

  if (pb.whenToUse.length) {
    out.push("## When to use", "");
    for (const w of pb.whenToUse) out.push(`- ${w}`);
    out.push("");
  }

  out.push("## Objective", "", pb.objective, "");
  if (pb.successCriteria.length) {
    out.push("**Success looks like:**");
    for (const s of pb.successCriteria) out.push(`- ${s}`);
    out.push("");
  }

  if (pb.principles.length) {
    out.push("## Principles", "");
    for (const p of pb.principles) {
      out.push(`- **${p.kind === "do" ? "Do" : "Don't"}:** ${p.text}`);
    }
    out.push("");
  }

  out.push("## Steps", "");
  for (const s of pb.steps) {
    out.push(`### ${s.index}. ${s.title}`, "");
    if (s.goal) out.push(`- **Goal:** ${s.goal}`);
    if (s.ask.length) {
      out.push("- **Ask:**");
      for (const a of s.ask) out.push(`  - "${a}"`);
    }
    if (s.avoid.length) {
      out.push("- **Avoid:**");
      for (const a of s.avoid) out.push(`  - ${a}`);
    }
    if (s.advanceWhen) out.push(`- **Advance when:** ${s.advanceWhen}`);
    out.push("");
  }

  if (pb.signals.length) {
    out.push("## Signals", "");
    for (const s of pb.signals) out.push(`- **${s.name}:** ${s.text}`);
    out.push("");
  }

  out.push("## Outputs", "");
  for (const o of pb.outputs) out.push(`- [ ] ${o}`);
  out.push("");

  return out.join("\n");
}

// --- Import ------------------------------------------------------------------

export type ImportResult = { markdown: string; notes: string[] };

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

type Section = { level: number; heading: string; content: string };

// Split on headings, keeping the level. Level matters: the document's H1 is its
// title, not a step, and treating it as one silently adds a bogus first step to
// every imported playbook.
function sectionsOf(body: string): Section[] {
  const parts = body.split(/^(#{1,3})\s+(.+)$/m);
  const out: Section[] = [];
  for (let i = 1; i < parts.length; i += 3) {
    out.push({
      level: (parts[i] ?? "#").length,
      heading: (parts[i + 1] ?? "").trim(),
      content: (parts[i + 2] ?? "").trim(),
    });
  }
  return out;
}

const bullets = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((l) => /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => Boolean(x))
    .map((x) => x.replace(/^\[[ xX]?\]\s*/, "").replace(/^\*\*(.+?):?\*\*\s*/, ""));

// Turn an arbitrary Markdown doc (an exported Google Doc, an internal wiki page, a
// blog post) into a playbook DRAFT.
//
// It deliberately does not pretend to succeed. Anything it couldn't infer is left as
// an explicit TODO and reported in `notes`, because a confidently-wrong playbook is
// worse than an obviously-unfinished one: it will coach someone through a real
// conversation using an objective nobody wrote.
export function fromMarkdownDoc(
  raw: string,
  opts: { id?: string; title?: string } = {},
): ImportResult {
  const notes: string[] = [];
  const h1 = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim();
  const title = opts.title ?? h1 ?? "Untitled Playbook";
  const id = opts.id ?? slug(title);

  const secs = sectionsOf(raw);
  const find = (re: RegExp) => secs.find((s) => re.test(s.heading));

  const objSec = find(/objective|goal|purpose|outcome|why/i);
  let objective = objSec?.content.split(/\r?\n\r?\n/)[0]?.trim() ?? "";
  if (!objective) {
    // Fall back to the first substantial paragraph before any heading.
    const pre = raw.split(/^#{1,3}\s+/m)[0] ?? "";
    objective = pre.split(/\r?\n\r?\n/).map((p) => p.trim()).find((p) => p.length > 60) ?? "";
  }
  if (!objective) {
    objective = "TODO: state the end-state that makes this conversation a success.";
    notes.push("No objective found. Left a TODO — a playbook without one can't steer anything.");
  }

  const outSec = find(/output|deliverable|artifact|result/i);
  let outputs = outSec ? bullets(outSec.content) : [];
  if (outputs.length === 0) {
    outputs = ["TODO: what structured artifact should this conversation produce?"];
    notes.push("No outputs found. Left a TODO — outputs are what turn a call into something reusable.");
  }

  const stepSecs = secs.filter(
    (s) =>
      s.level > 1 &&
      !/objective|goal|purpose|outcome|why|output|deliverable|artifact|result|principle|signal|when to use/i.test(
        s.heading,
      ),
  );
  let steps = stepSecs.map((s) => ({ title: s.heading, ask: bullets(s.content) }));
  if (steps.length === 0) {
    const listy = bullets(raw).slice(0, 8);
    steps = listy.length
      ? listy.map((b) => ({ title: b.slice(0, 60), ask: [] }))
      : [{ title: "TODO: first step", ask: [] }];
    notes.push(`No step headings found. Scaffolded ${steps.length} step(s) from the document's list items.`);
  }

  const princSec = find(/principle|rule|guideline|do.?s? and don/i);
  const principles = princSec ? bullets(princSec.content) : [];

  const pb: Playbook = {
    type: "playbook",
    id,
    title,
    version: "0.1.0",
    summary: "",
    tags: [],
    authors: [],
    lineage: [],
    skills: [],
    whenToUse: [],
    objective,
    successCriteria: [],
    principles: principles.map((p) => ({
      kind: /^don'?t\b/i.test(p) ? ("dont" as const) : ("do" as const),
      text: p.replace(/^(do|don'?t):?\s*/i, ""),
    })),
    steps: steps.map((s, i) => ({
      index: i + 1,
      title: s.title,
      goal: "",
      ask: s.ask,
      avoid: [],
      advanceWhen: "",
    })),
    signals: [],
    outputs,
  };

  notes.push("Review before use: an imported draft is a starting point, not a finished playbook.");
  if (pb.whenToUse.length === 0) {
    notes.push("No 'When to use' cues — this playbook can't be auto-suggested until you add some.");
  }

  return { markdown: toMarkdown(pb), notes };
}
