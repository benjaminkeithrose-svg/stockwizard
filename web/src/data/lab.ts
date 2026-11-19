// The Lab (Ben, 19 Nov 2026): one place from an idea to a strategy trading on paper. Each
// tested strategy gets a plain verdict from its held-back years, and a stage on the path
// Idea → Backtested → Paper trading. While trading is paper-only, paper trading a strategy
// and automating it are the same thing: it runs by itself at Interactive Brokers on paper.

import type { BotStrategy } from "./model";

export type Verdict = "held" | "failed" | "few" | "burned" | "none";
export const VERDICTS: Record<Verdict, { label: string; badge: string; why: string }> = {
  held: { label: "Held up", badge: "ok", why: "Made money on average in the held-back years, which it never saw while it was made." },
  failed: { label: "Didn't hold up", badge: "no", why: "Lost money on average in the held-back years: what worked while it was made didn't carry on." },
  few: { label: "Too few to tell", badge: "est", why: "Fewer than 10 trades in the held-back years: not enough to judge either way." },
  burned: { label: "Burned", badge: "est", why: "The held-back years were looked at before a change, so they're no longer a fair test." },
  none: { label: "Not run yet", badge: "est", why: "No backtest has been run for it yet." },
};

/** The held-back years' verdict: burned first, then too few trades, then whether the average trade made money. */
export function verdict(r: { burned?: boolean; trades?: number | null; expectancy?: number | null } | null | undefined): Verdict {
  if (!r) return "none";
  if (r.burned) return "burned";
  if (!r.trades || r.trades < 10 || typeof r.expectancy !== "number") return "few";
  return r.expectancy > 0 ? "held" : "failed";
}

export type Stage = "idea" | "backtested" | "paper";
export const STAGES: [Stage, string][] = [["idea", "Idea"], ["backtested", "Backtested"], ["paper", "Paper trading"]];

/** How far a tested strategy has come: paper trading when an automated strategy made from it is switched on. */
export function stageOf(sourceId: string, bots: BotStrategy[]): Stage {
  return bots.some((b) => b.enabled && b.source?.id === sourceId) ? "paper" : "backtested";
}
