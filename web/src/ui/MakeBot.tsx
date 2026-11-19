// "Make a bot" at the top of a backtest page: opens the bot sheet already
// filled in from that test. Saved switched off, in Trading, Automated strategies.
// When the bot can't run what was tested, the button is off and says why.

import { useState } from "react";
import type { BotDraft } from "../data/bots";
import type { Store } from "../data/store";
import { BotSheet } from "./Strategies";

export default function MakeBot({ store, draft }: { store: Store; draft: BotDraft }) {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (!draft.ok) {
    return (
      <>
        <p className="hint">Can't be automated: {draft.why}</p>
      </>
    );
  }
  return (
    <>
      <button className="big" onClick={() => { setSaid(null); setOpen(true); }}>Start paper trading</button>
      {said && <div className="msg ok" role="status">{said}</div>}
      {open && (
        <BotSheet strategy={draft.bot} onClose={() => setOpen(false)}
          onDone={(b) => store.saveBotStrategy(b)
            .then(() => setSaid(`Saved, switched off. To start it: the Lab's Paper trading tab (or Trading), then its switch.`))
            .catch((e) => setSaid(`Couldn't save: ${e.message ?? e}`))} />
      )}
    </>
  );
}
