// The conversation with Claude, as the Messages API shapes it. Kept in this
// browser and sent unchanged each time: Claude's thinking blocks must go back
// exactly as they came, so nothing here edits past turns.

export type ClaudeBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown }; // thinking and anything else: kept, not shown

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeBlock[];
}

export type ClaudeAction =
  | { type: "add_indicator"; name: string; params: Record<string, number | string> }
  | { type: "open_backtest"; strategy_id: string };

export interface ClaudeReply {
  added: ClaudeMessage[];
  actions: ClaudeAction[];
  note: string | null;
}

/** What each tool call reads as, in plain words. */
export const TOOL_WORDS: Record<string, string> = {
  list_symbols: "Looked up the symbols",
  get_candles: "Read candles",
  list_indicators: "Looked at the indicator library",
  compute_indicator: "Worked out an indicator",
  add_indicator_to_chart: "Put an indicator on your chart",
  list_scan_rules: "Looked at the scan rules",
  get_scans: "Read the scans",
  create_scan: "Made a new scan",
  get_strategies: "Read the strategies",
  create_strategy: "Made a new strategy",
  run_backtest: "Ran a backtest",
  get_pattern_lab: "Read the pattern lab",
};

/** The exchanges to show, newest first: each is your message and Claude's reply to it. */
export function exchanges(history: ClaudeMessage[]) {
  const out: { asked: string; reply: string[]; did: string[]; index: number }[] = [];
  history.forEach((m, i) => {
    if (m.role === "user" && typeof m.content === "string") out.push({ asked: m.content, reply: [], did: [], index: i });
    else if (m.role === "assistant" && Array.isArray(m.content) && out.length) {
      const cur = out[out.length - 1];
      for (const b of m.content) {
        if (b.type === "text" && typeof (b as { text?: unknown }).text === "string") cur.reply.push((b as { text: string }).text);
        if (b.type === "tool_use") cur.did.push(TOOL_WORDS[(b as { name: string }).name] ?? String((b as { name: string }).name));
      }
    }
  });
  return out.reverse();
}
