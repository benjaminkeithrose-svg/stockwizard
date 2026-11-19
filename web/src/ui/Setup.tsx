// Setup (Menu, Setup; Ben, 19 Nov 2026): everything the installer used to ask, inside the app,
// one step at a time, each skippable and open again at any time. Opened by itself the first
// time the installed program has nothing set up. Inside the PC program it saves straight to
// the PC's settings through the bridge (data/pc.ts) and makes the access key itself, so
// nothing is copied and pasted; in a browser or on the phone it shows the PC steps instead.

import { useEffect, useState } from "react";
import { Job, JOB_LABELS, Monitor, pcBridge, PcSettings, PcState, setJob, SETUP_SEEN } from "../data/pc";
import type { Store } from "../data/store";
import { Info } from "./parts";

const GUIDE = "https://github.com/benjaminkeithrose-svg/stockwizard/blob/main/docs/SETUP.md";
const RELEASES = "https://github.com/benjaminkeithrose-svg/stockwizard/releases/latest";
type Step = "key" | "tws" | "prices" | "screens" | "done";
const STEPS: [Step, string][] = [["key", "Connect"], ["tws", "TWS"], ["prices", "Prices"], ["screens", "Screens"], ["done", "Done"]];

type Bridge = NonNullable<Awaited<ReturnType<typeof pcBridge>>>;

