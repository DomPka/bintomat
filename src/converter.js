/*!
 * BIN/LOG → MAT converter core
 * Parses ArduPilot DataFlash logs (binary .bin and text .log) the same way
 * pymavlink's DFReader does, and writes a MATLAB v5 .mat file laid out the
 * same way scipy.io.savemat does: one struct per message type, one field per
 * column. Runs entirely in the browser (or Node ≥ 18).
 */
const BinMat = (() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // DataFlash format characters (pymavlink FORMAT_TO_STRUCT)
  // ---------------------------------------------------------------------------
  const SIZE = { a: 64, b: 1, B: 1, g: 2, h: 2, H: 2, i: 4, I: 4, f: 4, n: 4, N: 16, Z: 64,
                 c: 2, C: 2, e: 4, E: 4, L: 4, d: 8, M: 1, q: 8, Q: 8 };
  // pymavlink divides by (1/mult) for accuracy; replicate exactly.
  const DIVISOR = { c: 1 / 0.01, C: 1 / 0.01, e: 1 / 0.01, E: 1 / 0.01, L: 1 / 1.0e-7 };
  const INT_CHARS = 'bBhHiIM';
  const STR_CHARS = 'nNZ';
  const FLOAT_CHARS = 'fdgcCeEL';

  const utf8Fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const utf8Lenient = new TextDecoder('utf-8', { ignoreBOM: true });

  const latin1 = (u8) => {
    let s = '';
    for (let k = 0; k < u8.length; k += 4096) s += String.fromCharCode.apply(null, u8.subarray(k, k + 4096));
    return s;
  };
  const cutNull = (s) => { const z = s.indexOf('\0'); return z < 0 ? s : s.slice(0, z); };

  // pymavlink: bytes -> utf-8 (strict) else ISO-8859-1, then cut at first NUL
  function fixedStr(u8, p, size) {
    let nul = -1, k = 0;
    for (; k < size; k++) {
      const b = u8[p + k];
      if (b >= 0x80) break;
      if (b === 0 && nul < 0) nul = k;
    }
    if (k === size) return String.fromCharCode.apply(null, u8.subarray(p, p + (nul < 0 ? size : nul)));
    const bytes = u8.subarray(p, p + size);
    let s;
    try { s = utf8Fatal.decode(bytes); } catch (_) { s = latin1(bytes); }
    return cutNull(s);
  }
  // pymavlink null_term(bytes): decode(errors='backslashreplace') then cut at NUL
  function nameStr(u8, p, size) {
    const bytes = u8.subarray(p, p + size);
    let s;
    try { s = utf8Fatal.decode(bytes); } catch (_) {
      s = '';
      for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : '\\x' + b.toString(16).padStart(2, '0');
    }
    return cutNull(s);
  }

  function half(h) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * f * 5.960464477539063e-8;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * (1 + f / 1024) * Math.pow(2, e - 15);
  }

  // Python float(str)
  function pyFloat(v) {
    const t = v.trim().toLowerCase();
    if (t === 'nan' || t === '+nan' || t === '-nan') return NaN;
    if (t === 'inf' || t === '+inf' || t === 'infinity' || t === '+infinity') return Infinity;
    if (t === '-inf' || t === '-infinity') return -Infinity;
    const x = Number(t.indexOf('_') >= 0 ? t.replace(/_/g, '') : t);
    return Number.isNaN(x) ? NaN : x;
  }
  function pyInt(v) {
    const x = Number(v.trim());
    return Number.isFinite(x) ? Math.trunc(x) : 0;
  }
  function pyBigInt(v) {
    try { return BigInt(v.trim()); } catch (_) { return BigInt(pyInt(v)); }
  }

  // ---------------------------------------------------------------------------
  // Formats (pymavlink DFFormat)
  // ---------------------------------------------------------------------------
  function makeFormat(type, name, len, format, columnsStr) {
    let structSize = 0;
    const offsets = [];
    for (const c of format) {
      if (!(c in SIZE)) throw new Error(`Unsupported format char '${c}' in message ${name}`);
      offsets.push(structSize);
      structSize += SIZE[c];
    }
    let columns = columnsStr.split(',');
    if (columns.length === 1 && columns[0] === '') columns = [];
    return { type, name: cutNull(name), len, format, columns, offsets, structSize,
             sig: `${cutNull(name)}\u0001${format}\u0001${columnsStr}` };
  }
  const FMT_FMT = () => makeFormat(0x80, 'FMT', 89, 'BBnNZ', 'Type,Length,Name,Format,Columns');

  // ---------------------------------------------------------------------------
  // Cooperative yielding so the page stays responsive on big logs
  // ---------------------------------------------------------------------------
  const nextTick = () => new Promise((r) => (typeof setImmediate === 'function' ? setImmediate(r) : setTimeout(r, 0)));
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function makeTicker(onProgress, lo, hi, total) {
    let last = now();
    return async (pos) => {
      const t = now();
      if (t - last > 40) {
        last = t;
        if (onProgress) onProgress(lo + (hi - lo) * Math.min(1, pos / total));
        await nextTick();
      }
    };
  }
  class Cancelled extends Error { constructor() { super('Cancelled'); this.name = 'Cancelled'; } }

  // ---------------------------------------------------------------------------
  // Binary DataFlash scanning (pymavlink DFReader_binary._parse_next)
  // ---------------------------------------------------------------------------
  async function scanBinary(u8, dv, formats, onMsg, tick, isCancelled) {
    const len = u8.length;
    let off = 0, skipped = 0, n = 0;
    outer: for (;;) {
      let t;
      for (;;) {
        if (len - off < 3) break outer;
        if (u8[off] === 0xa3 && u8[off + 1] === 0x95) {
          t = u8[off + 2];
          if (formats[t]) break;
        }
        off++; skipped++;
      }
      off += 3;
      const fmt = formats[t];
      const bodyLen = fmt.len - 3;
      const remaining = len - off;
      if (remaining < bodyLen) break; // out of data (usually a truncated tail)
      if (bodyLen < 0 || fmt.structSize !== bodyLen) { // struct.unpack would fail
        if (remaining < 528) break;
        continue;
      }
      if (fmt.name === 'FMT') {
        try {
          const o = fmt.offsets;
          const nf = makeFormat(u8[off + o[0]], nameStr(u8, off + o[2], 4), u8[off + o[1]],
                                nameStr(u8, off + o[3], 16), nameStr(u8, off + o[4], 64));
          formats[nf.type] = nf;
        } catch (_) { continue; }
      }
      onMsg(fmt, off);
      off += bodyLen;
      if ((++n & 4095) === 0) {
        if (isCancelled && isCancelled()) throw new Cancelled();
        await tick(off);
      }
    }
    return { skipped, messages: n };
  }

  // ---------------------------------------------------------------------------
  // Text DataFlash scanning (pymavlink DFReader_text._parse_next)
  // ---------------------------------------------------------------------------
  function indexOfBytes(u8, pat, from = 0) {
    const first = pat[0], last = u8.length - pat.length;
    for (let i = u8.indexOf(first, from); i !== -1 && i <= last; i = u8.indexOf(first, i + 1)) {
      let ok = true;
      for (let k = 1; k < pat.length; k++) if (u8[i + k] !== pat[k]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }
  const enc = (s) => new TextEncoder().encode(s);

  function textStart(u8) {
    let off = indexOfBytes(u8, enc('FMT, '));
    if (off !== -1) return { off, delim: ', ' };
    off = indexOfBytes(u8, enc('FMT,'));
    return { off, delim: ',' };
  }

  async function scanText(u8, formats, start, onMsg, tick, isCancelled) {
    const { delim } = start;
    const len = u8.length;
    let off = start.off, n = 0;
    const CHUNK = 4 << 20;
    while (off < len) {
      // decode a block that ends on a newline; a final unterminated line is
      // never emitted (pymavlink returns None for it)
      let end = Math.min(len, off + CHUNK);
      let nl = u8.lastIndexOf(10, end - 1);
      if (nl < off) {
        if (end === len) break;
        nl = u8.indexOf(10, end);
        if (nl === -1) break;
      }
      end = nl + 1;
      const text = utf8Lenient.decode(u8.subarray(off, end));
      const arr = text.split('\n');
      arr.pop(); // block ends with '\n'
      for (let li = 0; li < arr.length; li++) {
        const line = arr[li].replace(/[ \t\n\r\v\f]+$/, '');
        let el = line.split(delim);
        if (el.length < 2) continue;
        if (el.length === 5 && el[4] === ',') { el[4] = ''; el.push(''); }
        const fmt = formats[el[0]];
        if (!fmt) continue;
        if (el.length < fmt.format.length + 1) continue;
        el = el.slice(1);
        if (fmt.name === 'FMT') {
          try {
            const ftype = pyInt(el[0]); const fname = el[2];
            if (!/^\s*[+-]?\d+\s*$/.test(el[0]) || !/^\s*[+-]?\d+\s*$/.test(el[1])) continue;
            if (delim === ',') el = el.slice(0, 4).concat([el.slice(4).join(',')]);
            let columns = el[4];
            if (fname === 'FMT' && columns === 'Type,Length,Name,Format') columns = 'Type,Length,Name,Format,Columns';
            formats[fname] = makeFormat(ftype, fname, pyInt(el[1]), el[3], columns);
          } catch (_) { continue; }
        }
        onMsg(fmt, el);
        if ((++n & 4095) === 0) {
          if (isCancelled && isCancelled()) throw new Cancelled();
          await tick(off);
        }
      }
      off = end;
      await tick(off);
    }
    return { skipped: 0, messages: n };
  }

  // ---------------------------------------------------------------------------
  // Column model
  // ---------------------------------------------------------------------------
  // storage key per (format char, mode)
  function keyFor(c, fmtName, text) {
    if (text) {
      if (c === 'Z' && fmtName === 'FILE') return 'traw';
      if (c === 'M' || c === 'a') return 'traw';
      if (STR_CHARS.includes(c)) return 'tstr';
      if (c === 'q' || c === 'Q') return c;
      if (INT_CHARS.includes(c)) return 'tint';
      return 'tflt';
    }
    if (c === 'Z' && fmtName === 'FILE') return 'file';
    return c;
  }
  const isStrKey = (k) => k === 'n' || k === 'N' || k === 'Z' || k === 'tstr' || k === 'traw';

  function allocColumn(col) {
    const n = col.n;
    const keys = [...col.keys];
    if (keys.length === 1) {
      const k = keys[0];
      col.kind = k;
      switch (k) {
        case 'b': case 'M': col.arr = new Int8Array(n); col.out = 'int'; break;
        case 'B': col.arr = new Uint8Array(n); col.out = 'int'; break;
        case 'h': col.arr = new Int16Array(n); col.out = 'int'; break;
        case 'H': col.arr = new Uint16Array(n); col.out = 'int'; break;
        case 'i': col.arr = new Int32Array(n); col.out = 'int'; break;
        case 'I': col.arr = new Uint32Array(n); col.out = 'int'; break;
        case 'q': col.arr = new BigInt64Array(n); col.out = 'int'; break;
        case 'Q': col.arr = new BigUint64Array(n); col.out = 'int'; break;
        case 'f': case 'g': col.arr = new Float32Array(n); col.out = 'double'; break;
        case 'd': col.arr = new Float64Array(n); col.out = 'double'; break;
        case 'c': col.arr = new Int16Array(n); col.out = 'double'; col.div = DIVISOR.c; break;
        case 'C': col.arr = new Uint16Array(n); col.out = 'double'; col.div = DIVISOR.C; break;
        case 'e': col.arr = new Int32Array(n); col.out = 'double'; col.div = DIVISOR.e; break;
        case 'E': col.arr = new Uint32Array(n); col.out = 'double'; col.div = DIVISOR.E; break;
        case 'L': col.arr = new Int32Array(n); col.out = 'double'; col.div = DIVISOR.L; break;
        case 'a': col.arr = new Int16Array(n * 32); col.out = 'int16x32'; break;
        case 'file': col.arr = new Uint8Array(n * 64); col.out = 'bytes64'; break;
        case 'tint': col.arr = new Float64Array(n); col.out = 'int'; break;
        case 'tflt': col.arr = new Float64Array(n); col.out = 'double'; break;
        default: col.arr = new Array(n); col.out = 'char'; // n N Z tstr traw
      }
    } else if (keys.some(isStrKey) || keys.includes('a') || keys.includes('file')) {
      col.kind = 'mixstr'; col.arr = new Array(n); col.out = 'char';
    } else {
      col.kind = 'mixnum'; col.arr = new Float64Array(n); col.out = 'double';
    }
    col.n = 0;
  }

  // generic decode (only used for columns whose format changed mid-log)
  function genericBinary(u8, dv, p, c, fmtName) {
    switch (c) {
      case 'b': case 'M': return dv.getInt8(p);
      case 'B': return u8[p];
      case 'h': return dv.getInt16(p, true);
      case 'H': return dv.getUint16(p, true);
      case 'i': return dv.getInt32(p, true);
      case 'I': return dv.getUint32(p, true);
      case 'q': return Number(dv.getBigInt64(p, true));
      case 'Q': return Number(dv.getBigUint64(p, true));
      case 'f': return dv.getFloat32(p, true);
      case 'g': return half(dv.getUint16(p, true));
      case 'd': return dv.getFloat64(p, true);
      case 'c': return dv.getInt16(p, true) / DIVISOR.c;
      case 'C': return dv.getUint16(p, true) / DIVISOR.C;
      case 'e': return dv.getInt32(p, true) / DIVISOR.e;
      case 'E': return dv.getUint32(p, true) / DIVISOR.E;
      case 'L': return dv.getInt32(p, true) / DIVISOR.L;
      case 'a': { const v = []; for (let j = 0; j < 32; j++) v.push(dv.getInt16(p + 2 * j, true)); return `array('h', [${v.join(', ')}])`; }
      case 'Z': if (fmtName === 'FILE') return latin1(u8.subarray(p, p + 64)); // fallthrough
      default: return fixedStr(u8, p, SIZE[c]);
    }
  }
  // number -> text, only for columns whose type changed between numbers and strings mid-log
  const pyStr = (v) => (typeof v !== 'number' ? String(v)
    : Number.isNaN(v) ? 'nan' : v === Infinity ? 'inf' : v === -Infinity ? '-inf' : String(v));

  // ---------------------------------------------------------------------------
  // Public: parse a log into columns
  // ---------------------------------------------------------------------------
  function detect(u8) {
    if (u8.length >= 2 && u8[0] === 0xa3 && u8[1] === 0x95) return 'binary';
    const head = latin1(u8.subarray(0, 8000));
    if (head.includes('FMT,')) return 'text';
    if (indexOfBytes(u8.subarray(0, 1 << 16), [0xa3, 0x95, 0x80]) !== -1) return 'binary';
    return null;
  }

  async function parse(input, opts = {}) {
    const { onProgress, isCancelled } = opts;
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const kind = opts.kind || detect(u8);
    if (!kind) {
      const err = new Error('This does not look like an ArduPilot DataFlash log. Expected a binary .bin or a text .log (MAVLink .tlog files are not supported).');
      err.code = 'NOT_DATAFLASH';
      throw err;
    }
    const text = kind === 'text';
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const total = u8.length || 1;

    // pass 0: discover all formats (pymavlink pre-scans the log before reading)
    let base;
    let start;
    if (text) {
      start = textStart(u8);
      if (start.off < 0) throw new Error('No FMT lines found in this text log.');
      base = { FMT: FMT_FMT() };
      await scanText(u8, base, start, () => {}, makeTicker(onProgress, 0, 0.12, total), isCancelled);
    } else {
      base = { 0x80: FMT_FMT() };
      await scanBinary(u8, dv, base, () => {}, makeTicker(onProgress, 0, 0.12, total), isCancelled);
    }

    // pass 1: count messages per layout, build field order
    const msgs = new Map();     // name -> { name, count, fields: Map(fieldName -> col) }
    const layouts = new Map();  // sig  -> { name, count, ops: [{col, idx, off, c, k}] }
    function layoutFor(fmt) {
      let lay = layouts.get(fmt.sig);
      if (lay) return lay;
      let m = msgs.get(fmt.name);
      if (!m) { m = { name: fmt.name, count: 0, fields: new Map(), format: fmt.format }; msgs.set(fmt.name, m); }
      const colhash = new Map();
      fmt.columns.forEach((c, i) => colhash.set(c, i));
      const ops = [];
      const seen = new Set();
      for (const cname of fmt.columns) {
        if (seen.has(cname)) continue;
        seen.add(cname);
        if (cname === 'mavpackettype') continue;
        const idx = colhash.get(cname);
        if (idx >= fmt.format.length) continue; // pymavlink would crash here
        const c = fmt.format[idx];
        const k = keyFor(c, fmt.name, text);
        let col = m.fields.get(cname);
        if (!col) { col = { name: cname, n: 0, keys: new Set() }; m.fields.set(cname, col); }
        col.keys.add(k);
        ops.push({ col, idx, off: fmt.offsets[idx], c, k });
      }
      lay = { name: fmt.name, msg: m, count: 0, ops };
      layouts.set(fmt.sig, lay);
      return lay;
    }
    const count = (fmt) => {
      const lay = layoutFor(fmt);
      lay.count++; lay.msg.count++;
      for (const op of lay.ops) op.col.n++;
    };
    // each pass starts from the formats discovered in pass 0
    const scan = (onMsg, lo, hi) => (text
      ? scanText(u8, { ...base }, start, onMsg, makeTicker(onProgress, lo, hi, total), isCancelled)
      : scanBinary(u8, dv, { ...base }, onMsg, makeTicker(onProgress, lo, hi, total), isCancelled));
    const scanInfo = await scan(count, 0.12, 0.3);

    for (const m of msgs.values()) for (const col of m.fields.values()) allocColumn(col);

    // pass 2: decode values
    const fill2 = text
      ? (fmt, el) => {
          const lay = layouts.get(fmt.sig);
          for (const op of lay.ops) {
            const col = op.col, v = el[op.idx];
            switch (col.kind) {
              case 'tint': col.arr[col.n++] = pyInt(v); break;
              case 'tflt': col.arr[col.n++] = pyFloat(v); break;
              case 'q': col.arr[col.n++] = BigInt.asIntN(64, pyBigInt(v)); break;
              case 'Q': col.arr[col.n++] = BigInt.asUintN(64, pyBigInt(v)); break;
              case 'tstr': col.arr[col.n++] = cutNull(v); break;
              case 'traw': col.arr[col.n++] = v; break;
              case 'mixnum': col.arr[col.n++] = op.k === 'tint' || op.k === 'q' || op.k === 'Q' ? pyInt(v) : pyFloat(v); break;
              default: { // mixstr
                let s;
                if (op.k === 'tstr') s = cutNull(v);
                else if (op.k === 'traw') s = v;
                else if (op.k === 'tflt') s = pyStr(pyFloat(v));
                else s = String(pyBigInt(v));
                col.arr[col.n++] = s;
              }
            }
          }
        }
      : (fmt, p) => {
          const lay = layouts.get(fmt.sig);
          for (const op of lay.ops) {
            const col = op.col, q = p + op.off;
            switch (col.kind) {
              case 'b': case 'M': case 'B': col.arr[col.n++] = u8[q]; break; // typed array wraps sign
              case 'h': case 'c': col.arr[col.n++] = dv.getInt16(q, true); break;
              case 'H': case 'C': col.arr[col.n++] = dv.getUint16(q, true); break;
              case 'i': case 'e': case 'L': col.arr[col.n++] = dv.getInt32(q, true); break;
              case 'I': case 'E': col.arr[col.n++] = dv.getUint32(q, true); break;
              case 'q': col.arr[col.n++] = dv.getBigInt64(q, true); break;
              case 'Q': col.arr[col.n++] = dv.getBigUint64(q, true); break;
              case 'f': col.arr[col.n++] = dv.getFloat32(q, true); break;
              case 'g': col.arr[col.n++] = half(dv.getUint16(q, true)); break;
              case 'd': col.arr[col.n++] = dv.getFloat64(q, true); break;
              case 'a': { const base = col.n++ * 32; for (let j = 0; j < 32; j++) col.arr[base + j] = dv.getInt16(q + 2 * j, true); break; }
              case 'file': col.arr.set(u8.subarray(q, q + 64), col.n++ * 64); break;
              case 'n': col.arr[col.n++] = fixedStr(u8, q, 4); break;
              case 'N': col.arr[col.n++] = fixedStr(u8, q, 16); break;
              case 'Z': col.arr[col.n++] = fixedStr(u8, q, 64); break;
              case 'mixnum': col.arr[col.n++] = genericBinary(u8, dv, q, op.c, fmt.name); break;
              default: { const v = genericBinary(u8, dv, q, op.c, fmt.name); col.arr[col.n++] = typeof v === 'string' ? v : pyStr(v); }
            }
          }
        };
    await scan(fill2, 0.3, 1);
    if (onProgress) onProgress(1);

    // Assemble result in first-seen order
    const messages = [];
    let tMin = null, tMax = null;
    for (const m of msgs.values()) {
      const fields = [...m.fields.values()].map((col) => ({ name: col.name, col }));
      messages.push({ name: m.name, count: m.count, format: m.format, fields });
      const tc = m.fields.get('TimeUS');
      if (tc && (tc.kind === 'Q' || tc.kind === 'q') && tc.n) {
        for (let i = 0; i < tc.n; i++) {
          const v = tc.arr[i];
          if (v === 0n) continue;
          if (tMin === null || v < tMin) tMin = v;
          if (tMax === null || v > tMax) tMax = v;
        }
      }
    }
    const totalMessages = messages.reduce((s, m) => s + m.count, 0);
    return {
      kind, messages, totalMessages, skippedBytes: scanInfo.skipped, byteLength: u8.length,
      timeStartUS: tMin === null ? null : Number(tMin), timeEndUS: tMax === null ? null : Number(tMax),
      firmware: findFirmware(messages),
    };
  }

  function findFirmware(messages) {
    const get = (mn, fn) => {
      const m = messages.find((x) => x.name === mn); if (!m) return null;
      const f = m.fields.find((x) => x.name === fn); if (!f || f.col.out !== 'char') return null;
      return f.col.arr;
    };
    const fws = get('VER', 'FWS');
    if (fws && fws[0]) return fws[0].trim();
    const msg = get('MSG', 'Message');
    if (msg) for (const s of msg) if (/^(Ardu|ArduCopter|ArduPlane|ArduRover|ArduSub|Blimp|AntennaTracker|Rover|Copter|Plane)/.test(s)) return s.trim();
    return null;
  }

  // numeric view of a column, for charts (null if not numeric)
  function numeric(col) {
    if (col.out === 'char' || col.out === 'bytes64' || col.out === 'int16x32') return null;
    const n = col.n, a = col.arr, out = new Float64Array(n);
    if (col.div) for (let i = 0; i < n; i++) out[i] = a[i] / col.div;
    else if (col.kind === 'q' || col.kind === 'Q') for (let i = 0; i < n; i++) out[i] = Number(a[i]);
    else for (let i = 0; i < n; i++) out[i] = a[i];
    return out;
  }

  // ---------------------------------------------------------------------------
  // MAT-file v5 writer (layout follows scipy.io.savemat, format='5')
  // ---------------------------------------------------------------------------
  const mi = { INT8: 1, INT16: 3, INT32: 5, UINT32: 6, DOUBLE: 9, INT64: 12, UINT64: 13, MATRIX: 14, COMPRESSED: 15, UTF8: 16 };
  const mx = { STRUCT: 2, CHAR: 4, DOUBLE: 6, INT16: 10, INT64: 14, UINT64: 15 };
  const pad8 = (n) => (8 - (n % 8)) % 8;
  const ZERO8 = new Uint8Array(8);

  function u32(...vals) { const b = new Uint8Array(vals.length * 4); const d = new DataView(b.buffer); vals.forEach((v, i) => d.setUint32(i * 4, v >>> 0, true)); return b; }
  function i32pair(type, bytes, a, b) { const out = new Uint8Array(16); const d = new DataView(out.buffer); d.setUint32(0, type, true); d.setUint32(4, bytes, true); d.setInt32(8, a, true); d.setInt32(12, b, true); return out; }

  // data element: small format when ≤ 4 bytes (as scipy does)
  function element(type, data, parts) {
    const n = data.byteLength;
    if (n <= 4) {
      const b = new Uint8Array(8); const d = new DataView(b.buffer);
      d.setUint32(0, ((n << 16) | type) >>> 0, true);
      b.set(new Uint8Array(data.buffer, data.byteOffset, n), 4);
      parts.push(b); return 8;
    }
    parts.push(u32(type, n));
    parts.push(data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, n));
    const p = pad8(n); if (p) parts.push(ZERO8.subarray(0, p));
    return 8 + n + p;
  }
  function nameElement(name, parts) {
    if (name === '') { parts.push(u32(mi.INT8, 0)); return 8; } // small element, zero bytes
    return element(mi.INT8, enc(name), parts);
  }
  function header(mxClass, d0, d1, name, parts) {
    let n = 0;
    parts.push(u32(mi.UINT32, 8, mxClass, 0)); n += 16;
    parts.push(i32pair(mi.INT32, 8, d0, d1)); n += 16;
    n += nameElement(name, parts);
    return n;
  }
  function matrix(build) { // wraps sub-elements in a miMATRIX tag
    const parts = []; const n = build(parts);
    if (n > 0xffffffff - 8) throw new Error('A single MATLAB variable would exceed 4 GB. Deselect some message types and try again.');
    return { parts: [u32(mi.MATRIX, n), ...parts], size: n + 8 };
  }

  function toInt64Bytes(col) {
    const n = col.n, a = col.arr;
    if (col.kind === 'q' || col.kind === 'Q') return new Uint8Array(a.buffer, a.byteOffset, n * 8);
    const out = new Uint32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = a[i];
      if (x >= 0 && x < 4294967296) { out[2 * i] = x; out[2 * i + 1] = 0; }
      else { const hi = Math.floor(x / 4294967296); out[2 * i] = x - hi * 4294967296; out[2 * i + 1] = hi | 0; }
    }
    return new Uint8Array(out.buffer);
  }
  function toDouble(col) {
    const n = col.n, a = col.arr;
    if (col.kind === 'd' || col.kind === 'tflt' || col.kind === 'tint' || col.kind === 'mixnum') return a.subarray(0, n);
    const out = new Float64Array(n);
    if (col.div) for (let i = 0; i < n; i++) out[i] = a[i] / col.div;
    else if (col.kind === 'q' || col.kind === 'Q') for (let i = 0; i < n; i++) out[i] = Number(a[i]);
    else for (let i = 0; i < n; i++) out[i] = a[i];
    return out;
  }

  // char matrix N×W, column-major, encoded as UTF-8 (scipy: miUTF8, NULs → spaces)
  function charField(strings, n, parts) {
    let W = 0, ascii = true;
    const cps = new Array(n);
    for (let i = 0; i < n; i++) {
      const s = strings[i];
      let isAscii = true;
      for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) > 0x7f) { isAscii = false; break; }
      if (isAscii) { cps[i] = s; if (s.length > W) W = s.length; }
      else { ascii = false; const a = Array.from(s); cps[i] = a; if (a.length > W) W = a.length; }
    }
    if (n === 0 || W === 0) { // all empty -> 0×0 char with an empty miUTF8 small element
      const k = header(mx.CHAR, 0, 0, '', parts);
      parts.push(u32(mi.UTF8, 0));
      return k + 8;
    }
    let k = header(mx.CHAR, n, W, '', parts);
    if (ascii) {
      const out = new Uint8Array(n * W).fill(32);
      for (let i = 0; i < n; i++) {
        const s = cps[i];
        for (let j = 0; j < s.length; j++) { const ch = s.charCodeAt(j); out[j * n + i] = ch === 0 ? 32 : ch; }
      }
      return k + element(mi.UTF8, out, parts);
    }
    const chars = new Array(n * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < n; i++) {
      const s = cps[i];
      const ch = typeof s === 'string' ? s[j] : s[j];
      chars[j * n + i] = ch === undefined || ch === '\0' ? ' ' : ch;
    }
    return k + element(mi.UTF8, enc(chars.join('')), parts);
  }
  function bytesField(col, parts) { // FILE.Data: raw 64-byte blocks shown as chars
    const n = col.n, a = col.arr, W = 64;
    const strs = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = '';
      for (let j = 0; j < W; j++) { const b = a[i * W + j]; s += String.fromCharCode(b === 0 ? 32 : b); }
      strs[i] = s;
    }
    return charField(strs, n, parts);
  }

  function fieldMatrix(col, opts) {
    return matrix((parts) => {
      const n = col.n;
      if (col.out === 'char') return charField(col.arr, n, parts);
      if (col.out === 'bytes64') return bytesField(col, parts);
      if (col.out === 'int16x32') {
        const a = col.arr;
        if (opts.integersAsDouble) {
          const out = new Float64Array(n * 32);
          for (let i = 0; i < n; i++) for (let j = 0; j < 32; j++) out[j * n + i] = a[i * 32 + j];
          return header(mx.DOUBLE, n, 32, '', parts) + element(mi.DOUBLE, out, parts);
        }
        const out = new Int16Array(n * 32);
        for (let i = 0; i < n; i++) for (let j = 0; j < 32; j++) out[j * n + i] = a[i * 32 + j];
        return header(mx.INT16, n, 32, '', parts) + element(mi.INT16, out, parts);
      }
      if (col.out === 'int' && !opts.integersAsDouble) {
        let cls = mx.INT64, typ = mi.INT64;
        if (col.kind === 'Q') { for (let i = 0; i < n; i++) if (col.arr[i] >= 0x8000000000000000n) { cls = mx.UINT64; typ = mi.UINT64; break; } }
        return header(cls, 1, n, '', parts) + element(typ, toInt64Bytes(col), parts);
      }
      return header(mx.DOUBLE, 1, n, '', parts) + element(mi.DOUBLE, toDouble(col), parts);
    });
  }

  function structMatrix(name, fields, opts) {
    const valid = fields.filter((f) => f.name !== '' && !/^[_0-9]/.test(f.name)); // scipy drops these
    const subs = valid.map((f) => fieldMatrix(f.col, opts));
    return matrix((parts) => {
      let n = header(mx.STRUCT, 1, 1, name, parts);
      if (!valid.length) {
        n += element(mi.INT32, new Int32Array([1]), parts);
        n += element(mi.INT8, new Uint8Array(0), parts);
        return n;
      }
      const L = Math.max(...valid.map((f) => enc(f.name).length)) + 1;
      n += element(mi.INT32, new Int32Array([L]), parts);
      const names = new Uint8Array(L * valid.length);
      valid.forEach((f, i) => names.set(enc(f.name), i * L));
      n += element(mi.INT8, names, parts);
      for (const s of subs) { parts.push(...s.parts); n += s.size; }
      return n;
    });
  }

  async function deflate(parts) {
    const cs = new CompressionStream('deflate'); // zlib wrapper, as MAT-files need
    const writer = cs.writable.getWriter();
    const out = [];
    const reading = (async () => {
      const reader = cs.readable.getReader();
      for (;;) { const { value, done } = await reader.read(); if (done) break; out.push(value); }
    })();
    for (const p of parts) await writer.write(p);
    await writer.close();
    await reading;
    return out;
  }

  function fileHeader(opts) {
    const h = new Uint8Array(128).fill(32);
    const d = new Date();
    const stamp = d.toUTCString().replace(' GMT', ' UTC');
    const text = `MATLAB 5.0 MAT-file, Platform: ${opts.platform || 'web'}, Created on: ${stamp} by BIN/LOG to MAT web converter`;
    h.set(enc(text).subarray(0, 116));
    h.fill(0, 116, 124);              // subsystem data offset
    h[124] = 0x00; h[125] = 0x01;     // version 0x0100
    h[126] = 0x49; h[127] = 0x4d;     // 'IM' → little-endian
    return h;
  }

  /**
   * Build the .mat file.
   * opts.include: Set of message names to include (default: all)
   * opts.integersAsDouble: store integer fields as double instead of int64
   * opts.compress: zlib-compress each variable (MATLAB loads these natively)
   */
  async function toMat(log, opts = {}) {
    const { onProgress, isCancelled } = opts;
    const BlobCtor = typeof Blob !== 'undefined' ? Blob : null;
    const chunks = [fileHeader(opts)];
    const list = log.messages.filter((m) => (!opts.include || opts.include.has(m.name)) && !m.name.startsWith('_'));
    const totalCols = list.reduce((s, m) => s + m.fields.length + 1, 0) || 1;
    let done = 0, last = now();
    for (const m of list) {
      if (isCancelled && isCancelled()) throw new Cancelled();
      const sm = structMatrix(m.name, m.fields, opts);
      let piece;
      if (opts.compress) {
        const comp = await deflate(sm.parts);
        const size = comp.reduce((s, c) => s + c.byteLength, 0);
        piece = [u32(mi.COMPRESSED, size), ...comp];
      } else piece = sm.parts;
      chunks.push(BlobCtor ? new BlobCtor(piece) : piece);
      done += m.fields.length + 1;
      if (onProgress && now() - last > 40) { last = now(); onProgress(done / totalCols); await nextTick(); }
    }
    if (onProgress) onProgress(1);
    if (BlobCtor) return new BlobCtor(chunks, { type: 'application/octet-stream' });
    return chunks.flat();
  }

  // rough uncompressed size of the output, for the UI
  function estimateSize(log, include, integersAsDouble) {
    let s = 128;
    for (const m of log.messages) {
      if (include && !include.has(m.name)) continue;
      s += 64 + m.fields.length * 16;
      for (const f of m.fields) {
        const c = f.col;
        s += 48;
        if (c.out === 'char') s += c.n * 8; // rough
        else if (c.out === 'bytes64') s += c.n * 64;
        else if (c.out === 'int16x32') s += c.n * 32 * (integersAsDouble ? 8 : 2);
        else s += c.n * 8;
      }
    }
    return s;
  }

  return { parse, toMat, numeric, detect, estimateSize, Cancelled, _internals: { half, pyFloat, fixedStr } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BinMat;
