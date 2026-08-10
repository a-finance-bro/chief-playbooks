import type { Playbook } from "./schema.js";

// Lint = the rules the schema deliberately doesn't enforce.
//
// Validation answers "will this load?". Linting answers "will this actually coach
// anyone?" — and those are very different bars. A playbook can be perfectly valid and
// still useless: one step, no cues, an objective nobody can check against.
//
// Every rule here fires on something a reviewer would otherwise have to notice by
// hand on a community PR, which is the point. Warnings never block loading.

export type Finding = {
  level: "warn" | "info";
  rule: string;
  message: string;
  where?: string;
};

const WORDS = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export function lintPlaybook(pb: Playbook): Finding[] {
  const f: Finding[] = [];

  if (pb.whenToUse.length === 0) {
    f.push({
      level: "warn",
      rule: "no-when-to-use",
      message: "No `## When to use` cues, so this playbook can never be auto-suggested. It only runs if someone picks it by hand.",
    });
  } else if (!pb.whenToUse.some((w) => /^\s*not\b|\bnot a\b/i.test(w))) {
    f.push({
      level: "info",
      rule: "no-exclusion-cue",
      message: "No exclusion cue. A line starting with \"Not\" does more for suggestion accuracy than any inclusion cue.",
    });
  }

  if (pb.successCriteria.length === 0) {
    f.push({
      level: "warn",
      rule: "no-success-criteria",
      message: "The objective has no `**Success looks like:**` list, so nothing can check whether the call actually went well.",
    });
  }

  if (WORDS(pb.objective) > 120) {
    f.push({
      level: "info",
      rule: "long-objective",
      message: `The objective is ${WORDS(pb.objective)} words. It gets pinned to a live panel, so shorter reads better mid-call.`,
    });
  }

  if (pb.steps.length < 2) {
    f.push({
      level: "warn",
      rule: "too-few-steps",
      message: "Only one step. A playbook with no progression can't tell anyone where they are in the conversation.",
    });
  }

  for (const s of pb.steps) {
    const where = `step ${s.index} (${s.title})`;
    if (s.ask.length === 0) {
      f.push({
        level: "warn",
        rule: "step-without-ask",
        message: "No suggested questions, so the coaching card has nothing to show here.",
        where,
      });
    }
    if (!s.advanceWhen) {
      f.push({
        level: "warn",
        rule: "step-without-advance",
        message: "No `Advance when:`, so a runner has no signal for when to move on and will sit on this step.",
        where,
      });
    }
    if (!s.goal) {
      f.push({ level: "info", rule: "step-without-goal", message: "No `Goal:` line.", where });
    }
  }

  if (pb.outputs.length < 2) {
    f.push({
      level: "info",
      rule: "few-outputs",
      message: "Fewer than two outputs. Outputs are the structured result of the call, and they're where most of the lasting value is.",
    });
  }

  if (pb.signals.length === 0) {
    f.push({
      level: "info",
      rule: "no-signals",
      message: "No signals. Without them the guidance follows the steps but never reacts to how the conversation is actually going.",
    });
  }

  if (pb.version === "0.0.0") {
    f.push({
      level: "warn",
      rule: "unversioned",
      message: "Version is 0.0.0. Packs are meant to improve over generations, and lineage is meaningless without real versions.",
    });
  }

  return f;
}
