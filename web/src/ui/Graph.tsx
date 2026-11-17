// A small line graph drawn as SVG, for the options analysis (the candle chart
// library only plots against time, not price). Lines over a shared x axis,
// profit shaded green and loss red under the main line, optional marker
// lines and a shaded band, and a readout of every line's value under the
// pointer or finger.

import { useEffect, useMemo, useRef, useState } from "react";

export interface Series {
  label: string;
  colour: string;
  ys: number[];
  width?: number;
  dashed?: boolean;
  /** Shade profit and loss between this line and zero. */
  fill?: boolean;
}

export interface Marker { x: number; label: string; colour: string; dashed?: boolean; /** Label at the top instead of the bottom. */ top?: boolean }

const PAD = { l: 52, r: 10, t: 10, b: 24 };
const PROFIT = "#237F35", LOSS = "#B2232F";

function ticks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

export default function Graph(props: {
  xs: number[];
  series: Series[];
  height: number;
  xFmt: (x: number) => string;
  yFmt: (y: number) => string;
  markers?: Marker[];
  band?: { from: number; to: number; label: string };
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    setW(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);

  const { xs, series, height: h } = props;
  const [x0, x1] = [xs[0], xs[xs.length - 1]];
  const [y0, y1] = useMemo(() => {
    const all = series.flatMap((s) => s.ys).filter(Number.isFinite);
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    const pad = (hi - lo || 1) * 0.08;
    lo -= pad; hi += pad;
    return [lo, hi];
  }, [series]);
  const X = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (w - PAD.l - PAD.r);
  const Y = (y: number) => PAD.t + ((y1 - y) / (y1 - y0 || 1)) * (h - PAD.t - PAD.b);
  const path = (ys: number[]) => ys.map((y, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(y).toFixed(1)}`).join("");
  const zero = Y(0);

  const fillSeries = series.find((s) => s.fill);
  const area = (ys: number[], profit: boolean) => {
    const clip = ys.map((y) => (profit ? Math.max(0, y) : Math.min(0, y)));
    return `${path(clip)}L${X(x1).toFixed(1)},${zero.toFixed(1)}L${X(x0).toFixed(1)},${zero.toFixed(1)}Z`;
  };

  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const x = x0 + ((clientX - r.left - PAD.l) / (w - PAD.l - PAD.r)) * (x1 - x0);
    let best = 0;
    xs.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i; });
    setHover(best);
  };

  return (
    <div className="graph" ref={box}>
      <div className="readout" aria-live="polite">
        {hover === null ? <span className="hint" style={{ margin: 0 }}>{props.label}</span> : (
          <>
            <b>{props.xFmt(xs[hover])}</b>
            {series.map((s) => <span key={s.label} style={{ color: s.colour }}>{s.label} {props.yFmt(s.ys[hover])}</span>)}
          </>
        )}
      </div>
      <svg width={w} height={h} role="img" aria-label={props.label}
        onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}
        style={{ touchAction: "pan-y", display: "block" }}>
        {props.band && (
          <g>
            <rect x={X(Math.max(x0, props.band.from))} y={PAD.t} width={Math.max(0, X(Math.min(x1, props.band.to)) - X(Math.max(x0, props.band.from)))}
              height={h - PAD.t - PAD.b} fill="#E36C00" opacity={0.07} />
            <text x={X(Math.max(x0, props.band.from)) + 4} y={PAD.t + 12} fontSize="10" fill="#B85600">{props.band.label}</text>
          </g>
        )}
        {ticks(y0, y1, 5).map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={w - PAD.r} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? "#9A9B9D" : "#EEF1F4"} />
            <text x={PAD.l - 6} y={Y(v) + 3} fontSize="10" textAnchor="end" fill="#77787A">{props.yFmt(v)}</text>
          </g>
        ))}
        {ticks(x0, x1, Math.max(3, Math.floor(w / 90))).map((v) => (
          <text key={`x${v}`} x={X(v)} y={h - 6} fontSize="10" textAnchor="middle" fill="#77787A">{props.xFmt(v)}</text>
        ))}
        {fillSeries && <path d={area(fillSeries.ys, true)} fill={PROFIT} opacity={0.12} />}
        {fillSeries && <path d={area(fillSeries.ys, false)} fill={LOSS} opacity={0.12} />}
        {(props.markers ?? []).map((m, i) => (x0 <= m.x && m.x <= x1) && (
          <g key={i}>
            <line x1={X(m.x)} x2={X(m.x)} y1={PAD.t} y2={h - PAD.b} stroke={m.colour} strokeDasharray={m.dashed ? "3 3" : undefined} />
            <text x={X(m.x) + 3} y={m.top ? PAD.t + 26 : h - PAD.b - 4 - (i % 2) * 11} fontSize="10" fill={m.colour}
              stroke="#fff" strokeWidth={3} paintOrder="stroke">{m.label}</text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.label} d={path(s.ys)} fill="none" stroke={s.colour} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? "5 4" : undefined} />
        ))}
        {hover !== null && (
          <g>
            <line x1={X(xs[hover])} x2={X(xs[hover])} y1={PAD.t} y2={h - PAD.b} stroke="#4D4D4F" strokeWidth={0.5} />
            {series.map((s) => <circle key={s.label} cx={X(xs[hover])} cy={Y(s.ys[hover])} r={3} fill={s.colour} />)}
          </g>
        )}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.label}><i style={{ borderTop: `${s.width ?? 2}px ${s.dashed ? "dashed" : "solid"} ${s.colour}` }} />{s.label}</span>
        ))}
      </div>
    </div>
  );
}
