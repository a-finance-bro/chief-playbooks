import { startServer } from "./serve.js";

// Entry point for `npm run web`. Port and packs dir are overridable so the demo
// can run next to something else that already owns 3000.
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

startServer({
  port: Number(arg("port") ?? process.env.PORT ?? 4000),
  dir: arg("dir") ?? "web",
});
