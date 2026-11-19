// The Lab's small pieces (Ben, 19 Nov 2026): a strategy's verdict from its held-back years,
// and how far it has come (Idea → Backtested → Paper trading).

import { useEffect, useState } from "react";
import { Stage, STAGES, Verdict, VERDICTS } from "../data/lab";
import type { BotStrategy } from "../data/model";
import type { Store } from "../data/store";

export function VerdictBadge({ v }: { v: Verdict }) {
  const d = VERDICTS[v];
  return <span className={`badge ${d.badge}`} title={d.why}>{d.label}</span>;
}

export function StageLine({ at }: { at: Stage }) {
  const n = STAGES.findIndex(([s]) => s === at);
  return (
    <span className="stages" aria-label={`Stage: ${STAGES[n][1]}`}>
      {STAGES.map(([s, label], i) => <span key={s} className={i < n ? "done" : i === n ? "now" : ""}>{label}</span>)}
    </span>
  );
}

/** The automated strategies, for each card's stage; refreshed when the screen opens. */
export function useBotList(store: Store): BotStrategy[] {
  const [bots, setBots] = useState<BotStrategy[]>([]);
  useEffect(() => { store.botStrategies().then(setBots).catch(() => setBots([])); }, [store]);
  return bots;
}