export default function SetupScreen(props: { store: Store; onAccessKey: () => void; onFinish: () => void }) {
  const { store } = props;
  const [pc, setPc] = useState<Bridge | null | undefined>(undefined);
  const [s, setS] = useState<PcSettings | null>(null);
  const [state, setState] = useState<PcState | null>(null);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [step, setStep] = useState<Step>("key");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  useEffect(() => { pcBridge().then(setPc); }, []);
  const reload = async (b: Bridge) => { setS(await b.load()); setState(await b.status()); };
  useEffect(() => {
    if (!pc) return;
    reload(pc).catch((e) => setMsg({ kind: "err", text: String(e) }));
    pc.monitors().then(setMonitors).catch(() => setMonitors([]));
  }, [pc]);
  useEffect(() => { setMsg(null); }, [step]);

  const steps = STEPS.filter(([k]) => k !== "screens" || pc);
  const at = steps.findIndex(([k]) => k === step);
  const next = () => setStep(steps[Math.min(at + 1, steps.length - 1)][0]);
  const finish = () => { try { localStorage.setItem(SETUP_SEEN, "1"); } catch { /* fine */ } props.onFinish(); };

  const save = async (change: Partial<{ connection: string; delayed: boolean; ntfy_topic: string; run_data: boolean | null }>) => {
    if (!pc || !s) return;
    const r = await pc.save({ connection: s.connection, delayed: s.delayed, ntfy_topic: s.ntfy_topic, run_data: s.run_data, ...change });
    if (r.error) setMsg({ kind: "err", text: r.error }); else await reload(pc);
  };

  const connect = async () => {
    if (!pc) return;
    setBusy(true);
    setMsg(null);
    try {
      const key = await store.makeBotKey();
      const r = await pc.set_key(key);
      if (r.error) throw new Error(r.error);
      await reload(pc);
      setMsg({ kind: "info", text: "Trading starts as soon as TWS is ready: that's the next step." });
    } catch (e) {
      setMsg({ kind: "err", text: `Couldn't connect: ${(e as Error).message ?? e}` });
    } finally { setBusy(false); }
  };

  const check = async () => {
    if (!pc) return;
    setBusy(true);
    const st = await pc.status().finally(() => setBusy(false));
    setState(st);
    setMsg(st.bot_state === "connected" ? { kind: "ok", text: "Connected to TWS. Trading is ready." }
      : st.tws_open ? { kind: "info", text: "TWS is answering. Stock Wizard connects within a minute: check again shortly." }
      : { kind: "err", text: "TWS isn't answering on this PC. Is it open, logged in to Paper Trading, with the API turned on (steps above)?" });
  };

  if (pc === undefined) return <div className="list"><p className="empty">Loading…</p></div>;

  return (
    <div className="list setup">
      <div className="setupnav">
        {/* While this step's own button hasn't been pressed (Connect this PC), Next steps back so that's the one main action. */}
        <button className={step === "key" && pc && s && !s.configured ? "ghost" : "big"} onClick={step === "done" ? finish : next}>{step === "done" ? "Finish" : "Next"}</button>
        {step !== "done" && <button className="ghost" onClick={next}>Skip for now</button>}
      </div>
      <div className="seg wide" role="tablist" aria-label="Setup steps" style={{ marginTop: 10 }}>
        {steps.map(([k, l], i) => (
          <button key={k} role="tab" aria-selected={k === step} className={k === step ? "on" : ""} onClick={() => setStep(k)}>{i + 1}. {l}</button>
        ))}
      </div>

      {step === "key" && <>
        <h2>Connect this PC to your account <Info term="accesskey" /></h2>
        {!pc ? <>
          <p>Trading runs in Stock Wizard on a Windows PC, next to Interactive Brokers' TWS.</p>
          <ol className="steps">
            <li>On your PC, download <b>StockWizardSetup.exe</b> from <a href={RELEASES} target="_blank" rel="noreferrer">the latest release</a>.</li>
            <li>Open it and click through (it asks nothing).</li>
            <li>Stock Wizard opens. Sign in there, and its Setup connects the PC for you.</li>
          </ol>
          <p className="hint">Already have Stock Wizard on an older PC set-up? <button className="link" onClick={props.onAccessKey}>Make an access key</button> by hand. Full guide: <a href={GUIDE} target="_blank" rel="noreferrer">setup guide</a>.</p>
        </> : s?.uses_secret_key ? (
          <p className="msg ok">This PC uses the secret key (Ben's PC): it's already connected.</p>
        ) : s?.bot_key_set ? <>
          <p className="msg ok">This PC is connected to your account.</p>
          <button className="ghost" disabled={busy} onClick={connect}>Connect again with a new key</button>
          <p className="hint">A new key stops the old one, on any PC that used it.</p>
        </> : <>
          <p>One tap makes this PC's access key and saves it here. Nothing to copy or paste.</p>
          <button className="big" disabled={busy} onClick={connect}>{busy ? "Connecting…" : "Connect this PC"}</button>
        </>}
      </>}

      {step === "tws" && <>
        <h2>Turn on TWS's connection <Info term="tws" /></h2>
        <ol className="steps">
          <li>Open <b>Trader Workstation</b> and log in to <b>Paper Trading</b>.</li>
          <li>In TWS, click <b>File</b>, then <b>Global Configuration</b>.</li>
          <li>On the left, click <b>API</b>, then <b>Settings</b>.</li>
          <li>Tick <b>Enable ActiveX and Socket Clients</b>.</li>
          <li>Untick <b>Read-Only API</b>.</li>
          <li>Check <b>Socket port</b> says <b>7497</b>.</li>
          <li>Tick <b>Allow connections from localhost only</b>, then click <b>Apply</b> and <b>OK</b>.</li>
        </ol>
        {pc && s && <>
          <button className="ghost" disabled={busy} onClick={check}>{busy ? "Checking…" : "Check the connection"}</button>
          <p className="hint">Using IB Gateway instead of TWS?{" "}
            <button className="link" onClick={() => save({ connection: s.connection === "gateway" ? "tws" : "gateway" })}>
              {s.connection === "gateway" ? "Switch back to TWS (port 7497)" : "Switch to IB Gateway (port 4002)"}</button>
          </p>
          {state && !state.ready && <p className="msg info">Connect this PC first (step 1): trading waits until it is.</p>}
        </>}
      </>}

      {step === "prices" && <>
        <h2>Real-time or delayed prices <Info term="delayedprices" /></h2>
        {pc && s ? (
          <div className="seg wide" role="group" aria-label="Prices">
            <button className={!s.delayed ? "on" : ""} aria-pressed={!s.delayed} onClick={() => save({ delayed: false })}>Real-time</button>
            <button className={s.delayed ? "on" : ""} aria-pressed={s.delayed} onClick={() => save({ delayed: true })}>Delayed (no subscription)</button>
          </div>
        ) : <p className="hint">Set on the PC, in Stock Wizard's Setup.</p>}
        <h2>Phone notifications <Info term="ntfy" /></h2>
        {pc && s ? <>
          <label htmlFor="setup-ntfy">ntfy topic (optional)</label>
          <input id="setup-ntfy" defaultValue={s.ntfy_topic} placeholder="e.g. sw-k3x9-orders" onBlur={(e) => e.target.value !== s.ntfy_topic && save({ ntfy_topic: e.target.value.trim() })} />
          <p className="hint">Install the free ntfy app on your phone, subscribe to a hard-to-guess topic name, and type the same name here.</p>
        </> : <p className="hint">Set on the PC, in Stock Wizard's Setup.</p>}
        {pc && s?.uses_secret_key && <>
          <h2>Market data for everyone <Info term="marketdata" /></h2>
          <div className="seg wide" role="group" aria-label="Market data">
            <button className={s.run_data ? "on" : ""} aria-pressed={!!s.run_data} onClick={() => save({ run_data: true })}>This PC supplies it</button>
            <button className={!s.run_data ? "on" : ""} aria-pressed={!s.run_data} onClick={() => save({ run_data: false })}>Off</button>
          </div>
        </>}
      </>}

      {step === "screens" && pc && s && <>
        <h2>What each screen shows <Info term="screens" /></h2>
        {!monitors.length ? <p className="empty">No screens found.</p> : monitors.map((m) => {
          const job = s.screens[String(m.index)] ?? null;
          const pick = async (j: Job | null) => {
            const r = await pc.set_screens(setJob(s.screens, m.index, j));
            if (r.error) setMsg({ kind: "err", text: r.error }); else await reload(pc);
          };
          return (
            <div key={m.index} className="card">
              <div className="cmain">
                <div className="t">Screen {m.index + 1} <span className="meta">{m.width} × {m.height}{m.x === 0 && m.y === 0 ? " · main display" : ""}</span></div>
                <div className="chips" style={{ marginTop: 8 }}>
                  {(Object.keys(JOB_LABELS) as Job[]).map((j) => (
                    <button key={j} className={`chip${job === j ? " on" : ""}`} aria-pressed={job === j} onClick={() => pick(job === j ? null : j)}>{JOB_LABELS[j]}</button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <p className="hint">Tap a job again to clear it. A screen with no job shows nothing extra. Stock Wizard opens a window on each screen with a job, now and whenever it opens.</p>
      </>}

      {step === "done" && <>
        <h2>All set</h2>
        <ul className="steps">
          <li>{!pc ? "Connect a PC from Stock Wizard on Windows." : s?.configured ? "This PC is connected." : "This PC isn't connected yet (step 1): it won't trade."}</li>
          <li>Set your limits before trading: Menu, Safety and limits.</li>
          <li>Change any of this later: Menu, Setup.</li>
        </ul>
      </>}

      {msg && <div className={`msg ${msg.kind}`} style={{ marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}
