// One line on Today and Safety: what the PC that runs your bot is doing, refreshed every 30 seconds.

import { useEffect, useState } from "react";
import { describePc, PcStatus } from "../data/pcStatus";
import type { Store } from "../data/store";

export default function PcStatusLine({ store }: { store: Store }) {
  const [status, setStatus] = useState<PcStatus | null | undefined>(undefined);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const load = () => { setNow(new Date()); store.pcStatus().then(setStatus).catch(() => { /* offline: keep what's shown */ }); };
    load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [store]);
  if (status === undefined) return null;
  const d = describePc(status, now);
  return <div className={`msg ${d.kind}`} role="status">{d.text}</div>;
}
