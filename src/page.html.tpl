<title>BIN to MAT Converter</title>
<meta name="description" content="Free online converter for ArduPilot DataFlash logs. Turn .bin and Mission Planner .log files into MATLAB .mat structs in your browser. No upload, no install.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=B612:wght@400;700&family=B612+Mono:wght@400;700&family=Instrument+Sans:wght@400;500;600&display=swap">
<style>
/* Layout: one working column. Intro + drop target on chart-recorder paper,
   then the log workspace (message table | quick look + export), then reference notes. */
:root {
  --bg: #edf1f2;
  --surface: #fbfcfc;
  --surface-2: #e4eaec;
  --line: #cfd8dc;
  --line-strong: #aebcc2;
  --ink: #12202a;
  --ink-2: #4b5c66;
  --ink-3: #7d8d96;
  --accent: #1557c0;
  --accent-ink: #ffffff;
  --accent-soft: #dbe7fb;
  --amber: #8f5f00;
  --amber-soft: #fbefcf;
  --good: #1d7a4c;
  --bad: #b3261e;
  --paper-grid: rgba(21, 87, 120, 0.075);
  --paper-grid-major: rgba(21, 87, 120, 0.14);
  --trace: #1557c0;
  --shadow: 0 1px 2px rgba(18, 32, 42, 0.06), 0 6px 18px -10px rgba(18, 32, 42, 0.18);

  --font-display: "B612", "Segoe UI", system-ui, sans-serif;
  --font-body: "Instrument Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "B612 Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;

  --fs-xs: 0.75rem;
  --fs-sm: 0.875rem;
  --fs-base: 1rem;
  --fs-md: 1.125rem;
  --fs-lg: 1.375rem;
  --fs-xl: 1.75rem;
  --fs-hero: clamp(2rem, 1.2rem + 3.2vw, 3.1rem);
  --radius: 10px;
  --radius-sm: 6px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0c1215;
    --surface: #131b20;
    --surface-2: #1a242a;
    --line: #26343b;
    --line-strong: #3a4c55;
    --ink: #dbe5e9;
    --ink-2: #9aabb3;
    --ink-3: #6d7f88;
    --accent: #78a8ff;
    --accent-ink: #07111f;
    --accent-soft: #17284a;
    --amber: #f0b938;
    --amber-soft: #2c2410;
    --good: #52c58e;
    --bad: #ff8a7e;
    --paper-grid: rgba(140, 200, 225, 0.055);
    --paper-grid-major: rgba(140, 200, 225, 0.1);
    --trace: #78a8ff;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px -12px rgba(0, 0, 0, 0.6);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0c1215;
  --surface: #131b20;
  --surface-2: #1a242a;
  --line: #26343b;
  --line-strong: #3a4c55;
  --ink: #dbe5e9;
  --ink-2: #9aabb3;
  --ink-3: #6d7f88;
  --accent: #78a8ff;
  --accent-ink: #07111f;
  --accent-soft: #17284a;
  --amber: #f0b938;
  --amber-soft: #2c2410;
  --good: #52c58e;
  --bad: #ff8a7e;
  --paper-grid: rgba(140, 200, 225, 0.055);
  --paper-grid-major: rgba(140, 200, 225, 0.1);
  --trace: #78a8ff;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px -12px rgba(0, 0, 0, 0.6);
  color-scheme: dark;
}

