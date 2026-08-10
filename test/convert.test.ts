import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack, parsePlaybook } from "../src/parse.js";
import { toObject, toJSON, fromObject, toMarkdown, fromMarkdownDoc } from "../src/convert.js";
import { lintPlaybook } from "../src/lint.js";

const pb = loadPack("packs/customer-discovery").playbooks[0]!;

test("markdown round-trip preserves the playbook exactly", () => {
  // The property the whole "open and portable" claim rests on. If a playbook
  // can't survive export → re-parse, then whichever host stores it quietly
  // becomes the only place it works.
  const reparsed = parsePlaybook(toMarkdown(pb));
  assert.deepEqual(reparsed, pb);
});

test("JSON round-trip preserves the playbook exactly", () => {
  assert.deepEqual(fromObject(JSON.parse(toJSON(pb))), pb);
});

test("the exported object carries its schema version and type", () => {
  const o = toObject(pb);
  assert.equal(o.type, "playbook");
  assert.equal(o.schema_version, "0.2");
  assert.equal(o.id, "customer-discovery-call");
});

test("export survives a summary containing a colon", () => {
  // Unquoted, "summary: Coach a founder: do X" parses as a nested mapping and
  // the file silently loses its summary.
  const tricky = { ...pb, summary: "Coach a founder: learn, don't pitch" };
  const reparsed = parsePlaybook(toMarkdown(tricky));
  assert.equal(reparsed.summary, "Coach a founder: learn, don't pitch");
});

test("import scaffolds a valid playbook from an ordinary doc", () => {
  const doc = `
# Weekly 1:1

## Purpose
Give the person a space to raise what actually matters, and leave with agreed next steps.

## Check in
- How are you doing, honestly?
- What's been draining you this week?

## Talk about progress
- What moved since we last spoke?

## Outputs
- [ ] Agreed next steps
- [ ] Anything blocked, and who owns unblocking it
`;
  const { markdown, notes } = fromMarkdownDoc(doc);
  const imported = parsePlaybook(markdown); // must be valid per the schema
  assert.equal(imported.title, "Weekly 1:1");
  assert.equal(imported.id, "weekly-1-1");
  assert.match(imported.objective, /space to raise what actually matters/);
  assert.equal(imported.steps.length, 2);
  assert.equal(imported.outputs.length, 2);
  assert.ok(notes.some((n) => /Review before use/i.test(n)));
});

test("import marks what it could not infer instead of inventing it", () => {
  // A confidently-wrong playbook is worse than an obviously-unfinished one: it
  // would coach a real conversation toward an objective nobody wrote.
  const { markdown, notes } = fromMarkdownDoc("# Some Notes\n\n- a\n- b\n");
  assert.match(markdown, /TODO/);
  assert.ok(notes.some((n) => /No objective found/i.test(n)));
  assert.ok(notes.some((n) => /No outputs found/i.test(n)));
});

test("an imported draft lints as incomplete rather than passing quietly", () => {
  const { markdown } = fromMarkdownDoc("# Some Notes\n\n- a\n- b\n");
  const findings = lintPlaybook(parsePlaybook(markdown));
  const rules = findings.map((f) => f.rule);
  assert.ok(rules.includes("no-when-to-use"));
  assert.ok(rules.includes("no-success-criteria"));
  assert.ok(findings.some((f) => f.level === "warn"));
});

test("the flagship pack has no lint warnings", () => {
  // The reference pack is what contributors copy. If it ships warnings, the
  // linter teaches people to ignore it.
  const warns = lintPlaybook(pb).filter((f) => f.level === "warn");
  assert.deepEqual(
    warns.map((w) => `${w.rule}${w.where ? ` @ ${w.where}` : ""}`),
    [],
  );
});
