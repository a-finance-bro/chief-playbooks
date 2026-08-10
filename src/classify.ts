import type { LoadedPack, Playbook } from "./schema.js";

// Pack suggestion: given the opening of a conversation, which pack should a host
// offer?
//
// This runs BEFORE a pack is applied, which is the whole point — by the time
// someone has manually picked a pack, the first few minutes of the call (the
// part a playbook most wants to shape) are already gone.
//
// Deliberately a ranking, not a decision. It returns scored candidates and lets
// the host decide whether to auto-apply, prompt, or ignore. A wrong pack applied
// silently is worse than no pack, because the coaching then steers a real
// conversation toward the wrong objective.
//
// The offline scorer here is a lexical baseline. A production host would hand
// the same `whenToUse` / `call_types` prose to a model; the point of keeping
// them as prose is that both approaches read the same field.

export type PackSuggestion = {
  packId: string;
  playbookId: string;
  score: number;
  matched: string[];
};

const STOP = new Set([
  "a","an","and","are","as","at","be","but","by","for","from","how","i","if","in","is","it",
  "its","me","my","no","not","of","on","or","so","that","the","their","them","then","there",
  "they","this","to","up","use","was","we","what","when","where","which","who","with","you",
  "your","about","just","like","really","actually","tell","get","got","do","does","did","been",
]);

function terms(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

// Score one playbook against the opening transcript.
function scorePlaybook(pb: Playbook, packCallTypes: string[], openingTerms: Set<string>): {
  score: number;
  matched: string[];
} {
  const matched: string[] = [];
  let score = 0;

  // A cue that explicitly rules the playbook OUT is worth more than one that
  // rules it in: "not a demo or a pitch" is precise, while a generic inclusion
  // cue matches half the corpus. Negative cues subtract instead of adding.
  for (const cue of pb.whenToUse) {
    const negative = /^\s*not\b|\bnot a\b/i.test(cue);
    const hits = overlap(terms(cue), openingTerms);
    // A prose cue needs MORE THAN ONE overlapping term. A single shared word is
    // noise: a sprint standup says "go through the board" and a discovery cue
    // says "walk me through your workflow", and "through" alone was enough to
    // suggest a playbook for an unrelated meeting.
    if (hits < 2) continue;
    if (negative) {
      score -= hits * 2;
    } else {
      score += hits;
      matched.push(cue);
    }
  }

  // Pack-level call types are short, high-precision labels ("user interview"),
  // so they're scored differently: most of the label has to appear, but when it
  // does it counts for more than a prose hit.
  for (const ct of packCallTypes) {
    const ctTerms = terms(ct);
    const hits = overlap(ctTerms, openingTerms);
    if (ctTerms.size > 0 && hits * 2 >= ctTerms.size) {
      score += hits * 2;
      matched.push(ct);
    }
  }

  return { score, matched };
}

// Rank packs for an opening transcript. Highest score first; non-positive scores
// are dropped, so "nothing matched" returns an empty list rather than a bad guess.
export function suggestPack(packs: LoadedPack[], opening: string): PackSuggestion[] {
  const openingTerms = terms(opening);
  const out: PackSuggestion[] = [];

  for (const { pack, playbooks } of packs) {
    for (const pb of playbooks) {
      const { score, matched } = scorePlaybook(pb, pack.call_types, openingTerms);
      if (score > 0) {
        out.push({ packId: pack.id, playbookId: pb.id, score, matched });
      }
    }
  }

  return out.sort((a, b) => b.score - a.score || a.playbookId.localeCompare(b.playbookId));
}
