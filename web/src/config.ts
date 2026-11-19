// The Supabase project the app talks to. The publishable key is meant to be
// public: it only gets what row-level security allows a signed-in user.
// Secret keys never go here.
export const SUPABASE_URL = "https://cxpspihahmztfydvdwpd.supabase.co";
export const SUPABASE_KEY = "sb_publishable_6C3xmFTbEXfkNtt3Xv3Opg_8d0XoGUG";

// Bump with every change, together with CACHE in public/sw.js (a test checks they agree).
export const APP_BUILD = "sw-v50";
