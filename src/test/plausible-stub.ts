// Test stub for @plausible-analytics/tracker. The real package ships only a
// `module` field (no `main`/`exports`), which Vite's test resolver can't load,
// and analytics are irrelevant to tests — so vite.config aliases it here.
export const track = () => {}
export const init = () => {}
