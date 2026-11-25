/* 24px line icons (stroke = currentColor). Decorative: the nav label carries the meaning. */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const IconHome = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" /></svg>;
export const IconCase = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path {...P} d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
export const IconWallet = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z" /><path {...P} d="M4 7V6a2 2 0 0 1 2-2h10v3M16 13.5h2" /></svg>;
export const IconMore = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} /></svg>;
