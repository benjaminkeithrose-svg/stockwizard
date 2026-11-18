// Makes (or replaces) the signed-in person's bot key (Ben, 18 Nov 2026: multi-user).
//
// Each person's bot runs on their own PC and signs in to Supabase as their own bot
// account, which the database lets act on that one person's orders and nothing else
// (migration 20261118160000_multi_user.sql). This function makes the bot account with
// a long random password and returns the key once: the account's sign-in packed into
// one string, pasted into the bot's settings as BOT_KEY. Replacing a key deletes the old
// bot account, so a lost key stops working within the hour.
//
// The secret key used here never leaves Supabase.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const b64url = (s: string) => btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json({ error: "Sign in first." }, 401);
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: isBot } = await db.from("bot_accounts").select("owner").eq("bot_user", who.user.id).maybeSingle();
  if (isBot) return json({ error: "A bot account can't make bot keys." }, 403);

  // Replacing: the old bot account goes, and with it the old key.
  const { data: old } = await db.from("bot_accounts").select("bot_user").eq("owner", who.user.id).maybeSingle();
  if (old) {
    const { error } = await db.auth.admin.deleteUser(old.bot_user);
    if (error) return json({ error: `Couldn't remove the old bot key: ${error.message}` }, 500);
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const password = b64url(String.fromCharCode(...bytes));
  const email = `bot-${who.user.id}@stockwizard.invalid`;
  const { data: made, error: makeErr } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { stockwizard_bot_for: who.user.id },
  });
  if (makeErr || !made.user) return json({ error: `Couldn't make the bot account: ${makeErr?.message}` }, 500);
  const { error: mapErr } = await db.from("bot_accounts").insert({ bot_user: made.user.id, owner: who.user.id });
  if (mapErr) {
    await db.auth.admin.deleteUser(made.user.id);
    return json({ error: `Couldn't record the bot account: ${mapErr.message}` }, 500);
  }
  await db.from("audit_log").insert({ actor: "ben", user_id: who.user.id, action: old ? "bot_key_replaced" : "bot_key_made", detail: {} });

  return json({ key: `swbot1.${b64url(JSON.stringify({ e: email, p: password }))}`, made_at: new Date().toISOString(), replaced: !!old });
});
