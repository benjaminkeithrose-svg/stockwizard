// Claude in Stock Wizard: a Supabase function, so the Anthropic key stays on
// the server (secret ANTHROPIC_API_KEY) and only Ben, signed in, can use it.
//
// The app sends the whole conversation each time (kept in the browser) and
// gets back the new turns plus any actions for the app (open a backtest, add
// an indicator). Opus 5.5 with adaptive thinking; refused requests fall back
// to Anthropic's recommended model. At most 100 requests a day (Ben's cap).

import Anthropic from "npm:@anthropic-ai/sdk@1.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { Ctx, runTool, TOOLS } from "./tools.ts";

const MODEL = "claude-opus-5-5";
const DAILY_CAP = 100;
const MAX_STEPS = 10;
const TIME_BUDGET_MS = 120_000; // stop starting new steps after this, to finish inside the function's time limit

const SYSTEM = `You are Claude, built into Stock Wizard, Ben's technical-analysis workspace (charts, a scanner, a bar-by-bar backtester and a pattern lab, backed by Supabase).

Ben is an engineer, not a developer. He often dictates. Be direct and plain: no preamble, short paragraphs, numbers with what they mean. Turn rough spoken requests into precise settings, and say what you set.

What you can do, with your tools: read candles, scans, backtests and the pattern lab; create indicator, scan and strategy settings (always new, never changing old ones); put an indicator on Ben's chart; run backtests and explain them. When Ben describes a test in words, turn it into a strategy or scan and run it.

What you cannot do: place, change or cancel orders; change safety limits, approval mode, the kill switch or paper/live; read keys or credentials; edit the audit log. If asked, say plainly that you can't, and why. Everything you do is written to an audit log Ben can read.

Rules that keep results honest (SPEC.md):
- The backtester's numbers must be a fair forecast. Only the held-back years (from 17 Nov 2021) stand for what to expect; the build years (2006 to 16 Nov 2021) are where rules are made. Always show both, side by side, and say which is which.
- A held-back result far better than the build result is something to investigate, not a win.
- The held-back years are single-use per family of ideas. If Ben tweaks a strategy after seeing its held-back result, put the variation in the same family; the run will be marked burned, and you must say its held-back result is no longer a fair test.
- Pattern-lab discovery numbers saw the future: never present them as win rates.
- Data is from a free, unofficial source: nothing counts as validated. Signal studies on an index (like the VIX) have no costs because the index itself can't be traded.
- Few trades mean wide ranges: quote the likely range for the next 100 trades, not just the rate.
- Never invent numbers. If a tool fails, say so.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const started = Date.now();

  // Who is asking: only a signed-in user, checked with Supabase.
  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json({ error: "Sign in first." }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Claude isn't set up yet: the Anthropic API key hasn't been added to Supabase." }, 503);

  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: allowed, error: capErr } = await db.rpc("claude_take", { p_user: who.user.id, p_limit: DAILY_CAP });
  if (capErr) return json({ error: `Couldn't check today's Claude allowance: ${capErr.message}` }, 500);
  if (!allowed) return json({ error: `That's ${DAILY_CAP} Claude requests today, the daily cap. It resets at midnight Sydney time.` }, 429);

  let body: { messages: Anthropic.Beta.BetaMessageParam[] };
  try {
    body = await req.json();
    if (!Array.isArray(body.messages) || !body.messages.length) throw new Error("no messages");
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const client = new Anthropic({ apiKey });
  const ctx: Ctx = { db, userId: who.user.id, actions: [] };
  const history = [...body.messages];
  const added: Anthropic.Beta.BetaMessageParam[] = [];
  let note: string | null = null;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        tools: TOOLS,
        messages: history,
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);

      // Keep the whole content (thinking blocks included) exactly as returned.
      const turn: Anthropic.Beta.BetaMessageParam = { role: "assistant", content: response.content };
      history.push(turn);
      added.push(turn);

      if (response.stop_reason === "refusal") { note = "Claude declined that request."; break; }
      if (response.stop_reason === "pause_turn") continue;
      if (response.stop_reason === "max_tokens") { note = "Claude's answer was cut short; ask it to continue."; break; }
      if (response.stop_reason !== "tool_use") break;

      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(calls.map(async (call) => {
        try {
          const out = await runTool(call.name, call.input as Record<string, unknown>, ctx);
          return { type: "tool_result" as const, tool_use_id: call.id, content: JSON.stringify(out) };
        } catch (e) {
          return { type: "tool_result" as const, tool_use_id: call.id, content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true };
        }
      }));
      const userTurn: Anthropic.Beta.BetaMessageParam = { role: "user", content: results };
      history.push(userTurn);
      added.push(userTurn);

      if (Date.now() - started > TIME_BUDGET_MS) { note = "Claude ran out of time on this one; say \"carry on\" to let it finish."; break; }
      if (step === MAX_STEPS - 1) note = "Claude reached its step limit on this one; say \"carry on\" to let it finish.";
    }
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Anthropic is busy right now (rate limited). Try again in a minute.", added, actions: ctx.actions }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The Anthropic API key in Supabase was refused. Check it in Supabase's secrets." }, 502);
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API error ${e.status}: ${e.message}`, added, actions: ctx.actions }, 502);
    return json({ error: e instanceof Error ? e.message : String(e), added, actions: ctx.actions }, 500);
  }
  return json({ added, actions: ctx.actions, note });
});
