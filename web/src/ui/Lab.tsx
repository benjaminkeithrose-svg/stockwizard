// The pattern lab's latest run: how many patterns were tried and how many
// survived each check, then the survivors with their sealed-years result, then
// the patterns that came closest. Discovery numbers saw the future: they are
// never shown as win rates (SPEC.md, Pattern lab).

import { Info } from "./parts";
import { useEffect, useState } from "react";
import type { PatternCandidate, PatternRun } from "../data/model";
import type { Store } from "../data/store";

const pct = (v: number | null | undefined) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "—");
const n = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString() : "—");
const year = (d: string) => d.slice(0, 4);

const WHY: Record<PatternCandidate["status"], string> = {
  survivor: "Passed every check",
  stable: "Passed, but a stronger pattern took its place",
  unstable: "Fell apart when its threshold moved a little",
  not_significant: "Didn't pass the false-discovery check",
  too_rare: "Too few episodes to judge",
};

function Discovery({ c, base }: { c: PatternCandidate; base: number | null }) {
  const d = c.discovery;
  return (
    <div className="meta">
      Discovery (saw the future): {n(d.hits)} of {n(d.episodes)} episodes, {pct(d.rate)} against {pct(base)} on any day
      {typeof d.q === "number" ? ` · false-discovery score ${d.q.toFixed(3)}` : ""}
    </div>
  );
}

const QUESTIONS: [string, string][] = [["spy_up", "SPY up"], ["spy_down", "SPY down"], ["vix_rise", "VIX spike"]];

export default function LabView({ store }: { store: Store }) {
  const [target, setTargetNow] = useState(() => { try { return localStorage.getItem("stockwizard.labQuestion") ?? "spy_up"; } catch { return "spy_up"; } });
  const setTarget = (t: string) => { setTargetNow(t); try { localStorage.setItem("stockwizard.labQuestion", t); } catch { /* fine */ } };
  const [run, setRun] = useState<PatternRun | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => { setRun(undefined); store.latestPatternRun(target).then(setRun).catch((e) => setError(String(e.message ?? e))); }, [store, target]);

  const questions = (
    <div className="seg wide" role="group" aria-label="Question" style={{ marginBottom: 8 }}>
      {QUESTIONS.map(([t, l]) => <button key={t} className={target === t ? "on" : ""} aria-pressed={target === t} onClick={() => setTarget(t)}>{l}</button>)}
    </div>
  );
  if (error) return <div className="msg err">Couldn't load the pattern lab: {error}</div>;
  if (run === undefined) return <>{questions}<p className="empty">Loading…</p></>;
  if (run === null) return <>{questions}<p className="empty">This question hasn't been run yet: Run backtests on Ben's PC runs all three.</p></>;
  const c = run.counts;
  const survivors = run.candidates.filter((x) => x.status === "survivor");
  const others = run.candidates.filter((x) => x.status !== "survivor").slice(0, 12);

  return (
    <>
      {questions}
      <p style={{ margin: "4px 0 8px", fontWeight: 700 }}>{run.question}</p>
      <div className="card" style={{ cursor: "default" }}>
        <div className="cmain" style={{ cursor: "default" }}>
          <div className="labcounts">
            <div><b>{n(c.tried)}</b><span>patterns tried</span></div>
            <div><b>{n(c.enough_episodes)}</b><span>enough episodes</span></div>
            <div><b>{n(c.passed_fdr)}</b><span>passed the false-discovery check</span></div>
            <div><b>{n(c.stable)}</b><span>stable</span></div>
            <div><b>{n(c.survivors)}</b><span>survivors</span></div>
          </div>
          <div className="meta" style={{ marginTop: 8 }}>
            Searched {year(run.start_date)}–{year(run.split_date)}; sealed {year(run.split_date)}–now, used only to test survivors.
            On any day, the target followed {pct(c.base_rate)} of the time in the searched years and {pct(c.sealed_base_rate)} in the sealed years.
          </div>
        </div>
      </div>
      {run.source?.includes("yahoo") && <div className="msg warn">Free, unofficial data: nothing here counts as validated. <Info term="freedata" /></div>}
      {run.sealed_burned && <div className="msg warn">The sealed years were already used with other settings, so the sealed results below are no longer a fair test.</div>}
      <div className="msg info">Discovery numbers saw the future: they show where to look, never what to expect. Only the sealed-years result is a test.</div>

      <h2>Survivors</h2>
      {!survivors.length && <p className="empty">None: no pattern passed every check, so nothing is proven.</p>}
      {survivors.map((x) => (
        <div key={x.n} className="card" style={{ borderLeftColor: "var(--ok)" }}>
          <div className="cmain" style={{ cursor: "default" }}>
            <div className="t">{x.label}</div>
            <Discovery c={x} base={c.base_rate} />
            <div className="meta"><b>Sealed years (blind backtest):</b> {n(x.sealed.hits)} of {n(x.sealed.trades)} trades reached the target, {pct(x.sealed.rate)} against {pct(x.sealed.base_rate)} on any day</div>
          </div>
        </div>
      ))}

      <h2>Closest to passing</h2>
      {!others.length && <p className="empty">None.</p>}
      {others.map((x) => (
        <div key={x.n} className="card">
          <div className="cmain" style={{ cursor: "default" }}>
            <div className="t">{x.label}</div>
            <Discovery c={x} base={c.base_rate} />
            <div className="meta">{WHY[x.status]}{x.status === "not_significant" ? ` (needs ${run.settings.fdr_q} or less)` : ""}</div>
          </div>
        </div>
      ))}
      <p className="hint">Run {run.id} on {new Date(run.ran_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}. Patterns are one or two conditions, from SPY's own measures and candlestick and chart patterns, the VIX, and the linked symbols (QQQ, IWM, NVIDIA, Apple, Tesla) and how they move with SPY. Every one tried is counted, and the bar for proof rises with the count.</p>
    </>
  );
}
