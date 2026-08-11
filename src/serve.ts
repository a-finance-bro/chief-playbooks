import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack } from "./parse.js";
import { initState, parseTranscript, stepRules, type CoachCard } from "./coach.js";
import { suggestPack } from "./classify.js";
import { lintPlaybook } from "./lint.js";
import { toJSON, toMarkdown } from "./convert.js";
import type { LoadedPack, Playbook } from "./schema.js";

// A shareable web view of the coaching loop.
//
// Design constraint that drives everything here: this gets put behind a tunnel and
// several people open it AT ONCE. So the server holds no session state. It computes
// the entire timeline for a transcript in one shot and hands it to the browser, which
// then scrubs through it locally.
//
// That means every viewer gets an independent playhead, nobody's scrubbing yanks
// anyone else's screen around, and a reload costs nothing. It also makes the demo
// scrubbable in both directions, which a live-stepping server couldn't do.
//
// Node's http + zero dependencies, deliberately: a demo that needs an install step is
// a demo that fails in front of people.

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = existsSync(join(HERE, "..", "web")) ? join(HERE, "..", "web") : join(HERE, "web");

export type Frame = {
  i: number;
  speaker: string;
  text: string;
  card: CoachCard;
};

// Precompute every frame of the replay. Pure: same transcript in, same frames out.
export function buildTimeline(pb: Playbook, transcript: string): Frame[] {
  const state = initState(pb);
  const frames: Frame[] = [];
  parseTranscript(transcript).forEach((u, i) => {
    const card = stepRules(pb, state, u);
    frames.push({
      i,
      speaker: u.speaker,
      text: u.text,
      // Deep copy: stepRules mutates shared state, so storing the live object
      // would leave every frame showing the FINAL card.
      card: JSON.parse(JSON.stringify(card)) as CoachCard,
    });
  });
  return frames;
}

function discoverPacks(packsDir: string): LoadedPack[] {
  if (!existsSync(packsDir)) return [];
  return readdirSync(packsDir)
    .map((d) => join(packsDir, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "pack.yaml")))
    .map((d) => loadPack(d));
}

function fixtureFor(p: LoadedPack): string {
  const dir = join(p.dir, "fixtures");
  if (!existsSync(dir)) return "";
  const first = readdirSync(dir).find((f) => f.endsWith(".txt"));
  return first ? readFileSync(join(dir, first), "utf8") : "";
}

const json = (res: ServerResponse, code: number, body: unknown): void => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(s);
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    // A public tunnel is a public endpoint. Cap the body so an oversized paste
    // can't sit the process down.
    if (size > 512_000) throw new Error("Transcript too large (512KB max).");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function startServer(opts: { port: number; packsDir: string }): void {
  const packs = discoverPacks(opts.packsDir);
  if (packs.length === 0) throw new Error(`No packs found in ${opts.packsDir}`);

  const findPlaybook = (packId?: string, playbookId?: string): { pack: LoadedPack; pb: Playbook } => {
    const pack = packs.find((p) => p.pack.id === packId) ?? packs[0]!;
    const pb = (playbookId ? pack.playbooks.find((p) => p.id === playbookId) : pack.playbooks[0]) ?? pack.playbooks[0]!;
    return { pack, pb };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(join(WEB_DIR, "index.html")));
        return;
      }

      // Everything the UI needs to render, in one request.
      if (url.pathname === "/api/packs") {
        return json(res, 200, {
          packs: packs.map((p) => ({
            id: p.pack.id,
            title: p.pack.title,
            version: p.pack.version,
            summary: p.pack.summary,
            callTypes: p.pack.call_types,
            fixture: fixtureFor(p),
            playbooks: p.playbooks.map((pb) => ({
              id: pb.id,
              title: pb.title,
              version: pb.version,
              objective: pb.objective,
              successCriteria: pb.successCriteria,
              whenToUse: pb.whenToUse,
              persona: pb.persona,
              skills: pb.skills,
              steps: pb.steps.length,
              outputs: pb.outputs,
              signals: pb.signals,
              principles: pb.principles,
              lint: lintPlaybook(pb),
            })),
          })),
        });
      }

      if (url.pathname === "/api/timeline" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          packId?: string;
          playbookId?: string;
          transcript?: string;
        };
        const { pack, pb } = findPlaybook(body.packId, body.playbookId);
        const transcript = body.transcript?.trim() ? body.transcript : fixtureFor(pack);
        return json(res, 200, { playbookId: pb.id, frames: buildTimeline(pb, transcript) });
      }

      if (url.pathname === "/api/suggest" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { transcript?: string };
        return json(res, 200, { suggestions: suggestPack(packs, body.transcript ?? "") });
      }

      if (url.pathname === "/api/export") {
        const { pb } = findPlaybook(url.searchParams.get("pack") ?? undefined, url.searchParams.get("playbook") ?? undefined);
        const fmt = url.searchParams.get("format") ?? "json";
        return json(res, 200, { format: fmt, text: fmt === "md" ? toMarkdown(pb) : toJSON(pb) });
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
  });

  // Port fallback.
  //
  // The default failure here is an unhandled 'error' event, which dumps a Node
  // stack trace and exits. That is the single worst thing that can happen to
  // this program, because the one moment it runs is in front of an audience —
  // and "address already in use" is the most likely cause, since it usually
  // means a copy from five minutes ago is still up and the demo would have
  // worked fine on any other port.
  //
  // So a busy port is not an error. Step forward and say which port won.
  const MAX_TRIES = 10;

  const listen = (port: number, attempt: number): void => {
    // Both listeners are registered explicitly and BOTH are torn down before a
    // retry. Passing the success callback to server.listen() instead looks
    // tidier but leaks: a failed listen does not remove it, so after falling
    // forward one port the stale callback still fires and announces the port
    // that never bound. That prints a dead URL, which on a shared demo link is
    // worse than crashing.
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener("listening", onListening);
      if (err.code === "EADDRINUSE" && attempt < MAX_TRIES) {
        server.removeListener("error", onError);
        console.log(`  port ${port} is busy, trying ${port + 1}...`);
        listen(port + 1, attempt + 1);
        return;
      }
      console.error(`\n  Couldn't start the demo: ${err.message}`);
      if (err.code === "EADDRINUSE") {
        console.error(`  Ports ${opts.port}-${port} are all in use.`);
        console.error(`  Free one with:  lsof -ti:${opts.port} | xargs kill`);
        console.error(`  Or pick another: npm run web -- --port 8080\n`);
      } else {
        console.error("");
      }
      process.exit(1);
    };

    const onListening = (): void => {
      server.removeListener("error", onError);
      const packNames = packs.map((p) => p.pack.id).join(", ");
      console.log(`\n  Playbook Packs demo`);
      console.log(`  http://localhost:${port}`);
      console.log(`  packs: ${packNames}\n`);
      console.log(`  Share it (no account needed):`);
      console.log(`    npx -y cloudflared tunnel --url http://localhost:${port}\n`);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  };

  listen(opts.port, 0);
}
