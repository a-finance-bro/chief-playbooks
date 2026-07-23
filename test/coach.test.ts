import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPack } from "../src/parse.js";
import { initState, parseTranscript, stepRules, applyModelAdvice, finalize } from "../src/coach.js";

const pb = () => loadPack("packs/customer-discovery").playbooks[0]!;

test("parseTranscript reads Speaker: text lines", () => {
  const t = parseTranscript("Founder: hi there\nPriya: hey, good to chat\n\nnot a line");
  assert.equal(t.length, 2);
  assert.deepEqual(t[0], { speaker: "Founder", text: "hi there" });
  assert.equal(t[1]!.speaker, "Priya");
});

test("rules engine advances through steps and captures outputs from the sample call", () => {
  const p = pb();
  const state = initState(p);
  const transcript = parseTranscript(
    readFileSync("packs/customer-discovery/fixtures/sample-transcript.txt", "utf8"),
  );
  for (const u of transcript) stepRules(p, state, u);
  // Walked the whole playbook to the final step.
  assert.equal(state.stepIndex, p.steps.length - 1);
  const result = finalize(p, state);
  // Should have captured a meaningful chunk of the checklist from what Priya said.
  assert.ok(result.captured >= 4, `expected >=4 captured, got ${result.captured}`);
  assert.ok(result.captured <= result.total);
});

test("never advances past the last step", () => {
  const p = pb();
  const state = initState(p);
  for (let i = 0; i < 50; i++) stepRules(p, state, { speaker: "Priya", text: "here is a long substantive answer about our workflow" });
  assert.equal(state.stepIndex, p.steps.length - 1);
});

test("applyModelAdvice sets step + checks outputs + overrides asks", () => {
  const p = pb();
  const state = initState(p);
  const card = applyModelAdvice(p, state, {
    stepIndex: 3,
    outputsDone: [0, 1],
    nextAsks: ["What did that cost you last time?"],
    avoidNow: ["Don't pitch yet"],
    rationale: "they described a specific problem",
  });
  assert.equal(state.stepIndex, 3);
  assert.equal(card.step.n, 4);
  assert.equal(card.outputs[0]!.done, true);
  assert.equal(card.outputs[1]!.done, true);
  assert.deepEqual(card.step.ask, ["What did that cost you last time?"]);
  assert.equal(card.source, "model");
});

test("applyModelAdvice clamps an out-of-range step index", () => {
  const p = pb();
  const state = initState(p);
  applyModelAdvice(p, state, { stepIndex: 999, outputsDone: [], nextAsks: [], avoidNow: [], rationale: "" });
  assert.equal(state.stepIndex, p.steps.length - 1);
});