*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 400 var(--fs-base)/1.55 var(--font-body);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-underline-offset: 0.18em; }
code, kbd { font-family: var(--font-mono); font-size: 0.9em; }
button, input, select { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
h1, h2, h3 { font-family: var(--font-display); text-wrap: balance; margin: 0; letter-spacing: -0.01em; }

.wrap { max-width: 1180px; margin: 0 auto; padding-inline: clamp(16px, 3vw, 32px); }

/* ---------- top bar ---------- */
.topbar { border-bottom: 1px solid var(--line); background: var(--surface); }
.topbar .wrap { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding-block: 12px; }
.brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); }
.sync {
  font: 700 0.6875rem/1 var(--font-mono); letter-spacing: 0.04em;
  padding: 6px 7px; border-radius: 5px; background: var(--ink); color: var(--surface);
}
.wordmark { font: 700 var(--fs-md)/1 var(--font-display); letter-spacing: 0.02em; }
.wordmark span { color: var(--accent); padding-inline: 0.15em; }
.topbar nav { margin-left: auto; display: flex; gap: 18px; flex-wrap: wrap; font-size: var(--fs-sm); }
.topbar nav a { color: var(--ink-2); text-decoration: none; }
.topbar nav a:hover { color: var(--ink); text-decoration: underline; }

/* ---------- intro ---------- */
.intro {
  display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: clamp(24px, 4vw, 56px);
  align-items: center; padding-block: clamp(28px, 5vw, 56px) clamp(24px, 4vw, 40px);
}
.eyebrow {
  margin: 0 0 14px; font: 700 var(--fs-xs)/1.2 var(--font-mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-2);
}
.eyebrow b { color: var(--accent); font-weight: 700; }
.intro h1 { font-size: var(--fs-hero); line-height: 1.08; }
.lede { margin: 18px 0 0; max-width: 34em; color: var(--ink-2); font-size: var(--fs-md); }
.lede code { color: var(--ink); }
.facts { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 22px 0 0; padding: 0; list-style: none; font-size: var(--fs-sm); color: var(--ink-2); }
.facts li { display: flex; align-items: center; gap: 8px; }
.facts li::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--good); flex: none; }

.drop {
  position: relative; display: grid; place-items: center; text-align: center; gap: 10px;
  min-height: 280px; padding: 32px 24px; border-radius: 14px; cursor: pointer;
  border: 1.5px solid var(--line-strong);
  background-color: var(--surface);
  background-image:
    linear-gradient(var(--paper-grid-major) 1px, transparent 1px),
    linear-gradient(90deg, var(--paper-grid-major) 1px, transparent 1px),
    linear-gradient(var(--paper-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--paper-grid) 1px, transparent 1px);
  background-size: 60px 60px, 60px 60px, 12px 12px, 12px 12px;
  background-position: -1px -1px;
  box-shadow: var(--shadow);
  transition: border-color 0.15s, background-color 0.15s, transform 0.15s;
}
.drop:hover { border-color: var(--accent); }
.drop.is-over { border-color: var(--accent); background-color: var(--accent-soft); transform: scale(1.01); }
.drop-inner { display: grid; justify-items: center; gap: 8px; }
.drop svg { width: 64px; height: 64px; color: var(--accent); }
.drop strong { font: 700 var(--fs-lg)/1.2 var(--font-display); }
.drop .or { color: var(--ink-2); }
.drop .or u { color: var(--accent); text-decoration-thickness: 1.5px; }
.drop-note {
  margin-top: 6px; font: 400 var(--fs-xs)/1.4 var(--font-mono); letter-spacing: 0.04em; color: var(--ink-3);
}
.drop-corner {
  position: absolute; top: 12px; left: 14px; font: 700 0.625rem/1 var(--font-mono); letter-spacing: 0.12em; color: var(--ink-3); text-transform: uppercase;
}
.drop-corner.r { left: auto; right: 14px; }

/* ---------- workspace ---------- */
.workspace { padding-block: 8px 48px; }
.strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 12px; scrollbar-width: thin; }
.chip {
  display: inline-flex; align-items: center; gap: 8px; flex: none; max-width: 300px;
  border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 5px 6px 5px 12px;
  font-size: var(--fs-sm); color: var(--ink-2);
}
.chip.is-active { border-color: var(--accent); color: var(--ink); box-shadow: inset 0 0 0 1px var(--accent); }
.chip-open { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.chip-open:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 999px; }
.chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--ink-3); }
.dot.ready { background: var(--good); }
.dot.busy { background: var(--amber); animation: pulse 1s ease-in-out infinite; }
.dot.error { background: var(--bad); }
@keyframes pulse { 50% { opacity: 0.35; } }
.chip-x {
  all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: var(--ink-3); flex: none;
}
.chip-x:hover { background: var(--surface-2); color: var(--ink); }
.chip-x:focus-visible { outline: 2px solid var(--accent); }

