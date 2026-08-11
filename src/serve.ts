import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

// A static file server for the built demo, and nothing more.
//
// The demo used to run behind an API. It doesn't need one: parsing packs doesn't
// depend on anything the user types, and stepping a transcript is pure, so the first
// happens at build time and the second happens in the browser.
//
// The reason to care is deployment. What this serves locally is byte-for-byte what
// gets deployed, so "worked on my laptop, broken on the shared link" isn't a failure
// mode that exists. Run `npm run build:web` first, or just `npm run web`, which does.

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function startServer(opts: { port: number; dir?: string }): void {
  const root = opts.dir ?? "web";
  if (!existsSync(join(root, "packs.json"))) {
    console.error(`\n  ${root}/packs.json is missing. Run:  npm run build:web\n`);
    process.exit(1);
  }

  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    // normalize() collapses "..", so a request can't climb out of the served
    // directory. This goes behind a public tunnel, so that matters.
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const file = join(root, safe === "/" || safe === "\\" ? "index.html" : safe);

    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(readFileSync(file));
  });

  // Port fallback.
  //
  // The default failure is an unhandled 'error' event: a raw stack trace, and an
  // exit. That's the worst outcome for this program, because the one moment it
  // runs is in front of an audience, and the likeliest cause is a copy from five
  // minutes ago still holding the port — meaning it would have worked fine
  // anywhere else. A busy port is not an error, it's a different port.
  const MAX_TRIES = 10;

  const listen = (port: number, attempt: number): void => {
    // Both listeners are registered explicitly and BOTH are torn down before a
    // retry. Passing the success callback to server.listen() looks tidier but
    // leaks: a failed listen does not remove it, so after stepping forward one
    // port the stale callback still fires and announces the port that never
    // bound. That prints a dead URL, which on a shared link is worse than a crash.
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
      console.log(`\n  Playbook Packs demo`);
      console.log(`  http://localhost:${port}\n`);
      console.log(`  Share it (no account needed):`);
      console.log(`    npx -y cloudflared tunnel --url http://localhost:${port}\n`);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  };

  listen(opts.port, 0);
}
