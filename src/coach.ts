import type { Playbook } from "./schema.js";

// The coaching loop. Given a playbook + the conversation so far, produce a "coaching
// card": where you are, what to ask next, what to avoid, and which structured outputs
// have been captured. Two engines, identical file format:
//   - "rules"  : offline, deterministic heuristics (no key, no network). Good enough to
//                demo the loop and to run in restricted environments.
//   - "model"  : a model reads the transcript for adaptive guidance (see llm.ts). This
//                is what a production runner (Chief) would use.

export type Utterance = { speaker: string; text: string };

export type CoachState = {
  stepIndex: number; // 0-based index into playbook.steps
  outputs: { text: string; done: boolean }[];
};

export type CoachCard = {
  objective: string;
  step: { n: number; total: number; title: string; goal: string; ask: string[]; avoid: string[] };
  outputs: { text: string; done: boolean }[];
  progress: string; // e.g. "step 3/8 · 2/8 captured"
  nextAction: string;
  source: "rules" | "model";
};

export function initState(pb: Playbook): CoachState {
  return { stepIndex: 0, outputs: pb.outputs.map((text) => ({ text, done: false })) };
}

// Parse a transcript file of "Speaker: text" lines into utterances.
export function parseTranscript(text: string): Utterance[] {
  return text
    .split(/\r?\n/)
    .map((l) => {
      const m = /^\s*([A-Za-z][\w .'-]*?):\s+(.*\S)\s*$/.exec(l);
      return m ? { speaker: (m[1] ?? "").trim(), text: (m[2] ?? "").trim() } : null;
    })
    .filter((x): x is Utterance => Boolean(x));
}

const STOPWORDS = new Set(
  "the a an and or of to in on for with your you they them their we our i is are be do dont don't what how who when if it its this that these those they've you've about into out up".split(
    " ",
  ),
);

// Significant lowercased words (used for cheap heuristic matching in rules mode).
function keywords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z']{2,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
}

function overlap(a: string, hay: string): number {
  const h = hay.toLowerCase();
  const ks = keywords(a);
  if (ks.length === 0) return 0;
  return ks.filter((k) => h.includes(k)).length / ks.length;
}

function isFacilitator(speaker: string): boolean {
  // The person being coached (interviewer). Everything else counts as the "customer".
  return /founder|interviewer|me|host|pm|rep|you/i.test(speaker);
}

function buildCard(pb: Playbook, state: CoachState, source: CoachCard["source"], nextAction: string): CoachCard {
  const step = pb.steps[Math.min(state.stepIndex, pb.steps.length - 1)]!;
  const done = state.outputs.filter((o) => o.done).length;
  return {
    objective: pb.objective,
    step: { n: step.index, total: pb.steps.length, title: step.title, goal: step.goal, ask: step.ask, avoid: step.avoid },
    outputs: state.outputs,
    progress: `step ${step.index}/${pb.steps.length} · ${done}/${state.outputs.length} captured`,
    nextAction,
    source,
  };
}

// Rules engine: consume ONE new utterance, mutate state, return an updated card.
// Deterministic + honest heuristics (a stand-in for the model engine, not a replica):
//   - capture an output when the utterance keyword-overlaps its text, and
//   - advance one step on each substantive customer answer (a discovery call moves
//     roughly one topic per exchange). Never advances past the last step.
export function stepRules(pb: Playbook, state: CoachState, u: Utterance): CoachCard {
  const fromCustomer = !isFacilitator(u.speaker);

  // Outputs are captured from what the CUSTOMER says, not the interviewer's questions.
  if (fromCustomer) {
    for (const o of state.outputs) {
      if (!o.done && overlap(o.text, u.text) >= 0.4) o.done = true;
    }
  }

  const substantive = u.text.replace(/\s+/g, " ").trim().length >= 40;
  if (fromCustomer && substantive && state.stepIndex < pb.steps.length - 1) {
    state.stepIndex += 1;
  }

  const next = pb.steps[state.stepIndex]?.ask[0] ?? "Wrap up and confirm the outputs below.";
  return buildCard(pb, state, "rules", `Try: ${next}`);
}

// Shape the model engine returns for a given transcript (see llm.ts).
export type ModelAdvice = {
  stepIndex: number; // 0-based
  outputsDone: number[]; // indices into state.outputs that are now captured
  nextAsks: string[];
  avoidNow: string[];
  rationale: string;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Apply a model's advice to state and produce a card. The model's live asks/avoids
// (tailored to what was just said) override the playbook's static ones when present.
export function applyModelAdvice(pb: Playbook, state: CoachState, advice: ModelAdvice): CoachCard {
  state.stepIndex = clamp(Math.floor(advice.stepIndex), 0, pb.steps.length - 1);
  for (const i of advice.outputsDone) if (state.outputs[i]) state.outputs[i]!.done = true;
  const card = buildCard(pb, state, "model", advice.nextAsks[0] ? `Try: ${advice.nextAsks[0]}` : advice.rationale);
  if (advice.nextAsks.length) card.step.ask = advice.nextAsks;
  if (advice.avoidNow.length) card.step.avoid = advice.avoidNow;
  return card;
}

// Final structured result once the session ends.
export function finalize(pb: Playbook, state: CoachState) {
  const done = state.outputs.filter((o) => o.done);
  return {
    playbook: pb.id,
    objective: pb.objective,
    outputs: state.outputs,
    captured: done.length,
    total: state.outputs.length,
    complete: done.length === state.outputs.length,
  };
}
