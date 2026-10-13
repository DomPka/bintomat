/* BIN to MAT Converter: page logic */
(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('en-US');
  const fmtN = (n) => nf.format(n);
  const fmtBytes = (b) => {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
    if (b < 1073741824) return `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
    return `${(b / 1073741824).toFixed(2)} GB`;
  };
  const fmtSpan = (s) => {
    if (s == null || !isFinite(s) || s < 0) return 'n/a';
    if (s < 60) return `${s.toFixed(1)} s`;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(sec).padStart(2, '0')} s`;
  };
  const clock = () => new Date().toTimeString().slice(0, 8);
  const baseName = (n) => n.replace(/\.[^.]+$/, '') || 'log';
  const safeName = (n) => (n.trim().replace(/\.mat$/i, '').replace(/[\\/:*?"<>|]+/g, '_') || 'log');
  const SYSTEM_TYPES = new Set(['FMT', 'FMTU', 'UNIT', 'MULT', 'PARM', 'MSG', 'FILE', 'VER']);

  const jobs = [];
  let activeId = null, nextId = 1, queue = Promise.resolve();
  const active = () => jobs.find((j) => j.id === activeId) || null;

  function newJob(name, size, isSample) {
    return {
      id: nextId++, name, size, isSample, status: 'reading', progress: 0, log: null, include: null,
      filter: '', opts: { base: baseName(name), asDouble: false, compress: true },
      lines: [], error: null, cancel: false, preview: null, units: null, exporting: false, cache: new Map(),
    };
  }

  // ---------------- file intake ----------------
  const input = $('#file-input');
  const drop = $('#drop');
  input.addEventListener('change', () => { if (input.files.length) addFiles([...input.files]); input.value = ''; });
  drop.addEventListener('click', (e) => { e.preventDefault(); input.click(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); dragDepth++; drop.classList.add('is-over'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.classList.remove('is-over'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; drop.classList.remove('is-over');
    const files = [...e.dataTransfer.files].filter((f) => f.size > 0 || f.type !== '');
    if (files.length) addFiles(files);
  });
  function hasFiles(e) { return e.dataTransfer && [...e.dataTransfer.types].includes('Files'); }

  function addFiles(files) {
    // the example log steps aside as soon as real logs arrive
    for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].isSample && !jobs[i].exporting) jobs.splice(i, 1);
    let first = null;
    for (const f of files) {
      const job = newJob(f.name, f.size, false);
      jobs.push(job);
      if (!first) first = job;
      queue = queue.then(() => runJob(job, () => f.arrayBuffer()));
    }
    if (first) activeId = first.id;
    renderAll();
    $('#file-strip').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function say(job, text, cls) {
    job.lines.push({ t: clock(), text, cls });
    if (job.id === activeId) renderConsole(job);
  }

  async function runJob(job, getBuffer) {
    if (!jobs.includes(job)) return;
    say(job, 'Opening log file...');
    job.status = 'reading'; renderJobIfActive(job); renderStrip();
    let buf;
    try { buf = await getBuffer(); } catch (e) { return fail(job, `Could not read the file: ${e.message || e}`); }
    if (!jobs.includes(job)) return;
    job.status = 'parsing'; renderJobIfActive(job); renderStrip();
    const t0 = performance.now();
    try {
      job.log = await BinMat.parse(buf, {
        onProgress: (p) => { job.progress = p; if (job.id === activeId) paintProgress(job); },
        isCancelled: () => job.cancel || !jobs.includes(job),
      });
    } catch (e) {
      if (e && e.name === 'Cancelled') { removeJob(job.id); return; }
      return fail(job, e.message || String(e));
    }
    buf = null;
    const secs = ((performance.now() - t0) / 1000).toFixed(2);
    job.status = 'ready';
    job.include = new Set(job.log.messages.map((m) => m.name));
    job.units = unitsFor(job.log);
    job.preview = defaultPreview(job.log);
    const L = job.log;
    say(job, `Read ${fmtN(L.totalMessages)} messages of ${L.messages.length} types in ${secs} s (${L.kind === 'text' ? 'text' : 'binary'} log).`);
    if (L.skippedBytes) say(job, `Skipped ${fmtN(L.skippedBytes)} bytes that were not part of a valid message.`);
    renderAll();
  }
  function fail(job, msg) {
    job.status = 'error'; job.error = msg;
    say(job, `Error: ${msg}`, 'err');
    renderAll();
  }
  function removeJob(id) {
    const i = jobs.findIndex((j) => j.id === id);
    if (i < 0) return;
    jobs[i].cancel = true;
    jobs.splice(i, 1);
    if (activeId === id) activeId = jobs.length ? jobs[Math.min(i, jobs.length - 1)].id : null;
    renderAll();
  }

  // ---------------- units from FMT / FMTU / UNIT / MULT ----------------
  function unitsFor(log) {
    const col = (m, f) => { const M = log.messages.find((x) => x.name === m); const F = M && M.fields.find((x) => x.name === f); return F ? F.col : null; };
    const uid = col('UNIT', 'Id'), ulab = col('UNIT', 'Label'), fType = col('FMTU', 'FmtType'), fU = col('FMTU', 'UnitIds'), fM = col('FMTU', 'MultIds');
    const tType = col('FMT', 'Type'), tName = col('FMT', 'Name'), tFmt = col('FMT', 'Format'), tCols = col('FMT', 'Columns');
    if (!uid || !ulab || !fType || !fU || !tType || !tName || !tFmt || !tCols) return null;
    const num = (c, i) => Number(c.arr[i]);
    const units = new Map();
    for (let i = 0; i < uid.n; i++) units.set(String.fromCharCode(num(uid, i) & 0xff), String(ulab.arr[i]));
    const mults = new Map();
    const mid = col('MULT', 'Id'), mval = col('MULT', 'Mult');
    if (mid && mval) for (let i = 0; i < mid.n; i++) mults.set(String.fromCharCode(num(mid, i) & 0xff), +Number(mval.arr[i]).toPrecision(7));
    const types = new Map();
    for (let i = 0; i < tType.n; i++) types.set(num(tType, i), { name: tName.arr[i], format: tFmt.arr[i], cols: String(tCols.arr[i]).split(',') });
    const PREFIX = new Map([[0, ''], [1, ''], [0.1, 'd'], [0.01, 'c'], [0.001, 'm'], [1e-6, 'µ'], [1e-9, 'n']]);
    const out = new Map();
    for (let i = 0; i < fType.n; i++) {
      const info = types.get(num(fType, i));
      if (!info) continue;
      const ids = String(fU.arr[i]), mids = fM ? String(fM.arr[i]) : '';
      const m = new Map();
      info.cols.forEach((c, k) => {
        let u = units.get(ids[k]);
        if (!u || ids[k] === '#' || ids[k] === '-') return;
        if (!'cCeEL'.includes(info.format[k] || '') && mults.has(mids[k])) {
          const mul = mults.get(mids[k]);
          u = PREFIX.has(mul) ? PREFIX.get(mul) + u : `${+mul.toPrecision(4)} ${u}`;
        }
        m.set(c, u);
      });
      out.set(info.name, m);
    }
    return out;
  }
  const unitOf = (job, msg, field) => (job.units && job.units.get(msg) && job.units.get(msg).get(field)) || '';

  // ---------------- quick look data ----------------
  const isNumeric = (col) => col.out === 'int' || col.out === 'double';
  const numericFields = (m) => m.fields.filter((f) => isNumeric(f.col) && f.name !== 'TimeUS');
  // a field worth plotting first: a known signal, else the first measured (double) value
  const PREFERRED = ['Roll', 'Alt', 'Lat', 'Volt', 'Airspeed', 'Spd', 'AccZ', 'GyrX', 'C1', 'C3', 'Curr', 'Press', 'VibeX', 'Value'];
  const BOOKKEEPING = new Set(['I', 'Inst', 'Instance', 'Status', 'NSats', 'GWk', 'GMS', 'U', 'Id', 'Type', 'SMS', 'Mode', 'ModeNum', 'Rsn']);
  function bestField(m) {
    const fields = numericFields(m);
    return (PREFERRED.map((n) => fields.find((f) => f.name === n)).find(Boolean)
      || fields.find((f) => f.col.out === 'double' && !BOOKKEEPING.has(f.name))
      || fields.find((f) => !BOOKKEEPING.has(f.name)) || fields[0]).name;
  }
  function defaultPreview(log) {
    const att = log.messages.find((m) => m.name === 'ATT');
    if (att && att.fields.some((f) => f.name === 'Roll' && isNumeric(f.col))) return { msg: 'ATT', field: 'Roll' };
    const cands = log.messages.filter((m) => !SYSTEM_TYPES.has(m.name) && numericFields(m).length).sort((a, b) => b.count - a.count);
    const m = cands[0] || log.messages.find((x) => numericFields(x).length);
    return m ? { msg: m.name, field: bestField(m) } : null;
  }
  function seriesFor(job) {
    const p = job.preview;
    if (!p) return null;
    const key = `${p.msg}\u0001${p.field}`;
    if (job.cache.has(key)) return job.cache.get(key);
    const M = job.log.messages.find((m) => m.name === p.msg);
    const F = M && M.fields.find((f) => f.name === p.field);
    if (!F || !isNumeric(F.col)) return null;
    const y = BinMat.numeric(F.col);
    const T = M.fields.find((f) => f.name === 'TimeUS');
    let x, timed = false;
    if (T && isNumeric(T.col) && T.col.n === y.length) {
      const raw = BinMat.numeric(T.col);
      const t0 = job.log.timeStartUS != null ? job.log.timeStartUS : raw[0];
      x = new Float64Array(raw.length);
      for (let i = 0; i < raw.length; i++) x[i] = (raw[i] - t0) / 1e6;
      timed = true;
    } else {
      x = new Float64Array(y.length);
      for (let i = 0; i < y.length; i++) x[i] = i;
    }
    const s = { x, y, timed, unit: unitOf(job, p.msg, p.field) };
    if (job.cache.size > 12) job.cache.clear();
    job.cache.set(key, s);
    return s;
  }

  // ---------------- rendering ----------------
  function renderAll() { renderStrip(); renderJob(); }
  function renderJobIfActive(job) { if (job.id === activeId) renderJob(); }

  function renderStrip() {
    const el = $('#file-strip');
    el.hidden = jobs.length < 2 && !(jobs[0] && !jobs[0].isSample);
    el.innerHTML = jobs.map((j) => {
      const dot = j.status === 'ready' ? (j.exporting ? 'busy' : 'ready') : j.status === 'error' ? 'error' : 'busy';
      return `<span class="chip${j.id === activeId ? ' is-active' : ''}">
        <button class="chip-open" type="button" data-open="${j.id}" title="${esc(j.name)}"><span class="dot ${dot}"></span><span class="chip-name">${esc(j.name)}</span></button>
        <button class="chip-x" type="button" data-remove="${j.id}" aria-label="Remove ${esc(j.name)}">✕</button></span>`;
    }).join('');
  }
  $('#file-strip').addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]'), r = e.target.closest('[data-remove]');
    if (r) removeJob(+r.dataset.remove);
    else if (o) { activeId = +o.dataset.open; renderAll(); }
  });

  const DL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>';

  function renderJob() {
    const host = $('#job');
    const job = active();
    if (!job) {
      host.innerHTML = `<div class="panel ql-empty">No logs loaded. Drop a .bin or .log file above.</div>`;
      return;
    }
    const head = `<div class="job-title"><h2>${esc(job.name)}</h2>
      ${job.log ? `<span class="badge">${job.log.kind === 'text' ? 'Text DataFlash' : 'Binary DataFlash'}</span>` : ''}
      ${job.isSample ? '<span class="badge sample">Example · synthetic flight</span>' : ''}</div>`;
    if (job.status === 'reading' || job.status === 'parsing') {
      host.innerHTML = `<div class="job"><div class="job-head">${head}
        <div class="busy-panel" style="padding:0">
          <div class="busy-row"><span id="busy-stage">${job.status === 'reading' ? 'Reading file' : 'Decoding messages'} · ${fmtBytes(job.size)}</span><b id="busy-pct">${Math.round(job.progress * 100)}%</b></div>
          <div class="progress" role="progressbar" aria-label="Conversion progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(job.progress * 100)}"><i id="busy-bar" style="width:${job.progress * 100}%"></i></div>
          <div><button class="btn-ghost" type="button" data-act="cancel">Cancel</button></div>
        </div></div></div>`;
      return;
    }
    if (job.status === 'error') {
      host.innerHTML = `<div class="job"><div class="job-head">${head}
        <div class="error-panel" style="padding:0"><p>${esc(job.error)}</p>
        <p class="note">Check that this is an ArduPilot DataFlash log: the binary <code>.bin</code> from the SD card or a text <code>.log</code> exported by Mission Planner.</p>
        <div><button class="btn-ghost" type="button" data-remove-active>Remove this file</button></div></div></div></div>`;
      return;
    }
    const L = job.log;
    const span = L.timeStartUS != null && L.timeEndUS != null ? (L.timeEndUS - L.timeStartUS) / 1e6 : null;
    const notes = [];
    if (job.isSample) notes.push('<p class="note">This example log is generated in your browser so you can try everything. Drop your own logs above to replace it.</p>');
    if (L.skippedBytes) notes.push(`<p class="note warn">Skipped ${fmtN(L.skippedBytes)} bytes that were not part of a valid message. This is common at the end of SD-card logs; the desktop tool skips the same bytes.</p>`);
    host.innerHTML = `<div class="job">
      <div class="job-head">${head}
        <dl class="stats">
          <div><dt>Messages</dt><dd>${fmtN(L.totalMessages)}</dd></div>
          <div><dt>Message types</dt><dd>${fmtN(L.messages.length)}</dd></div>
          <div><dt>Log span</dt><dd>${fmtSpan(span)}</dd></div>
          <div><dt>File size</dt><dd>${fmtBytes(L.byteLength)}</dd></div>
          <div><dt>Firmware</dt><dd>${esc(L.firmware || 'not logged')}</dd></div>
        </dl>${notes.join('')}
      </div>
      <div class="job-grid">
        <section class="panel" aria-labelledby="types-h">
          <div class="panel-head"><h3 id="types-h">Message types</h3><span class="count" id="type-count"></span>
            <div class="panel-tools">
              <input class="search" id="type-filter" type="search" placeholder="Filter, e.g. GPS" aria-label="Filter message types" value="${esc(job.filter)}">
              <button class="btn-ghost" type="button" data-act="all">All</button>
              <button class="btn-ghost" type="button" data-act="none">None</button>
            </div></div>
          <div class="table-scroll"><table class="types">
            <thead><tr><th class="check"><span class="visually-hidden" style="position:absolute;clip:rect(0 0 0 0)">Include</span></th><th>Type</th><th class="num">Rows</th><th>Fields</th></tr></thead>
            <tbody id="type-rows"></tbody></table></div>
        </section>
        <div class="side">
          <section class="panel" aria-labelledby="ql-h">
            <div class="panel-head"><h3 id="ql-h">Quick look</h3>
              <div class="ql-controls">
                <select class="select" id="ql-msg" aria-label="Message type to plot"></select>
                <select class="select" id="ql-field" aria-label="Field to plot"></select>
              </div></div>
            <div id="ql-body"></div>
          </section>
          <section class="panel" aria-labelledby="ex-h">
            <div class="panel-head"><h3 id="ex-h">Export</h3></div>
            <div class="export-body">
              <div><label class="field-label" for="out-name">File name</label>
                <div class="name-input"><input id="out-name" type="text" spellcheck="false" autocomplete="off" value="${esc(job.opts.base)}"><span>.mat</span></div></div>
              <div><span class="field-label" id="int-label">Integer fields</span>
                <div class="seg" role="radiogroup" aria-labelledby="int-label">
                  <label><input type="radio" name="intmode" id="int-int64" value="int64" ${job.opts.asDouble ? '' : 'checked'}><span>int64, like the desktop tool</span></label>
                  <label><input type="radio" name="intmode" id="int-double" value="double" ${job.opts.asDouble ? 'checked' : ''}><span>double</span></label>
                </div></div>
              <label class="toggle"><input type="checkbox" id="opt-compress" ${job.opts.compress ? 'checked' : ''}><span>Compress the file<small>Much smaller download. MATLAB’s <code>load</code> opens it the same way.</small></span></label>
              <div class="go">
                <p class="summary-line" id="ex-summary"></p>
                <button class="btn-primary" type="button" data-act="download" id="btn-download">${DL_ICON}<span id="dl-label">Download .mat</span></button>
                <div class="progress" id="ex-progress" hidden><i id="ex-bar"></i></div>
                <button class="btn-secondary" type="button" data-act="download-all" id="btn-all" hidden></button>
              </div>
              <div><span class="field-label">Status</span><pre class="console" id="console" aria-live="polite"></pre></div>
            </div>
          </section>
        </div>
      </div></div>`;
    renderTypes(job);
    renderQuickLook(job);
    renderExportState(job);
    renderConsole(job);
  }

  function paintProgress(job) {
    const bar = $('#busy-bar'), pct = $('#busy-pct');
    if (!bar) { renderJob(); return; }
    const v = Math.round(job.progress * 100);
    bar.style.width = `${job.progress * 100}%`;
    pct.textContent = `${v}%`;
    bar.parentElement.setAttribute('aria-valuenow', v);
    const st = $('#busy-stage');
    if (st && job.status === 'parsing') st.textContent = `Decoding messages · ${fmtBytes(job.size)}`;
  }

  function renderTypes(job) {
    const tb = $('#type-rows');
    if (!tb) return;
    const q = job.filter.trim().toUpperCase();
    const list = job.log.messages.filter((m) => !q || m.name.toUpperCase().includes(q) || m.fields.some((f) => f.name.toUpperCase().includes(q)));
    const MAXF = 8;
    tb.innerHTML = list.length ? list.map((m) => {
      const on = job.include.has(m.name);
      const prev = job.preview && job.preview.msg === m.name;
      const shown = m.fields.slice(0, MAXF).map((f) => isNumeric(f.col) && f.name !== 'TimeUS'
        ? `<button type="button" class="f" data-plot="${esc(m.name)}" data-field="${esc(f.name)}" title="Plot ${esc(m.name)}.${esc(f.name)}">${esc(f.name)}</button>`
        : `<span class="f${f.col.out === 'char' || f.col.out === 'bytes64' ? ' txt' : ''}">${esc(f.name)}</span>`).join('');
      const more = m.fields.length > MAXF ? `<span class="f more" title="${esc(m.fields.slice(MAXF).map((f) => f.name).join(', '))}">+${m.fields.length - MAXF}</span>` : '';
      const canPlot = numericFields(m).length > 0;
      return `<tr class="${on ? '' : 'is-off'}${prev ? ' is-previewed' : ''}">
        <td class="check"><input type="checkbox" data-inc="${esc(m.name)}" ${on ? 'checked' : ''} aria-label="Include ${esc(m.name)}"></td>
        <td>${canPlot ? `<button type="button" class="tname" data-plot="${esc(m.name)}">${esc(m.name)}</button>` : `<span class="tname" style="cursor:default">${esc(m.name)}</span>`}<span class="tfmt">${esc(m.format || '')}</span></td>
        <td class="num">${fmtN(m.count)}</td>
        <td class="fields-cell"><div class="fields">${shown}${more}</div></td></tr>`;
    }).join('') : `<tr class="empty-row"><td colspan="4">No message types match “${esc(job.filter)}”.</td></tr>`;
    $('#type-count').textContent = `${job.include.size} of ${job.log.messages.length} included`;
  }

  function renderQuickLook(job) {
    const msgSel = $('#ql-msg'), fieldSel = $('#ql-field'), body = $('#ql-body');
    if (!msgSel) return;
    const plottable = job.log.messages.filter((m) => numericFields(m).length);
    if (!job.preview || !plottable.length) {
      msgSel.hidden = fieldSel.hidden = true;
      body.innerHTML = '<div class="ql-empty">No numeric fields to plot in this log.</div>';
      return;
    }
    msgSel.innerHTML = plottable.map((m) => `<option value="${esc(m.name)}"${m.name === job.preview.msg ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
    const M = plottable.find((m) => m.name === job.preview.msg) || plottable[0];
    fieldSel.innerHTML = numericFields(M).map((f) => `<option value="${esc(f.name)}"${f.name === job.preview.field ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
    body.innerHTML = `<div class="chart-wrap" id="chart-wrap"><canvas id="ql-canvas"></canvas><canvas id="ql-overlay" aria-hidden="true"></canvas></div>
      <div class="ql-foot"><span id="ql-meta"></span><span class="readout" id="ql-readout">Hover the plot to read values</span></div>`;
    drawChart(job);
  }

  function estimate(job) { return BinMat.estimateSize(job.log, job.include, job.opts.asDouble); }
  function renderExportState(job) {
    const sum = $('#ex-summary');
    if (!sum) return;
    const n = job.include.size;
    const rows = job.log.messages.reduce((s, m) => s + (job.include.has(m.name) ? m.count : 0), 0);
    sum.textContent = n
      ? `${n} message types · ${fmtN(rows)} rows · about ${fmtBytes(estimate(job))} before compression`
      : 'Select at least one message type to export.';
    const btn = $('#btn-download');
    btn.disabled = job.exporting || n === 0;
    $('#dl-label').textContent = job.exporting ? 'Writing .mat…' : savesAsZip ? 'Download .mat (zipped)' : 'Download .mat';
    $('#ex-progress').hidden = !job.exporting;
    const ready = jobs.filter((j) => j.status === 'ready' && !j.isSample);
    const all = $('#btn-all');
    all.hidden = ready.length < 2;
    all.disabled = jobs.some((j) => j.exporting);
    all.textContent = `Download all ${ready.length} logs as .zip`;
  }
  function renderConsole(job) {
    const el = $('#console');
    if (!el) return;
    el.innerHTML = job.lines.map((l) => `<time>${l.t}</time>  <span class="${l.cls || ''}">${esc(l.text)}</span>`).join('\n');
    el.scrollTop = el.scrollHeight;
  }

  // ---------------- workspace events ----------------
  const jobHost = $('#job');
  jobHost.addEventListener('click', (e) => {
    const job = active();
    if (!job) return;
    const act = e.target.closest('[data-act]');
    const plot = e.target.closest('[data-plot]');
    if (e.target.closest('[data-remove-active]')) return removeJob(job.id);
    if (plot && job.log) {
      const M = job.log.messages.find((m) => m.name === plot.dataset.plot);
      const fields = numericFields(M);
      const keep = job.preview && fields.find((f) => f.name === job.preview.field);
      job.preview = { msg: M.name, field: plot.dataset.field || (keep ? keep.name : bestField(M)) };
      renderTypes(job); renderQuickLook(job);
      return;
    }
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'cancel') { job.cancel = true; say(job, 'Cancelled.'); }
    else if (a === 'all') { job.log.messages.forEach((m) => job.include.add(m.name)); renderTypes(job); renderExportState(job); }
    else if (a === 'none') { job.include.clear(); renderTypes(job); renderExportState(job); }
    else if (a === 'download') exportJob(job);
    else if (a === 'download-all') exportAll();
  });
  jobHost.addEventListener('change', (e) => {
    const job = active();
    if (!job || !job.log) return;
    const t = e.target;
    if (t.matches('[data-inc]')) {
      if (t.checked) job.include.add(t.dataset.inc); else job.include.delete(t.dataset.inc);
      t.closest('tr').classList.toggle('is-off', !t.checked);
      $('#type-count').textContent = `${job.include.size} of ${job.log.messages.length} included`;
      renderExportState(job);
    } else if (t.id === 'ql-msg') {
      const M = job.log.messages.find((m) => m.name === t.value);
      const keep = numericFields(M).find((f) => f.name === job.preview.field);
      job.preview = { msg: M.name, field: keep ? keep.name : bestField(M) };
      renderTypes(job); renderQuickLook(job);
    } else if (t.id === 'ql-field') {
      job.preview = { msg: job.preview.msg, field: t.value };
      drawChart(job);
    } else if (t.name === 'intmode') {
      job.opts.asDouble = t.value === 'double'; renderExportState(job);
    } else if (t.id === 'opt-compress') {
      job.opts.compress = t.checked;
    }
  });
  jobHost.addEventListener('input', (e) => {
    const job = active();
    if (!job) return;
    if (e.target.id === 'type-filter') { job.filter = e.target.value; renderTypes(job); }
    else if (e.target.id === 'out-name') job.opts.base = e.target.value;
  });

  // ---------------- export ----------------
  async function buildBlob(job) {
    return BinMat.toMat(job.log, {
      include: job.include, integersAsDouble: job.opts.asDouble, compress: job.opts.compress,
      onProgress: (p) => { if (job.id === activeId) { const b = $('#ex-bar'); if (b) b.style.width = `${p * 100}%`; } },
    });
  }
  async function exportJob(job) {
    if (job.exporting || !job.include.size) return;
    job.exporting = true; renderExportState(job); renderStrip();
    const filename = `${safeName(job.opts.base)}.mat`;
    say(job, 'Saving .mat file...');
    try {
      const blob = await buildBlob(job);
      const how = await saveFile(blob, filename);
      say(job, `Successfully converted to ${filename} (${fmtBytes(blob.size)})${how === 'zip' ? ', saved inside a .zip' : ''}.`, 'ok');
    } catch (e) {
      say(job, e && e.code === 'declined' ? 'Save cancelled.' : `Error: ${(e && e.message) || e}`, e && e.code === 'declined' ? '' : 'err');
    }
    job.exporting = false;
    if (job.id === activeId) renderExportState(job);
    renderStrip();
  }
  async function exportAll() {
    const ready = jobs.filter((j) => j.status === 'ready' && !j.isSample && j.include.size);
    if (!ready.length) return;
    const cur = active();
    ready.forEach((j) => { j.exporting = true; });
    if (cur) renderExportState(cur);
    renderStrip();
    try {
      const entries = [];
      const used = new Set();
      for (const j of ready) {
        say(j, 'Saving .mat file for the .zip...');
        let name = `${safeName(j.opts.base)}.mat`, k = 2;
        while (used.has(name.toLowerCase())) name = `${safeName(j.opts.base)}-${k++}.mat`;
        used.add(name.toLowerCase());
        entries.push({ name, blob: await buildBlob(j) });
        j.exporting = false;
        say(j, `Added ${name} to the .zip.`, 'ok');
      }
      const zip = await makeZip(entries);
      await saveFile(zip, 'logs-mat.zip', true);
    } catch (e) {
      if (cur) say(cur, e && e.code === 'declined' ? 'Save cancelled.' : `Error: ${(e && e.message) || e}`, 'err');
    }
    ready.forEach((j) => { j.exporting = false; });
    if (active()) renderExportState(active());
    renderStrip();
  }

  // Inside the Claude artifact viewer, files are offered through its save prompt
  // (which accepts .zip but not .mat). On GitHub Pages a normal download is used.
  let savesAsZip = false;
  let dlCap = Promise.resolve(null);
  try {
    if (window.parent !== window && window.claude && typeof window.claude.use === 'function') {
      dlCap = window.claude.use('downloads').then((d) => {
        savesAsZip = !!d;
        const j = active(); if (j && j.status === 'ready') renderExportState(j);
        return d;
      }).catch(() => null);
    }
  } catch (_) { /* not in a viewer */ }

  async function saveFile(blob, filename, isZip) {
    const dl = await dlCap;
    if (dl) {
      const data = isZip ? blob : await makeZip([{ name: filename, blob }]);
      const name = isZip ? filename : filename.replace(/\.mat$/i, '') + '.mat.zip';
      await dl.save({ filename: name, data });
      return 'zip';
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return 'download';
  }

  // minimal ZIP (stored, no compression; the .mat files are already compressed)
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  async function makeZip(entries) {
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const e of entries) {
      const data = new Uint8Array(await e.blob.arrayBuffer());
      const name = new TextEncoder().encode(e.name);
      const crc = crc32(data);
      if (offset + data.length + 30 + name.length > 0xfffffff0) throw new Error('These files are too large for one .zip. Download them one at a time.');
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // ---------------- chart ----------------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const e = raw / mag;
    return (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  }
  function tickLabel(v, step) {
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e7 || a < 1e-4)) return v.toExponential(2);
    const dec = Math.max(0, Math.min(7, -Math.floor(Math.log10(step) + 1e-9)));
    return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  let chartState = null;
  function drawChart(job) {
    const canvas = $('#ql-canvas'), overlay = $('#ql-overlay'), wrap = $('#chart-wrap');
    if (!canvas || !job.log) return;
    const s = seriesFor(job);
    const meta = $('#ql-meta');
    if (!s) { chartState = null; return; }
    const W = wrap.clientWidth, H = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
    for (const c of [canvas, overlay]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { x, y } = s;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, finite = 0;
    for (let i = 0; i < y.length; i++) {
      const xv = x[i], yv = y[i];
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      finite++;
      if (xv < xmin) xmin = xv; if (xv > xmax) xmax = xv;
      if (yv < ymin) ymin = yv; if (yv > ymax) ymax = yv;
    }
    const mono = `11px ${css('--font-mono')}`;
    ctx.font = mono;
    if (!finite) {
      ctx.fillStyle = css('--ink-3'); ctx.textAlign = 'center'; ctx.fillText('No finite values in this field', W / 2, H / 2);
      meta.textContent = `${fmtN(y.length)} samples`;
      chartState = null; return;
    }
    if (xmin === xmax) { xmin -= 0.5; xmax += 0.5; }
    if (ymin === ymax) { const pad = Math.abs(ymin) * 0.05 || 1; ymin -= pad; ymax += pad; }
    const yStep = niceStep(ymax - ymin, 4);
    const y0 = Math.floor(ymin / yStep) * yStep, y1 = Math.ceil(ymax / yStep) * yStep;
    const yTicks = []; for (let v = y0; v <= y1 + yStep * 1e-6; v += yStep) yTicks.push(+v.toPrecision(12));
    const labels = yTicks.map((v) => tickLabel(v, yStep));
    const left = Math.ceil(Math.max(...labels.map((l) => ctx.measureText(l).width))) + 14;
    const P = { l: left, r: 10, t: 10, b: 26 };
    const pw = W - P.l - P.r, ph = H - P.t - P.b;
    const X = (v) => P.l + ((v - xmin) / (xmax - xmin)) * pw;
    const Y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * ph;
    // grid + labels
    ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; ctx.fillStyle = css('--ink-2');
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yTicks.forEach((v, i) => { const py = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(P.l, py); ctx.lineTo(W - P.r, py); ctx.stroke(); ctx.fillText(labels[i], P.l - 8, py); });
    const xStep = niceStep(xmax - xmin, Math.max(2, Math.floor(pw / 90)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = Math.ceil(xmin / xStep) * xStep; v <= xmax + xStep * 1e-6; v += xStep) {
      const px = Math.round(X(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, P.t + ph); ctx.lineTo(px, P.t + ph + 4); ctx.stroke();
      ctx.fillText(tickLabel(+v.toPrecision(12), xStep) + (s.timed ? ' s' : ''), px, P.t + ph + 8);
    }
    if (y0 < 0 && y1 > 0) { ctx.strokeStyle = css('--line-strong'); const pz = Math.round(Y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(P.l, pz); ctx.lineTo(W - P.r, pz); ctx.stroke(); }
    // trace, decimated to min/max per pixel column
    const pts = [];
    ctx.save(); ctx.beginPath(); ctx.rect(P.l, P.t - 2, pw, ph + 4); ctx.clip();
    ctx.strokeStyle = css('--trace'); ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false, col = null, cMin = 0, cMax = 0, cMinI = 0, cMaxI = 0;
    const flush = () => {
      if (col === null) return;
      const a = cMinI < cMaxI ? [cMinI, cMin] : [cMaxI, cMax], b = cMinI < cMaxI ? [cMaxI, cMax] : [cMinI, cMin];
      for (const [i, v] of a[0] === b[0] ? [a] : [a, b]) {
        const px = X(x[i]), py = Y(v);
        if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
        pts.push(px, py, i);
      }
    };
    for (let i = 0; i < y.length; i++) {
      const yv = y[i], xv = x[i];
      if (!Number.isFinite(yv) || !Number.isFinite(xv)) { flush(); col = null; pen = false; continue; }
      const c = Math.round(X(xv));
      if (c !== col) { flush(); col = c; cMin = cMax = yv; cMinI = cMaxI = i; }
      else { if (yv < cMin) { cMin = yv; cMinI = i; } if (yv > cMax) { cMax = yv; cMaxI = i; } }
    }
    flush();
    ctx.stroke();
    ctx.restore();
    // endpoint
    if (pts.length) {
      const ex = pts[pts.length - 3], ey = pts[pts.length - 2];
      ctx.fillStyle = css('--trace'); ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
    }
    const unit = s.unit ? ` (${s.unit})` : '';
    meta.textContent = `${job.preview.msg}.${job.preview.field}${unit} · ${fmtN(y.length)} samples${s.timed ? ' · time since log start' : ' · by sample index'}`;
    chartState = { job, pts, P, W, H, dpr, s, unit: s.unit };
    clearOverlay();
  }
  function clearOverlay() {
    const o = $('#ql-overlay'); if (!o) return;
    o.getContext('2d').clearRect(0, 0, o.width, o.height);
    const r = $('#ql-readout'); if (r) r.textContent = 'Hover the plot to read values';
  }
  function hover(ev) {
    const st = chartState, o = $('#ql-overlay');
    if (!st || !o || !st.pts.length) return;
    const rect = o.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    if (mx < st.P.l || mx > st.W - st.P.r) { clearOverlay(); return; }
    let best = 0, bd = Infinity;
    for (let k = 0; k < st.pts.length; k += 3) { const d = Math.abs(st.pts[k] - mx); if (d < bd) { bd = d; best = k; } }
    const px = st.pts[best], py = st.pts[best + 1], i = st.pts[best + 2];
    const ctx = o.getContext('2d');
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.clearRect(0, 0, st.W, st.H);
    ctx.strokeStyle = css('--ink-3'); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(px) + 0.5, st.P.t); ctx.lineTo(Math.round(px) + 0.5, st.H - st.P.b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css('--surface'); ctx.strokeStyle = css('--trace'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const xv = st.s.x[i], yv = st.s.y[i];
    const yTxt = Math.abs(yv) >= 1e7 ? yv.toExponential(4) : (+yv.toPrecision(8)).toLocaleString('en-US', { maximumFractionDigits: 7 });
    $('#ql-readout').textContent = `${st.s.timed ? `t ${xv.toFixed(2)} s` : `#${fmtN(i)}`} · ${yTxt}${st.unit ? ' ' + st.unit : ''}`;
  }
  jobHost.addEventListener('pointermove', (e) => { if (e.target.id === 'ql-overlay') hover(e); });
  jobHost.addEventListener('pointerleave', (e) => { if (e.target.id === 'ql-overlay') clearOverlay(); }, true);
  const redraw = () => { const j = active(); if (j && j.status === 'ready') drawChart(j); };
  let rto = null;
  new ResizeObserver(() => { clearTimeout(rto); rto = setTimeout(redraw, 60); }).observe(jobHost);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);

  // ---------------- misc ----------------
  $('#copy-code').addEventListener('click', async (e) => {
    const btn = e.currentTarget, text = $('#matlab-code').textContent;
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
    catch (_) {
      const r = document.createRange(); r.selectNodeContents($('#matlab-code'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); btn.textContent = 'Selected, press Ctrl+C';
    }
    setTimeout(() => { btn.textContent = 'Copy'; }, 2200);
  });
  // start with the built-in example flight so the tools have something to show
  const sample = makeSampleLog();
  const sj = newJob('sample-flight.bin', sample.length, true);
  jobs.push(sj); activeId = sj.id;
  renderAll();
  queue = queue.then(() => runJob(sj, async () => sample.buffer));
})();
