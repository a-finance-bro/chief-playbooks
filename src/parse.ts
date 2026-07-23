import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  PlaybookSchema,
  PackSchema,
  type Playbook,
  type Pack,
  type Step,
  type LoadedPack,
} from "./schema.js";

// --- Markdown → typed objects ------------------------------------------------
// A playbook is plain Markdown with YAML frontmatter (SPEC.md). We parse the
// frontmatter + a fixed set of `##` sections; the prose inside each stays human.

function splitFrontmatter(src: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return { data: {}, body: src };
  const data = (parseYaml(m[1] ?? "") ?? {}) as Record<string, unknown>;
  return { data, body: m[2] ?? "" };
}

// Break a body into its `## Heading` sections, keyed by lowercased heading.
function sectionize(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = body.split(/^##\s+(.+)$/m); // [pre, h1, c1, h2, c2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    out[(parts[i] ?? "").trim().toLowerCase()] = (parts[i + 1] ?? "").trim();
  }
  return out;
}

const unquote = (s: string): string => s.replace(/^["“']|["”']$/g, "").trim();

// Top-level markdown bullets ("- text" / "* text"), text only.
function topBullets(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => /^\s*[-*]\s+(.*)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => Boolean(x));
}

function parseObjective(section: string): { objective: string; successCriteria: string[] } {
  const [prose, rest] = section.split(/\*\*Success looks like:?\*\*/i);
  return {
    objective: (prose ?? "").trim(),
    successCriteria: rest ? topBullets(rest) : [],
  };
}

function parsePrinciples(section: string): Playbook["principles"] {
  return topBullets(section)
    .map((b) => {
      const m = /^\*\*(Do|Don'?t):?\*\*\s*(.*)$/i.exec(b);
      if (!m) return null;
      return { kind: /^don/i.test(m[1] ?? "") ? ("dont" as const) : ("do" as const), text: (m[2] ?? "").trim() };
    })
    .filter((x): x is Playbook["principles"][number] => Boolean(x && x.text));
}

function parseSignals(section: string): Playbook["signals"] {
  return topBullets(section)
    .map((b) => {
      const m = /^\*\*(.+?):?\*\*\s*(.*)$/.exec(b);
      return m ? { name: (m[1] ?? "").trim(), text: (m[2] ?? "").trim() } : null;
    })
    .filter((x): x is Playbook["signals"][number] => Boolean(x && x.name && x.text));
}

function parseOutputs(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((l) => /^\s*[-*]\s*\[[ xX]?\]\s*(.*)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => Boolean(x));
}

// Each step is a `### N. Title` block with labeled bullets: Goal / Ask / Avoid /
// Advance when. Ask + Avoid may have indented sub-bullets.
function parseSteps(section: string): Step[] {
  const blocks = section.split(/^###\s+/m).slice(1);
  return blocks.map((block, idx) => {
    const lines = block.split(/\r?\n/);
    const title = (lines.shift() ?? "").replace(/^\d+[.)]\s*/, "").trim();
    const step: Step = { index: idx + 1, title, goal: "", ask: [], avoid: [], advanceWhen: "" };
    let mode: "ask" | "avoid" | null = null;
    for (const raw of lines) {
      const top = /^[-*]\s+\*\*(.+?):?\*\*\s*(.*)$/.exec(raw.trim());
      if (top) {
        const label = (top[1] ?? "").toLowerCase();
        const rest = (top[2] ?? "").trim();
        mode = null;
        if (label === "goal") step.goal = rest;
        else if (label.startsWith("advance")) step.advanceWhen = rest;
        else if (label === "ask") { mode = "ask"; if (rest) step.ask.push(unquote(rest)); }
        else if (label === "avoid") { mode = "avoid"; if (rest) step.avoid.push(unquote(rest)); }
        continue;
      }
      const sub = /^\s+[-*]\s+(.*)$/.exec(raw);
      if (sub && mode) step[mode].push(unquote(sub[1] ?? ""));
    }
    return step;
  });
}

export function parsePlaybook(src: string): Playbook {
  const { data, body } = splitFrontmatter(src);
  const s = sectionize(body);
  const { objective, successCriteria } = parseObjective(s["objective"] ?? "");
  const candidate = {
    ...data,
    objective,
    successCriteria,
    principles: parsePrinciples(s["principles"] ?? ""),
    steps: parseSteps(s["steps"] ?? ""),
    signals: parseSignals(s["signals"] ?? ""),
    outputs: parseOutputs(s["outputs"] ?? ""),
  };
  return PlaybookSchema.parse(candidate);
}

export function loadPlaybookFile(path: string): Playbook {
  return parsePlaybook(readFileSync(path, "utf8"));
}

// Load a pack directory: pack.yaml + each referenced <playbook-id>.md.
export function loadPack(dir: string): LoadedPack {
  const packPath = join(dir, "pack.yaml");
  if (!existsSync(packPath)) throw new Error(`No pack.yaml in ${dir}`);
  const pack = PackSchema.parse(parseYaml(readFileSync(packPath, "utf8")));
  const playbooks = pack.playbooks.map((id) => {
    const file = join(dir, `${id}.md`);
    if (!existsSync(file)) throw new Error(`Pack "${pack.id}" references missing playbook: ${id}.md`);
    const pb = loadPlaybookFile(file);
    if (pb.id !== id) throw new Error(`Playbook id "${pb.id}" doesn't match filename "${id}.md"`);
    return pb;
  });
  return { pack, playbooks, dir };
}
