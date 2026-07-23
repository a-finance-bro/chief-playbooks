import { z } from "zod";

// Canonical shape of a parsed playbook + pack. This is the machine contract behind
// SPEC.md — a runner validates against these so it never has to guess at a file's
// structure. Keep this in lockstep with SPEC.md.

export const StepSchema = z.object({
  index: z.number().int().positive(),
  title: z.string().min(1),
  goal: z.string().default(""),
  ask: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  advanceWhen: z.string().default(""),
});
export type Step = z.infer<typeof StepSchema>;

export const PrincipleSchema = z.object({
  kind: z.enum(["do", "dont"]),
  text: z.string().min(1),
});
export type Principle = z.infer<typeof PrincipleSchema>;

export const SignalSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
});
export type Signal = z.infer<typeof SignalSchema>;

export const PlaybookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  version: z.string().default("0.0.0"),
  summary: z.string().default(""),
  tags: z.array(z.string()).default([]),
  authors: z.array(z.string()).default([]),
  lineage: z.array(z.string()).default([]),
  objective: z.string().min(1),
  successCriteria: z.array(z.string()).default([]),
  principles: z.array(PrincipleSchema).default([]),
  steps: z.array(StepSchema).min(1, "a playbook needs at least one step"),
  signals: z.array(SignalSchema).default([]),
  outputs: z.array(z.string()).min(1, "a playbook needs at least one output"),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

export const PackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  version: z.string().default("0.0.0"),
  summary: z.string().default(""),
  use_cases: z.array(z.string()).default([]),
  playbooks: z.array(z.string()).min(1, "a pack must list at least one playbook"),
  authors: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});
export type Pack = z.infer<typeof PackSchema>;

export type LoadedPack = { pack: Pack; playbooks: Playbook[]; dir: string };
