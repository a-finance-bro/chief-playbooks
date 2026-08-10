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
  // A playbook is a *superset of a skill*, not a separate format: the same
  // envelope any other agent object uses, plus the few fields a playbook needs
  // (objective, owning pack, optional persona/skill references). Keeping the
  // discriminator explicit lets a host store playbooks alongside skills and
  // route on `type` instead of sniffing at the shape.
  type: z.literal("playbook").default("playbook"),
  id: z.string().min(1),
  title: z.string().min(1),
  version: z.string().default("0.0.0"),
  summary: z.string().default(""),
  tags: z.array(z.string()).default([]),
  authors: z.array(z.string()).default([]),
  lineage: z.array(z.string()).default([]),

  // Owning pack id. Set from pack.yaml at load time when a file omits it, so a
  // playbook that gets passed around on its own still knows where it came from.
  pack: z.string().optional(),
  // Who should receive the finished outputs (e.g. a Product Manager persona
  // that turns discovery notes into recommended features). Advisory: a runner
  // without personas ignores it.
  persona: z.string().optional(),
  // Named capabilities a runner may use while executing this playbook.
  skills: z.array(z.string()).default([]),
  // Cues that let a host classify a conversation and offer the right pack
  // BEFORE it's applied. Prose, matched by a model, not a rules engine.
  whenToUse: z.array(z.string()).default([]),

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
  // Conversation types this pack covers. A host classifies the call early and
  // offers the matching pack; this is what it matches against, so it can rank
  // packs without parsing every playbook inside them.
  call_types: z.array(z.string()).default([]),
  playbooks: z.array(z.string()).min(1, "a pack must list at least one playbook"),
  authors: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});
export type Pack = z.infer<typeof PackSchema>;

export type LoadedPack = { pack: Pack; playbooks: Playbook[]; dir: string };
