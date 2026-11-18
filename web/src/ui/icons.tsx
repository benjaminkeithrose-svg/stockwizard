// Inline icons, so the app needs no icon font and works offline.

const P = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Back = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M15 5l-7 7 7 7" /></svg>
);
export const Home = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" /></svg>
);
export const MenuIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const Dots = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></g></svg>
);
export const Plus = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M12 5v14M5 12h14" /></svg>
);
export const Close = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M6 6l12 12M18 6L6 18" /></svg>
);
export const Search = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><circle {...P} cx="11" cy="11" r="6" /><path {...P} d="M20 20l-4.5-4.5" /></svg>
);
export const Bin = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>
);
export const Indicators = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M3 17l5-6 4 3 4-7 5 5" /><path {...P} d="M3 21h18" /></svg>
);
export const Pencil = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 20l4-1 11-11-3-3L5 16l-1 4z" /></svg>
);
export const List = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>
);
export const Radar = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><circle {...P} cx="12" cy="12" r="8" /><circle {...P} cx="12" cy="12" r="4" /><path {...P} d="M12 12l6-6" /></svg>
);
export const Grid = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><rect {...P} x="3" y="3" width="8" height="8" rx="1.5" /><rect {...P} x="13" y="3" width="8" height="8" rx="1.5" /><rect {...P} x="3" y="13" width="8" height="8" rx="1.5" /><rect {...P} x="13" y="13" width="8" height="8" rx="1.5" /></svg>
);
export const Flask = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7.5 14h9" /></svg>
);
export const Spark = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" /></svg>
);
export const Star = ({ filled }: { filled?: boolean }) => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path {...P} fill={filled ? "currentColor" : "none"} d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>
);
/** Options: a short strike between two wings. */
export const Legs = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M3 5h18M3 19h18" strokeDasharray="2 3" /><path {...P} d="M3 9h18M3 15h18" /></svg>
);