.job { display: grid; gap: 16px; }
.job-head {
  display: grid; gap: 14px; padding: 18px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
}
.job-title { display: flex; align-items: baseline; gap: 10px 12px; flex-wrap: wrap; min-width: 0; }
.job-title h2 { font-size: var(--fs-xl); line-height: 1.15; overflow-wrap: anywhere; min-width: 0; }
.badge {
  font: 700 0.6875rem/1 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase;
  padding: 5px 8px; border-radius: 4px; background: var(--surface-2); color: var(--ink-2); white-space: nowrap;
}
.badge.sample { background: var(--amber-soft); color: var(--amber); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px 24px; margin: 0; }
.stats div { min-width: 0; }
.stats dt { font: 700 0.6875rem/1.3 var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); }
.stats dd { margin: 4px 0 0; font: 400 var(--fs-md)/1.3 var(--font-display); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.note { margin: 0; font-size: var(--fs-sm); color: var(--ink-2); max-width: 70ch; }
.note.warn { color: var(--amber); }
.note.warn::before { content: "▲ "; font-size: 0.8em; }

.job-grid { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.side { display: grid; gap: 16px; min-width: 0; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); min-width: 0; }
.panel-head { display: flex; align-items: center; gap: 10px 12px; flex-wrap: wrap; padding: 14px 16px 12px; border-bottom: 1px solid var(--line); }
.panel-head h3 { font-size: var(--fs-md); }
.panel-head .count { font: 400 var(--fs-xs)/1 var(--font-mono); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.panel-tools { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; align-items: center; }
.search {
  width: 150px; min-width: 0; max-width: 100%; padding: 6px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); font-size: var(--fs-sm);
}
.btn-ghost {
  padding: 6px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: transparent; cursor: pointer; font-size: var(--fs-sm); color: var(--ink-2);
}
.btn-ghost:hover { border-color: var(--line-strong); color: var(--ink); background: var(--surface-2); }

.table-scroll { max-height: 640px; overflow: auto; }
table.types { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.types th {
  position: sticky; top: 0; z-index: 1; background: var(--surface); text-align: left;
  font: 700 0.6875rem/1 var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3);
  padding: 10px 10px; border-bottom: 1px solid var(--line);
}
.types td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.types tr:last-child td { border-bottom: 0; }
.types th.num, .types td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.types td.check, .types th.check { width: 34px; padding-right: 0; }
.types input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); margin: 2px 0 0; cursor: pointer; }
.types tr.is-off td:not(.check) { opacity: 0.45; }
.types tr.is-previewed td { background: var(--accent-soft); }
.tname { all: unset; cursor: pointer; font: 700 var(--fs-sm)/1.2 var(--font-mono); color: var(--ink); }
.tname:hover { color: var(--accent); }
.tname:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
.tfmt { display: block; margin-top: 3px; font: 400 0.6875rem/1.2 var(--font-mono); color: var(--ink-3); letter-spacing: 0.04em; }
.fields { display: flex; flex-wrap: wrap; gap: 4px; }
.f {
  all: unset; font: 400 0.75rem/1 var(--font-mono); padding: 4px 6px; border-radius: 4px; background: var(--surface-2); color: var(--ink-2);
}
button.f { cursor: pointer; }
button.f:hover { background: var(--accent-soft); color: var(--accent); }
button.f:focus-visible { outline: 2px solid var(--accent); }
.f.txt { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
.f.more { background: transparent; color: var(--ink-3); }
.empty-row td { text-align: center; color: var(--ink-3); padding: 28px 10px; }

/* quick look */
.ql-controls { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.select {
  padding: 6px 28px 6px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); font: 400 var(--fs-sm)/1.2 var(--font-mono);
  max-width: 100%;
}
.chart-wrap { position: relative; height: 250px; margin: 12px 12px 4px; }
.chart-wrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.ql-foot {
  display: flex; justify-content: space-between; gap: 6px 16px; flex-wrap: wrap; padding: 4px 16px 14px;
  font: 400 var(--fs-xs)/1.4 var(--font-mono); color: var(--ink-2); font-variant-numeric: tabular-nums;
}
.ql-foot .readout { color: var(--ink); }
.ql-empty { padding: 48px 16px; text-align: center; color: var(--ink-3); font-size: var(--fs-sm); }

/* export */
.export-body { display: grid; gap: 16px; padding: 16px; }
.field-label { display: block; font: 700 0.6875rem/1.3 var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px; }
.name-input { display: flex; align-items: stretch; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); overflow: hidden; }
.name-input input { flex: 1; min-width: 0; border: 0; background: transparent; padding: 9px 10px; font: 400 var(--fs-sm)/1.2 var(--font-mono); }
.name-input input:focus { outline: none; }
.name-input:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
.name-input span { display: grid; place-items: center; padding: 0 10px; color: var(--ink-3); font: 400 var(--fs-sm)/1 var(--font-mono); border-left: 1px solid var(--line); }
.seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 3px; gap: 3px; background: var(--bg); }
.seg label { position: relative; cursor: pointer; }
.seg input { position: absolute; opacity: 0; pointer-events: none; }
.seg span { display: block; padding: 6px 10px; border-radius: 4px; font-size: var(--fs-sm); color: var(--ink-2); }
.seg input:checked + span { background: var(--surface); color: var(--ink); box-shadow: 0 0 0 1px var(--line-strong); font-weight: 600; }
.seg input:focus-visible + span { outline: 2px solid var(--accent); }
.hint { margin: 6px 0 0; font-size: var(--fs-xs); color: var(--ink-3); }
.toggle { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; font-size: var(--fs-sm); }
.toggle input { width: 16px; height: 16px; margin: 3px 0 0; accent-color: var(--accent); flex: none; }
.toggle small { display: block; color: var(--ink-3); font-size: var(--fs-xs); }
.go { display: grid; gap: 10px; }
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  padding: 13px 18px; border: 0; border-radius: var(--radius-sm); cursor: pointer;
  background: var(--accent); color: var(--accent-ink); font: 700 var(--fs-base)/1 var(--font-display); letter-spacing: 0.01em;
}
.btn-primary:hover { filter: brightness(1.08); }
.btn-primary:disabled { cursor: not-allowed; opacity: 0.5; filter: none; }
.btn-primary svg { width: 18px; height: 18px; }
.btn-secondary {
  padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: transparent; cursor: pointer; font-size: var(--fs-sm); font-weight: 600;
}
.btn-secondary:hover { background: var(--surface-2); }
.summary-line { margin: 0; font: 400 var(--fs-xs)/1.5 var(--font-mono); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.console {
  margin: 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2);
  font: 400 0.75rem/1.6 var(--font-mono); color: var(--ink-2); max-height: 150px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
}
.console .ok { color: var(--good); }
.console .err { color: var(--bad); }
.console time { color: var(--ink-3); }

