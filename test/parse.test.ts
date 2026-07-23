import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../src/parse.js";
import { parsePlaybook } from "../src/parse.js";

test("loads and validates the customer-discovery pack", () => {
  const { pack, playbooks } = loadPack("packs/customer-discovery");
  assert.equal(pack.id, "customer-discovery");
  assert.equal(playbooks.length, 1);
  const pb = playbooks[0]!;
  assert.equal(pb.id, "customer-discovery-call");
  assert.equal(pb.steps.length, 8, "expected 8 steps");
  assert.ok(pb.outputs.length >= 6, "expected the outputs checklist");
  assert.ok(pb.objective.length > 0);
  assert.ok(pb.successCriteria.length > 0, "objective should carry success criteria");
});

test("parses a step's labeled fields (goal / ask / avoid / advance)", () => {
  const { playbooks } = loadPack("packs/customer-discovery");
  const step1 = playbooks[0]!.steps[0]!;
  assert.match(step1.title, /frame/i);
  assert.ok(step1.goal.length > 0, "step should have a goal");
  assert.ok(step1.ask.length >= 1, "step should have suggested asks");
  assert.ok(step1.avoid.length >= 1, "step should have avoids");
  assert.ok(step1.advanceWhen.length > 0, "step should have an advance-when cue");
  // Quotes are stripped off asks.
  assert.ok(!step1.ask[0]!.startsWith('"'));
});

test("captures do/don't principles and signals", () => {
  const pb = loadPack("packs/customer-discovery").playbooks[0]!;
  assert.ok(pb.principles.some((p) => p.kind === "do"));
  assert.ok(pb.principles.some((p) => p.kind === "dont"));
  assert.ok(pb.signals.length >= 3);
});

test("rejects a playbook with no steps", () => {
  const bad = `---\nid: x\ntitle: X\n---\n## Objective\nGoal.\n## Outputs\n- [ ] a thing\n`;
  assert.throws(() => parsePlaybook(bad), /at least one step/i);
});
