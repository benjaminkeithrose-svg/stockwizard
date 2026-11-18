"""The Settings screen of Stock Wizard on the PC (Ben, 18 Nov 2026: one installed program, stage 2).

Replaces editing stockwizard.env in Notepad. `SettingsApi` is what the screen's
buttons call (through pywebview); it reads and writes the same KEY=VALUE file the
bot and installer use, keeps any other lines as they are, and after a save the
supervisor restarts the bot (and data program) with the new settings.

The bot key is never sent back to the screen: it only shows whether one is set.
The data-program switch only appears on a PC with the secret key (Ben's).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

PORTS = {"tws": "7497", "gateway": "4002"}
TOPIC = re.compile(r"^[A-Za-z0-9_-]{0,64}$")
YES = ("1", "yes", "true")


def _read(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []


def _values(lines: list[str]) -> dict[str, str]:
    out = {}
    for line in lines:
        k, sep, v = line.partition("=")
        if sep and k.strip():
            out[k.strip()] = v.strip()
    return out


class SettingsApi:
    def __init__(self, path: Path, on_saved: Callable[[dict[str, str]], None] = lambda s: None):
        self.path, self.on_saved = path, on_saved

    def load(self) -> dict:
        v = _values(_read(self.path))
        key = v.get("BOT_KEY", "")
        ben = bool(v.get("SUPABASE_SECRET_KEY") or v.get("SUPABASE_SECRET_KEY_PROTECTED"))
        return {
            "bot_key_set": key.startswith("swbot1."),
            "uses_secret_key": ben,
            "connection": "gateway" if v.get("IB_PORT") == "4002" else "tws",
            "delayed": v.get("IB_DELAYED", "").lower() in YES,
            "ntfy_topic": v.get("NTFY_TOPIC", ""),
            "run_data": (v.get("RUN_DATA", "").lower() in YES) if ben else None,
        }

    def save(self, form: dict) -> dict:
        """Check and write the settings; {"ok": True} or {"error": what to fix}."""
        key = str(form.get("bot_key") or "").strip()
        if key and not key.startswith("swbot1."):
            return {"error": "That isn't an access key. Copy the whole key from the app (Menu, Access key): it starts with swbot1."}
        connection = form.get("connection", "tws")
        if connection not in PORTS:
            return {"error": "Choose TWS or IB Gateway."}
        topic = str(form.get("ntfy_topic") or "").strip()
        if not TOPIC.match(topic):
            return {"error": "The ntfy topic can only have letters, numbers, - and _ (up to 64)."}
        lines = _read(self.path)
        current = _values(lines)
        secret = current.get("SUPABASE_SECRET_KEY") or current.get("SUPABASE_SECRET_KEY_PROTECTED")
        if not key and not current.get("BOT_KEY") and not secret:
            return {"error": "Paste your access key: make one in the app (Menu, Access key)."}
        new = {"IB_PORT": PORTS[connection], "IB_DELAYED": "1" if form.get("delayed") else "0", "NTFY_TOPIC": topic}
        if key:
            new["BOT_KEY"] = key
        if secret and form.get("run_data") is not None:
            new["RUN_DATA"] = "1" if form.get("run_data") else "0"
        kept = [ln for ln in lines if ln.partition("=")[0].strip() not in new and ln.strip()]
        out = kept + [f"{k}={v}" for k, v in new.items() if v != "" or k != "NTFY_TOPIC"]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
        tmp.replace(self.path)
        self.on_saved(_values(out))
        return {"ok": True}


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Stock Wizard settings</title>
<style>
  :root { --bg:#F4F6F8; --card:#fff; --edge:#E2E6EA; --text:#1F2933; --muted:#6B7785; --accent:#00287B; --ok:#1E6B2E; --ok-lt:#E3F2E6;
          --warn:#8A4B00; --warn-lt:#FFF1DC; --err:#B2232F; --err-lt:#FBE7E9; --info:#0B5C73; --info-lt:#E2F3F8; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px system-ui, "Segoe UI", sans-serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 14px 16px 24px; }
  button.done { width: 100%; min-height: 44px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 700; font-size: 16px; cursor: pointer; }
  h2 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 20px 0 6px; }
  .card { background: var(--card); border: 1px solid var(--edge); border-left: 3px solid var(--accent); border-radius: 8px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,.03); }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  input[type=text], input[type=password] { width: 100%; min-height: 40px; font-size: 16px; padding: 8px 10px; border: 1px solid var(--edge); border-radius: 6px; }
  .hint { color: var(--muted); font-size: 13px; margin-top: 6px; }
  .seg { display: flex; border: 1px solid var(--accent); border-radius: 8px; overflow: hidden; }
  .seg button { flex: 1; min-height: 40px; border: 0; background: #fff; color: var(--accent); font-size: 15px; cursor: pointer; }
  .seg button.on { background: #E6EBF5; font-weight: 700; }
  .check { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; min-height: 40px; cursor: pointer; }
  .check input { width: 20px; height: 20px; margin-top: 1px; }
  .msg { border-radius: 6px; padding: 9px 11px; margin-top: 10px; font-size: 14px; }
  .msg.ok { background: var(--ok-lt); color: var(--ok); } .msg.err { background: var(--err-lt); color: var(--err); }
  .msg.info { background: var(--info-lt); color: var(--info); }
  [hidden] { display: none !important; }
</style></head>
<body><div class="wrap">
  <button class="done" id="done">Done</button>
  <div id="msg" class="msg" hidden></div>

  <h2>Access key</h2>
  <div class="card">
    <label for="key">Access key</label>
    <input id="key" type="password" autocomplete="off" placeholder="Paste a new key, or leave empty to keep yours">
    <div class="hint" id="keyhint"></div>
  </div>

  <h2>Interactive Brokers</h2>
  <div class="card">
    <label>Which program do you log in to?</label>
    <div class="seg" role="group" aria-label="Interactive Brokers program">
      <button id="tws" type="button">TWS (port 7497)</button><button id="gateway" type="button">IB Gateway (port 4002)</button>
    </div>
    <label class="check" style="margin-top:12px"><input id="delayed" type="checkbox">
      <span>No real-time options data: use delayed prices (about 15 minutes late)</span></label>
  </div>

  <h2>Phone notifications</h2>
  <div class="card">
    <label for="topic">ntfy topic (optional)</label>
    <input id="topic" type="text" autocomplete="off" placeholder="A hard-to-guess name, the same as in the ntfy app">
    <div class="hint">Leave empty for no phone notifications.</div>
  </div>

  <div id="dataBox" hidden>
    <h2>Market data (this PC only)</h2>
    <div class="card">
      <label class="check"><input id="data" type="checkbox">
        <span>Run the data program: candles and live bars from Interactive Brokers for everyone</span></label>
    </div>
  </div>
  <p class="hint">Done saves, reconnects with the new settings, then closes this window.</p>
</div>
<script>
  let conn = "tws";
  const $ = (id) => document.getElementById(id);
  const setConn = (c) => { conn = c; $("tws").classList.toggle("on", c === "tws"); $("gateway").classList.toggle("on", c === "gateway");
    $("tws").setAttribute("aria-pressed", c === "tws"); $("gateway").setAttribute("aria-pressed", c === "gateway"); };
  const show = (kind, text) => { const m = $("msg"); m.className = "msg " + kind; m.textContent = text; m.hidden = false; };
  $("tws").onclick = () => setConn("tws");
  $("gateway").onclick = () => setConn("gateway");
  window.addEventListener("pywebviewready", async () => {
    const s = await window.pywebview.api.load();
    $("keyhint").textContent = s.bot_key_set ? "An access key is set. Paste a new one only if you made a new key in the app."
      : s.uses_secret_key ? "This PC uses the secret key (Ben's PC): no access key needed."
      : "No access key yet: make one in the app (Menu, Access key) and paste it here.";
    setConn(s.connection); $("delayed").checked = s.delayed; $("topic").value = s.ntfy_topic;
    if (s.run_data !== null) { $("dataBox").hidden = false; $("data").checked = s.run_data; }
  });
  $("done").onclick = async () => {
    $("done").disabled = true;
    const r = await window.pywebview.api.save({ bot_key: $("key").value, connection: conn, delayed: $("delayed").checked,
      ntfy_topic: $("topic").value, run_data: $("dataBox").hidden ? null : $("data").checked });
    $("done").disabled = false;
    if (r.error) show("err", r.error); else { show("ok", "Saved. Reconnecting with the new settings."); setTimeout(() => window.pywebview.api.close(), 900); }
  };
</script></body></html>
"""