.progress { height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.progress i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: inherit; transition: width 0.12s linear; }
.busy-panel { display: grid; gap: 12px; padding: 22px 20px; }
.busy-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; font-size: var(--fs-sm); color: var(--ink-2); }
.busy-row b { font: 700 var(--fs-sm)/1 var(--font-mono); color: var(--ink); font-variant-numeric: tabular-nums; }
.error-panel { padding: 20px; display: grid; gap: 10px; }
.error-panel p { margin: 0; color: var(--bad); }

/* ---------- reference sections ---------- */
.doc { padding-block: 40px; border-top: 1px solid var(--line); }
.doc h2 { font-size: var(--fs-xl); margin-bottom: 10px; }
.doc > p { margin: 0 0 22px; color: var(--ink-2); max-width: 68ch; }
.doc-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.code { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); min-width: 0; }
.code pre { margin: 0; padding: 16px 18px; overflow-x: auto; font: 400 0.8125rem/1.7 var(--font-mono); color: var(--ink); }
.code .c { color: var(--ink-3); }
.code .k { color: var(--accent); }
.code .s { color: var(--amber); }
.code-head { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px 8px 16px; border-bottom: 1px solid var(--line); font: 700 0.6875rem/1 var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); }
.copy { all: unset; cursor: pointer; padding: 5px 9px; border-radius: 4px; font: 400 var(--fs-xs)/1 var(--font-body); color: var(--ink-2); letter-spacing: 0; text-transform: none; }
.copy:hover { background: var(--surface-2); color: var(--ink); }
.copy:focus-visible { outline: 2px solid var(--accent); }
.tbl-scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
table.map { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.map th, .map td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
.map tr:last-child td { border-bottom: 0; }
.map th { font: 700 0.6875rem/1.2 var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); }
.map td:first-child { font-family: var(--font-mono); white-space: nowrap; color: var(--ink); }
.map td:last-child code { color: var(--accent); }
.how { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin: 0; padding: 0; list-style: none; }
.how h3 { font-size: var(--fs-md); margin-bottom: 6px; }
.how p { margin: 0; color: var(--ink-2); font-size: var(--fs-sm); }
.how .tag { display: inline-block; margin-bottom: 10px; font: 700 0.6875rem/1 var(--font-mono); letter-spacing: 0.1em; color: var(--accent); text-transform: uppercase; }
.faq { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px 40px; }
.faq h3 { font-size: var(--fs-md); line-height: 1.3; margin-bottom: 6px; }
.faq p { margin: 0; color: var(--ink-2); font-size: var(--fs-sm); max-width: 62ch; }
@media (max-width: 760px) { .faq { grid-template-columns: minmax(0, 1fr); gap: 20px; } }
footer { padding-block: 22px 40px; border-top: 1px solid var(--line); font-size: var(--fs-xs); color: var(--ink-3); }
footer p { margin: 0; max-width: 90ch; }

