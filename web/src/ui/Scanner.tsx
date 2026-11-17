// The Scanner: the latest run of each scan, in tabs. Tapping a result opens
// that symbol and timeframe in the current chart tab. No matches is a normal
// finished state, said plainly.

import { useEffect, useMemo, useState } from "react";
import type { Timeframe } from "../data/candles";
import type { ScanDef, ScanResult, ScanRun } from "../data/model";
import type { Store } from "../data/store";

const TABS: [ScanDef["tab"], string][] = [
  ["squeeze_on", "Squeeze on"],
  ["squeeze_fired", "Fired"],
  ["breakout", "Breakouts"],
  ["spy", "SPY"],
  ["custom", "Mine"],
];

const n = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const signed = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${n(v, digits)}`);
const day = (iso: string, tf: Timeframe) =>
  new Date(iso).toLocaleString("en-AU", {
    timeZone: "America/New_York", day: "numeric", month: "short",
    ...(tf === "1d" ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
  });

/** One plain line describing why a result is there. */
export function describe(rule: string, r: ScanResult, params: Record<string, number> = {}): string {
  const v = r.vals;
  const vix = r.context["^VIX"];
  const withVix = (s: string) => (vix !== undefined && vix !== null ? `${s} · VIX ${n(vix, 1)}` : s);
  switch (rule) {
    case "squeeze_on":
      return `On for ${n(v.candles_on, 0)} candle${v.candles_on === 1 ? "" : "s"} · momentum ${signed(v.momentum)}`;
    case "squeeze_fired":
      return `Fired ${r.direction === "down" ? "down" : "up"} · momentum ${signed(v.momentum)}`;
    case "breakout":
      return `${r.direction === "down" ? "Below" : "Above"} the ${params.length ?? 20}-candle ${r.direction === "down" ? "low" : "high"} of ${n(v.level)}` +
        (v.volume_ratio ? ` · volume ${n(v.volume_ratio, 1)}× average` : "");
    case "trend_break":
      return withVix(`Closed ${n(Math.abs(v.below_by_pct ?? 0), 1)}% below the ${params.length ?? 50}-day average`);
    case "drawdown":
      return withVix(`${signed(v.drawdown_pct, 1)}% from the ${params.lookback ?? 60}-day high${v.first_day === 1 ? " · first day" : ""}`);
    case "rsi_divergence":
      return withVix(`New high, RSI ${n(v.rsi, 0)} against ${n(v.earlier_rsi, 0)} at the earlier high`);
    default:
      return "";
  }
}

export default function ScannerScreen(props: { store: Store; onOpen: (symbol: string, tf: Timeframe) => void }) {
  const [scans, setScans] = useState<ScanDef[]>([]);
  const [runs, setRuns] = useState<Record<string, ScanRun>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ScanDef["tab"]>(() => (localStorage.getItem("stockwizard.scanTab") as ScanDef["tab"]) || "squeeze_on");
  const [tf, setTf] = useState<Timeframe>("1d");

  useEffect(() => {
    Promise.all([props.store.scans(), props.store.latestRuns()])
      .then(([s, r]) => { setScans(s); setRuns(r); })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [props.store]);
  useEffect(() => { try { localStorage.setItem("stockwizard.scanTab", tab); } catch { /* fine */ } }, [tab]);

  const inTab = useMemo(() => scans.filter((s) => s.tab === tab).sort((a, b) => a.position - b.position), [scans, tab]);
  const timeframes = [...new Set(inTab.map((s) => s.timeframe))];
  const shown = tab === "spy" || tab === "custom" ? inTab : inTab.filter((s) => s.timeframe === (timeframes.includes(tf) ? tf : timeframes[0]));

  return (
    <div className="list">
      <div className="seg" role="group" aria-label="Scan" style={{ marginBottom: 8 }}>
        {TABS.filter(([id]) => id !== "custom" || scans.some((s) => s.tab === "custom")).map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab !== "spy" && timeframes.length > 1 && (
        <div className="seg" role="group" aria-label="Timeframe" style={{ marginBottom: 8, maxWidth: 200 }}>
          {timeframes.map((t) => (
            <button key={t} className={t === (timeframes.includes(tf) ? tf : timeframes[0]) ? "on" : ""} onClick={() => setTf(t)}>{t}</button>
          ))}
        </div>
      )}
      {error && <div className="msg err">Couldn't load the scans: {error}</div>}
      {loading && <p className="empty">Loading…</p>}
      {!loading && !error && !shown.length && <p className="empty">No scans here.</p>}
      {shown.map((scan) => {
        const run = runs[scan.id];
        return (
          <section key={scan.id}>
            {(tab === "spy" || tab === "custom") && <h2>{scan.label.replace(/^SPY /, "")}</h2>}
            {!run ? (
              <p className="empty">Not run yet. Scans run after each US trading day's close.</p>
            ) : (
              <>
                <div className="hint" style={{ marginTop: tab === "spy" ? 0 : 4 }}>
                  Run {new Date(run.ran_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  {" · "}{run.symbols.length} symbol{run.symbols.length === 1 ? "" : "s"}
                  {run.source === "yahoo-unofficial" && <> · <span className="badge est">Free data source</span></>}
                </div>
                {run.notes && <div className="msg warn">{run.notes}</div>}
                {!run.results.length && <p className="empty">Nothing matched.</p>}
                {run.results.map((r) => (
                  <div key={r.symbol} className="card" style={{ borderLeftColor: r.direction === "down" ? "var(--orange-dk)" : r.direction === "up" ? "var(--ok)" : undefined }}>
                    <button className="cmain" onClick={() => props.onOpen(r.symbol, scan.timeframe)}>
                      <div className="t">{r.symbol} {r.direction === "up" ? "↑" : r.direction === "down" ? "↓" : ""}</div>
                      <div className="meta">{describe(scan.rule, r, scan.params)} · {day(r.candle_ts, scan.timeframe)}</div>
                    </button>
                  </div>
                ))}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
