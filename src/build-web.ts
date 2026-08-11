import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { loadPack } from "./parse.js";
import { lintPlaybook } from "./lint.js";

// Build the demo into a folder of static files.
//
// Everything the demo does is either (a) parsing packs, which depends on nothing the
// user types, or (b) stepping a transcript, which is pure. So (a) happens once here
// and (b) ships to the browser. There is no server and no API.
//
// Worth the trouble for one reason: the artifact served locally is byte-for-byte the
// artifact deployed. A demo that works on the presenter's laptop and breaks on the
// shared link is the specific failure this rules out.
//
// It also makes the runner-agnostic claim concrete rather than rhetorical — the exact
// same coach and classify code runs in Node, in the CLI, and in the browser.

const OUT = "web";

function main(): void {
  const packsDir = "packs";
  const dirs = readdirSync(packsDir)
    .map((d) => join(packsDir, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "pack.yaml")));

  const packs = dirs.map((dir) => {
    const { pack, playbooks } = loadPack(dir);
    const fixtureDir = join(dir, "fixtures");
    const fixtureFile = existsSync(fixtureDir)
      ? readdirSync(fixtureDir).find((f) => f.endsWith(".txt"))
      : undefined;

    return {
      ...pack,
      fixture: fixtureFile ? readFileSync(join(fixtureDir, fixtureFile), "utf8") : "",
      playbookObjects: playbooks.map((pb) => ({
        ...pb,
        // The playbook's own file, verbatim. Not re-serialized from the parsed
        // object: the point of showing it is that this IS the playbook, so it
        // has to be the bytes on disk, comments and spacing and all.
        source: readFileSync(join(dir, `${pb.id}.md`), "utf8"),
        sourcePath: join(dir, `${pb.id}.md`),
        lint: lintPlaybook(pb),
      })),
    };
  });

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "packs.json"), JSON.stringify({ packs }, null, 2));
  console.log(`  web/packs.json — ${packs.length} pack(s), ${packs.reduce((n, p) => n + p.playbookObjects.length, 0)} playbook(s)`);
}

main();

// Bundle the runner for the browser. coach + classify import only TYPES from
// schema, so zod never reaches the bundle and this stays dependency-free.
await build({
  entryPoints: ["src/browser.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: join(OUT, "runner.js"),
  logLevel: "warning",
});
console.log(`  web/runner.js — browser bundle`);