@media (max-width: 960px) {
  .intro { grid-template-columns: minmax(0, 1fr); }
  .job-grid { grid-template-columns: minmax(0, 1fr); }
  .doc-grid { grid-template-columns: minmax(0, 1fr); }
  .how { grid-template-columns: minmax(0, 1fr); gap: 18px; }
}
@media (max-width: 560px) {
  .drop { min-height: 210px; }
  .panel-tools { margin-left: 0; width: 100%; }
  .search { flex: 1; width: auto; }
  .ql-controls { margin-left: 0; width: 100%; }
  .ql-controls .select { flex: 1; min-width: 0; }
  .types td.fields-cell { min-width: 180px; }
  .chart-wrap { height: 210px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
</style>
<!--BODY-->
<header class="topbar">
  <div class="wrap">
    <a class="brand" href="#top" aria-label="BIN to MAT Converter">
      <span class="sync" title="DataFlash message header bytes">A3 95</span>
      <span class="wordmark">BIN<span aria-hidden="true">→</span>MAT</span>
    </a>
    <nav aria-label="Page">
      <a href="#matlab">Using the .mat</a>
      <a href="#how">How it works</a>
      <a href="#faq">FAQ</a>
      <a id="gh-link" href="https://github.com/DomPka/bintomat" rel="noopener">Source on GitHub</a>
    </nav>
  </div>
</header>

<main id="top">
  <section class="wrap intro">
    <div>
      <p class="eyebrow">Free · ArduPilot DataFlash <b>→</b> MATLAB v5</p>
      <h1>Convert ArduPilot logs to MATLAB .mat, right in the browser</h1>
      <p class="lede">Drop a <code>.bin</code> from your Pixhawk’s SD card or a text <code>.log</code> from Mission Planner. Each message type becomes a MATLAB struct with one field per column, laid out exactly like the BINorLOGtoMAT desktop tool.</p>
      <ul class="facts">
        <li>Files never leave this computer</li>
        <li>Batch several logs at once</li>
        <li>No install, works offline once loaded</li>
      </ul>
    </div>
    <label class="drop" id="drop" for="file-input" tabindex="0" role="button" aria-label="Choose .bin or .log files to convert">
      <span class="drop-corner">Log input</span>
      <span class="drop-corner r">.bin · .log</span>
      <span class="drop-inner">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6h22l12 12v36a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z"/>
          <path d="M24 6v8M30 6v8M36 6v8"/>
          <path d="M19 40l6-9 5 6 6-12 5 8 4-4"/>
        </svg>
        <strong>Drop .bin or .log files</strong>
        <span class="or">or <u>choose files</u> from your computer</span>
        <span class="drop-note">Processed locally · nothing is uploaded</span>
      </span>
    </label>
    <input type="file" id="file-input" multiple accept=".bin,.BIN,.log,.LOG" hidden>
  </section>

  <section class="wrap workspace" aria-label="Loaded logs">
    <div class="strip" id="file-strip"></div>
    <div id="job"></div>
  </section>

  <section class="wrap doc" id="matlab">
    <h2>Using the .mat in MATLAB</h2>
    <p>Every message type in the log becomes one variable: a 1×1 struct whose fields are the message’s columns. Numbers are row vectors with one entry per message; text fields are char matrices with one row per message.</p>
    <div class="doc-grid">
      <div class="code">
        <div class="code-head"><span>MATLAB</span><button class="copy" type="button" id="copy-code">Copy</button></div>
<pre id="matlab-code"><span class="k">load</span>(<span class="s">'sample-flight.mat'</span>)   <span class="c">% ATT, GPS, BARO, ...</span>
t = double(ATT.TimeUS) / 1e6;  <span class="c">% int64 µs to s</span>
<span class="k">plot</span>(t, ATT.Roll, t, ATT.DesRoll)
<span class="k">legend</span>(<span class="s">'Roll'</span>, <span class="s">'DesRoll'</span>); <span class="k">xlabel</span>(<span class="s">'Time (s)'</span>); <span class="k">ylabel</span>(<span class="s">'deg'</span>)

<span class="c">% text fields: char matrix, one row each</span>
names = strtrim(cellstr(PARM.Name));
PARM.Value(strcmp(names, <span class="s">'WP_LOITER_RAD'</span>))

<span class="c">% Lat/Lng are already in degrees</span>
geoplot(GPS.Lat, GPS.Lng)</pre>
      </div>
      <div class="tbl-scroll">
        <table class="map">
          <thead><tr><th>Format</th><th>Logged as</th><th>In the .mat</th></tr></thead>
          <tbody>
            <tr><td>b B h H i I M</td><td>8 to 32-bit integers</td><td><code>int64</code> row</td></tr>
            <tr><td>q Q</td><td>64-bit integers, e.g. TimeUS</td><td><code>int64</code> row</td></tr>
            <tr><td>f d g</td><td>float, double, half float</td><td><code>double</code> row</td></tr>
            <tr><td>c C e E</td><td>integers scaled ×100</td><td><code>double</code>, divided by 100</td></tr>
            <tr><td>L</td><td>lat/lng as int32 ×10⁷</td><td><code>double</code> degrees</td></tr>
            <tr><td>n N Z</td><td>char[4], [16], [64]</td><td><code>char</code> N×width</td></tr>
            <tr><td>a</td><td>int16[32] array</td><td><code>int16</code> N×32</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <p class="hint" style="margin-top:14px">Choosing “double” under Integer fields stores every integer column as double instead of int64, so you can skip the <code>double(...)</code> calls.</p>
  </section>

  <section class="wrap doc" id="how">
    <h2>How it works</h2>
    <p>The converter is a small JavaScript program that ships inside this page. Once the page has loaded it needs no network connection.</p>
    <ul class="how">
      <li>
        <span class="tag">Read</span>
        <h3>Same parser rules as pymavlink</h3>
        <p>Messages are found by their A3&nbsp;95 header and decoded with the log’s own FMT definitions. Corrupt bytes and a truncated final message are skipped the way pymavlink’s DFReader skips them.</p>
      </li>
      <li>
        <span class="tag">Write</span>
        <h3>Same file as scipy.io.savemat</h3>
        <p>The output is a MATLAB v5 MAT-file. Field order, data types, string padding and values match the Python desktop tool. Without compression the bytes are identical apart from the header date.</p>
      </li>
      <li>
        <span class="tag">Extra</span>
        <h3>Pick what you need</h3>
        <p>Untick message types you don’t need for a smaller file. Compression is on by default, and MATLAB’s <code>load</code> reads compressed files natively. Quick look plots any numeric field before you download.</p>
      </li>
    </ul>
  </section>

  <section class="wrap doc" id="faq">
    <h2>Questions</h2>
    <div class="faq">
      <div>
        <h3>How do I convert an ArduPilot .bin log to a MATLAB .mat file?</h3>
        <p>Drop the .bin file on this page, untick any message types you don’t need and press Download .mat. In MATLAB, <code>load('yourlog.mat')</code> puts every message type (ATT, GPS, IMU, BARO, RCOU and so on) in the workspace as a struct.</p>
      </div>
      <div>
        <h3>Which logs are supported?</h3>
        <p>DataFlash logs from ArduPilot firmware (ArduCopter, ArduPlane, ArduRover, ArduSub) on Pixhawk, Cube and similar flight controllers. Use the .bin from the SD card or one downloaded with Mission Planner, QGroundControl or MAVProxy, or a text .log exported by Mission Planner. PX4 .ulg logs and MAVLink .tlog telemetry logs are not supported.</p>
      </div>
      <div>
        <h3>Is my flight log uploaded anywhere?</h3>
        <p>No. The page reads and converts the file with JavaScript on your own computer. Nothing is sent to a server, and once the page has loaded it works without an internet connection.</p>
      </div>
      <div>
        <h3>Can I open the .mat file in Python or GNU Octave?</h3>
        <p>Yes. It is a standard version 5 MAT-file. In Python use <code>scipy.io.loadmat('log.mat')</code>; in GNU Octave use <code>load('log.mat')</code>. Switch compression off if a reader needs an uncompressed file.</p>
      </div>
      <div>
        <h3>How do I get the time in seconds?</h3>
        <p>Every message has a TimeUS field: microseconds since the flight controller booted, stored as int64. Use <code>double(ATT.TimeUS)/1e6</code>, or choose “double” under Integer fields before downloading.</p>
      </div>
      <div>
        <h3>How large a log can it handle?</h3>
        <p>Logs of several hundred megabytes work in desktop Chrome, Edge and Firefox; a 200 MB log takes about five seconds. Untick high-rate messages such as IMU or ISBD when you need a smaller file.</p>
      </div>
    </div>
  </section>

  <footer class="wrap">
    <p>BIN to MAT Converter: a free, open-source browser version of the BINorLOGtoMAT desktop tool (pymavlink + scipy). Converts ArduPilot DataFlash logs, binary .bin and Mission Planner text .log, to MATLAB .mat. <a href="https://github.com/DomPka/bintomat" rel="noopener">Source code and issues on GitHub</a>.</p>
  </footer>
</main>
<!--SCRIPTS-->
