#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadPack } from "./parse.js";
import {
  initState,
  parseTranscript,
  stepRules,
  applyModelAdvice,
  finalize,
  type CoachCard,
  type Playbook,
  type Utterance,
} from "./index.js";
import { adviseWithModel, hasModelKey } from "./llm.js";
import { suggestPack } from "./classify.js";
import { toJSON, toMarkdown, fromMarkdownDoc } from "./convert.js";
import { lintPlaybook } from "./lint.js";
import { writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Tiny ANSI helpers (no dependency).
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

function printCard(card: CoachCard): void {
  const src = card.source === "model" ? c.amber("● model") : c.dim("○ rules");
  console.log(`\n${c.bold(`Step ${card.step.n}/${card.step.total}: ${card.step.title}`)}  ${c.dim(card.progress)}  ${src}`);
  if (card.step.goal) console.log(c.dim(`  goal: ${card.step.goal}`));
  for (const a of card.step.ask.slice(0, 3)) console.log(`  ${c.green("→")} ${a}`);
  for (const a of card.step.avoid.slice(0, 2)) console.log(`  ${c.red("✕")} ${c.dim(a)}`);
  const captured = card.outputs.filter((o) => o.done).length;
  if (captured) console.log(c.dim(`  captured: ${card.outputs.filter((o) => o.done).map((o) => o.text.split("(")[0]!.trim()).join(" · ")}`));
}

function cmdValidate(dir: string): void {
  const { pack, playbooks } = loadPack(dir);
  console.log(c.green(`✓ pack "${pack.id}" (${pack.title}) v${pack.version}`));
  for (const pb of playbooks) {
    console.log(
      `  ${c.green("✓")} ${pb.id}: ${pb.steps.length} steps · ${pb.outputs.length} outputs · ${pb.signals.length} signals · ${pb.principles.length} principles`,
    );
  }
  console.log(c.dim(`\nValid against SPEC.md. ${playbooks.length} playbook(s).`));
}

async function cmdCoach(dir: string, args: string[]): Promise<void> {
  const { pack, playbooks } = loadPack(dir);
  const id = flag(args, "playbook");
  const pb: Playbook | undefined = id ? playbooks.find((p) => p.id === id) : playbooks[0];
  if (!pb) throw new Error(`No playbook ${id ? `"${id}"` : ""} in pack "${pack.id}"`);
  const useModel = args.includes("--llm");

  console.log(c.bold(`\n${pb.title}`));
  console.log(c.dim(`Objective: ${pb.objective}`));

  const transcriptPath = flag(args, "transcript");
  if (!transcriptPath) {
    // No transcript → show the opening coaching card as a static preview.
    const state = initState(pb);
    printCard(stepRules(pb, state, { speaker: "system", text: "" }));
    console.log(c.dim(`\n(Pass --transcript <file> to replay a call. Add --llm for model-driven coaching.)`));
    return;
  }

  const transcript = parseTranscript(readFileSync(transcriptPath, "utf8"));
  const state = initState(pb);
  const modelOn = useModel && hasModelKey();
  if (useModel && !modelOn) console.log(c.dim("\n(--llm requested but ANTHROPIC_API_KEY not set — using offline rules.)"));

  const seen: Utterance[] = [];
  for (const u of transcript) {
    seen.push(u);
    console.log(`\n${c.dim(`${u.speaker}:`)} ${u.text}`);
    let card: CoachCard;
    if (modelOn) {
      try {
        card = applyModelAdvice(pb, state, await adviseWithModel(pb, seen));
      } catch (err) {
        console.log(c.dim(`  (model call failed, falling back to rules: ${(err as Error).message})`));
        card = stepRules(pb, state, u);
      }
    } else {
      card = stepRules(pb, state, u);
    }
    printCard(card);
  }

  const result = finalize(pb, state);
  console.log(c.bold(`\n── Session outputs ──`));
  for (const o of result.outputs) console.log(`  ${o.done ? c.green("✓") : c.dim("○")} ${o.text}`);
  console.log(
    `\n${result.complete ? c.green("Complete") : c.amber("Partial")}: captured ${result.captured}/${result.total} outputs.`,
  );
}

// Rank the packs in a directory against the opening of a conversation. This is
// the pre-session half of the product: the pack should find you, not the other
// way round.
function cmdSuggest(packsDir: string, args: string[]): void {
  const file = flag(args, "transcript");
  if (!file) throw new Error("suggest needs --transcript <file>");
  const opening = readFileSync(file, "utf8");

  const dirs = readdirSync(packsDir)
    .map((d) => join(packsDir, d))
    .filter((d) => statSync(d).isDirectory());
  const packs = dirs.map((d) => loadPack(d));

  const ranked = suggestPack(packs, opening);
  if (ranked.length === 0) {
    console.log(c.dim("No pack confidently matches this conversation. Leaving it unset."));
    return;
  }
  console.log(c.bold(`\nSuggested packs (${ranked.length}):`));
  for (const r of ranked) {
    console.log(`  ${c.green("→")} ${c.bold(r.packId)} / ${r.playbookId}  ${c.dim(`score ${r.score}`)}`);
    for (const m of r.matched.slice(0, 2)) console.log(c.dim(`      matched: ${m}`));
  }
  console.log(c.dim("\nA host should OFFER the top match, not apply it silently."));
}

function pickPlaybook(dir: string, args: string[]): Playbook {
  const { pack, playbooks } = loadPack(dir);
  const id = flag(args, "playbook");
  const pb = id ? playbooks.find((p) => p.id === id) : playbooks[0];
  if (!pb) throw new Error(`No playbook ${id ? `"${id}"` : ""} in pack "${pack.id}"`);
  return pb;
}

// Export a playbook as a portable object a host can store and serve.
function cmdExport(dir: string, args: string[]): void {
  const pb = pickPlaybook(dir, args);
  const fmt = flag(args, "format") ?? "json";
  if (fmt !== "json" && fmt !== "md") throw new Error(`Unknown --format "${fmt}" (json|md)`);
  const text = fmt === "json" ? toJSON(pb) : toMarkdown(pb);
  const out = flag(args, "out");
  if (out) {
    writeFileSync(out, text);
    console.log(c.green(`✓ wrote ${out}`));
  } else {
    console.log(text);
  }
}

// Turn an arbitrary Markdown doc into a playbook draft.
function cmdImport(file: string, args: string[]): void {
  const { markdown, notes } = fromMarkdownDoc(readFileSync(file, "utf8"), {
    id: flag(args, "id"),
    title: flag(args, "title"),
  });
  const out = flag(args, "out");
  if (out) {
    writeFileSync(out, markdown);
    console.log(c.green(`✓ wrote ${out}`));
  } else {
    console.log(markdown);
  }
  if (notes.length) {
    console.error(c.amber("\nReview notes:"));
    for (const n of notes) console.error(c.dim(`  • ${n}`));
  }
}

// Lint: the rules the schema doesn't enforce.
function cmdLint(dir: string): void {
  const { playbooks } = loadPack(dir);
  let warns = 0;
  for (const pb of playbooks) {
    const findings = lintPlaybook(pb);
    console.log(c.bold(`\n${pb.id}`));
    if (findings.length === 0) {
      console.log(`  ${c.green("✓")} no findings`);
      continue;
    }
    for (const f of findings) {
      if (f.level === "warn") warns++;
      const tag = f.level === "warn" ? c.amber("warn") : c.dim("info");
      console.log(`  ${tag} ${c.dim(f.rule)}${f.where ? c.dim(` · ${f.where}`) : ""}`);
      console.log(`       ${f.message}`);
    }
  }
  console.log(c.dim(`\n${warns} warning(s). Lint never blocks loading.`));
  if (warns > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [cmd, dir, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "validate" && dir) return cmdValidate(dir);
    if (cmd === "coach" && dir) return await cmdCoach(dir, rest);
    if (cmd === "suggest" && dir) return cmdSuggest(dir, rest);
    if (cmd === "lint" && dir) return cmdLint(dir);
    if (cmd === "export" && dir) return cmdExport(dir, rest);
    if (cmd === "import" && dir) return cmdImport(dir, rest);
    console.log(
      `playbook — run open Playbook Packs\n\n` +
        `  playbook validate <packDir>\n` +
        `  playbook coach <packDir> [--playbook <id>] [--transcript <file>] [--llm]\n` +
        `  playbook suggest <packsDir> --transcript <file>\n` +
        `  playbook lint <packDir>\n` +
        `  playbook export <packDir> [--playbook <id>] [--format json|md] [--out <file>]\n` +
        `  playbook import <doc.md> [--id <id>] [--title <t>] [--out <file>]\n`,
    );
    process.exit(cmd ? 1 : 0);
  } catch (err) {
    console.error(c.red(`✗ ${(err as Error).message}`));
    process.exit(1);
  }
}

void main();
