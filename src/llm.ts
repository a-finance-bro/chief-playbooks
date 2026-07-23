import type { Playbook } from "./schema.js";
import type { Utterance, ModelAdvice } from "./coach.js";

// Optional model-driven coaching. Reads the whole transcript-so-far against the
// playbook and returns adaptive guidance. Keyless-friendly by design: no SDK, just a
// fetch to the Anthropic API when ANTHROPIC_API_KEY is set. Any failure (no key,
// network, bad JSON) throws so the caller can fall back to the offline rules engine.
//
// This is the same shape a production runner like Chief would implement; the file
// format it reads is identical to the offline path.

const MODEL = process.env.PLAYBOOK_MODEL || "claude-haiku-4-5-20251001";

export function hasModelKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function buildPrompt(pb: Playbook, transcript: Utterance[]): string {
  const steps = pb.steps
    .map((s) => `#${s.index} ${s.title} — goal: ${s.goal} | advance when: ${s.advanceWhen}`)
    .join("\n");
  const outputs = pb.outputs.map((o, i) => `[${i}] ${o}`).join("\n");
  const convo = transcript.map((u) => `${u.speaker}: ${u.text}`).join("\n");
  return `You are a live coach for a "${pb.title}" conversation, running an open playbook.

OBJECTIVE
${pb.objective}

STEPS
${steps}

OUTPUTS TO CAPTURE (index them)
${outputs}

TRANSCRIPT SO FAR
${convo}

Based ONLY on what has actually been said, return a single JSON object (no prose, no
code fences) of exactly this shape:
{
  "stepIndex": <0-based index of the step the interviewer should be on NOW>,
  "outputsDone": [<indices of outputs that the transcript has already captured>],
  "nextAsks": ["<1-3 specific next questions tailored to what was just said>"],
  "avoidNow": ["<0-2 things to NOT do given the current moment>"],
  "rationale": "<one short sentence on why>"
}`;
}

function extractJson(text: string): unknown {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) throw new Error("no JSON object in model response");
  return JSON.parse(text.slice(a, b + 1));
}

export async function adviseWithModel(pb: Playbook, transcript: Utterance[]): Promise<ModelAdvice> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: "user", content: buildPrompt(pb, transcript) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  const raw = extractJson(data.content?.[0]?.text ?? "");
  const o = raw as Record<string, unknown>;
  return {
    stepIndex: typeof o.stepIndex === "number" ? o.stepIndex : 0,
    outputsDone: Array.isArray(o.outputsDone) ? o.outputsDone.filter((n): n is number => typeof n === "number") : [],
    nextAsks: Array.isArray(o.nextAsks) ? o.nextAsks.filter((s): s is string => typeof s === "string") : [],
    avoidNow: Array.isArray(o.avoidNow) ? o.avoidNow.filter((s): s is string => typeof s === "string") : [],
    rationale: typeof o.rationale === "string" ? o.rationale : "",
  };
}
