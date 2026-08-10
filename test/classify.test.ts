import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../src/parse.js";
import { suggestPack } from "../src/classify.js";

const pack = loadPack("packs/customer-discovery");

test("suggests the discovery pack from the opening of a discovery call", () => {
  const opening = `
Founder: Thanks for the time. I want to learn how your team works today, walk me
through your current workflow. I'm not here to sell you anything.
Priya: Sure, happy to talk through how we actually do things.
`;
  const [top] = suggestPack([pack], opening);
  assert.ok(top, "expected at least one suggestion");
  assert.equal(top.packId, "customer-discovery");
  assert.equal(top.playbookId, "customer-discovery-call");
  assert.ok(top.score > 0);
  assert.ok(top.matched.length > 0, "a suggestion should say WHY it matched");
});

test("returns nothing rather than guessing on an unrelated conversation", () => {
  // The failure mode that matters: silently applying the wrong playbook steers a
  // real call toward the wrong objective. No match must mean no suggestion.
  const opening = `
Manager: Let's go through the sprint board and re-point the two stories that slipped.
Dev: Sounds good, the deploy pipeline was red most of Tuesday.
`;
  assert.deepEqual(suggestPack([pack], opening), []);
});

test("negative cues push down a conversation the playbook excludes", () => {
  // "Not a demo, a pitch, a pricing negotiation" is an explicit exclusion.
  const pitch = `
Rep: Let me give you a quick demo of the product, then we can talk pricing and
what a renewal would look like for your team.
`;
  const discovery = `
Founder: Walk me through your workflow today, I want to learn how you work.
`;
  const pitchTop = suggestPack([pack], pitch)[0]?.score ?? 0;
  const discoveryTop = suggestPack([pack], discovery)[0]?.score ?? 0;
  assert.ok(
    discoveryTop > pitchTop,
    `discovery (${discoveryTop}) should outrank a pitch (${pitchTop})`,
  );
});

test("the flagship playbook carries its object identity", () => {
  const pb = pack.playbooks[0]!;
  assert.equal(pb.type, "playbook");
  assert.equal(pb.pack, "customer-discovery");
  assert.equal(pb.persona, "product-manager");
  assert.ok(pb.skills.length > 0);
  assert.ok(pb.whenToUse.length > 0, "classification needs cues to match on");
});

test("a playbook loaded from a pack inherits the pack id when it omits one", () => {
  // Matters because a playbook handed to an agent on its own still has to
  // resolve back to where it came from.
  const pb = pack.playbooks[0]!;
  assert.equal(pb.pack, pack.pack.id);
});
