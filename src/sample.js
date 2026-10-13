/* Builds a small synthetic ArduPlane DataFlash log in memory (≈3 min flight
 * at the SITL "CMAC" field) so the page opens with something to show. */
function makeSampleLog() {
  'use strict';
  let seed = 20261014;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = (s = 1) => s * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const SZ = { b: 1, B: 1, M: 1, h: 2, H: 2, c: 2, C: 2, i: 4, I: 4, e: 4, E: 4, L: 4, f: 4, d: 8, q: 8, Q: 8, n: 4, N: 16, Z: 64 };
  const buf = new Uint8Array(1 << 21);
  const dv = new DataView(buf.buffer);
  let p = 0;
  const fmts = {};
  const str = (s, n) => { for (let k = 0; k < n; k++) buf[p + k] = k < s.length ? s.charCodeAt(k) : 0; p += n; };
  const put = (c, v) => {
    switch (c) {
      case 'Q': dv.setBigUint64(p, BigInt(Math.round(v)), true); break;
      case 'q': dv.setBigInt64(p, BigInt(Math.round(v)), true); break;
      case 'B': dv.setUint8(p, v); break;
      case 'b': case 'M': dv.setInt8(p, v); break;
      case 'h': dv.setInt16(p, Math.round(v), true); break;
      case 'H': dv.setUint16(p, Math.round(v), true); break;
      case 'i': dv.setInt32(p, Math.round(v), true); break;
      case 'I': dv.setUint32(p, Math.round(v), true); break;
      case 'f': dv.setFloat32(p, v, true); break;
      case 'd': dv.setFloat64(p, v, true); break;
      case 'c': dv.setInt16(p, Math.round(v * 100), true); break;
      case 'C': dv.setUint16(p, Math.round(v * 100), true); break;
      case 'e': dv.setInt32(p, Math.round(v * 100), true); break;
      case 'E': dv.setUint32(p, Math.round(v * 100), true); break;
      case 'L': dv.setInt32(p, Math.round(v * 1e7), true); break;
      default: str(v, SZ[c]); return;
    }
    p += SZ[c];
  };
  const hdr = (t) => { buf[p++] = 0xa3; buf[p++] = 0x95; buf[p++] = t; };
  const def = (t, name, format, cols, units, mults) => {
    fmts[t] = { name, format, units, mults };
    let len = 3; for (const c of format) len += SZ[c];
    hdr(0x80); put('B', t); put('B', len); str(name, 4); str(format, 16); str(cols, 64);
  };
  const msg = (t, ...vals) => { hdr(t); const f = fmts[t].format; for (let k = 0; k < f.length; k++) put(f[k], vals[k]); };

  def(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns');
  def(129, 'UNIT', 'QbZ', 'TimeUS,Id,Label');
  def(130, 'MULT', 'Qbd', 'TimeUS,Id,Mult');
  def(131, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds');
  def(132, 'PARM', 'QNff', 'TimeUS,Name,Value,Default', 's---', 'F---');
  def(133, 'MSG', 'QZ', 'TimeUS,Message', 's-', 'F-');
  def(134, 'MODE', 'QMBB', 'TimeUS,Mode,ModeNum,Rsn', 's---', 'F---');
  def(135, 'ATT', 'QccccCCCC', 'TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw,ErrRP,ErrYaw', 'sddddhhdh', 'F--------');
  def(136, 'GPS', 'QBBIHBcLLefffB', 'TimeUS,I,Status,GMS,GWk,NSats,HDop,Lat,Lng,Alt,Spd,GCrs,VZ,U', 's#-s-S-DUmnhn-', 'F--C----GG----');
  def(137, 'BARO', 'QBffcfI', 'TimeUS,I,Alt,Press,Temp,CRt,SMS', 's#mPOns', 'F------C');
  def(138, 'BAT', 'QBfffffc', 'TimeUS,Inst,Volt,VoltR,Curr,CurrTot,EnrgTot,Temp', 's#vvAaWO', 'F-------');
  def(139, 'RCOU', 'QHHHHHHHH', 'TimeUS,C1,C2,C3,C4,C5,C6,C7,C8', 'sYYYYYYYY', 'F--------');
  def(140, 'IMU', 'QBffffff', 'TimeUS,I,GyrX,GyrY,GyrZ,AccX,AccY,AccZ', 's#EEEooo', 'F-------');
  def(141, 'POS', 'QLLfff', 'TimeUS,Lat,Lng,Alt,RelHomeAlt,RelOriginAlt', 'sDUmmm', 'FGG---');
  def(142, 'ARSP', 'QBff', 'TimeUS,I,Airspeed,DiffPress', 's#nP', 'F---');

  const T0 = 12345678;
  const us = (t) => T0 + t * 1e6;
  [['s', 's'], ['d', 'deg'], ['h', 'degheading'], ['m', 'm'], ['n', 'm/s'], ['E', 'rad/s'], ['o', 'm/s/s'],
   ['P', 'Pa'], ['O', 'degC'], ['v', 'V'], ['A', 'A'], ['a', 'Ah'], ['W', 'Wh'], ['D', 'deglatitude'],
   ['U', 'deglongitude'], ['Y', 'us'], ['S', 'satellites'], ['#', 'instance'], ['-', '']].forEach(([id, l], k) => msg(129, us(0) + k, id.charCodeAt(0), l));
  [['-', 0], ['?', 1], ['C', 1e-3], ['F', 1e-6], ['G', 1e-7]].forEach(([id, m], k) => msg(130, us(0) + 30 + k, id.charCodeAt(0), m));
  for (const t of Object.keys(fmts)) { const f = fmts[t]; if (f.units) msg(131, us(0) + 60, +t, f.units, f.mults); }

  const at = (t, text) => msg(133, us(t), text);
  at(0.01, 'ArduPlane V4.5.7 (sample)');
  at(0.02, 'Synthetic sample flight for BIN to MAT');
  at(0.03, 'Frame: PLANE');
  at(0.04, 'GPS 1: detected u-blox at 230400 baud');
  [['SYSID_THISMAV', 1, 1], ['ARSPD_FBW_MIN', 12, 9], ['ARSPD_FBW_MAX', 24, 22], ['AIRSPEED_CRUISE', 18, 15],
   ['TECS_CLMB_MAX', 4, 5], ['TECS_SINK_MAX', 3, 5], ['WP_LOITER_RAD', 120, 60], ['WP_RADIUS', 40, 90],
   ['ROLL_LIMIT_DEG', 45, 45], ['PTCH_LIM_MAX_DEG', 20, 20], ['PTCH_LIM_MIN_DEG', -25, -25], ['THR_MAX', 85, 100],
   ['BATT_CAPACITY', 5000, 3300], ['BATT_MONITOR', 4, 0], ['RTL_ALTITUDE', 80, 100], ['LOG_BITMASK', 65535, 65535],
   ['SCHED_LOOP_RATE', 50, 50], ['INS_GYRO_FILTER', 20, 20]].forEach(([n, v, d], k) => msg(132, us(0.05) + k, n, v, d));
  msg(134, us(0.2), 0, 0, 1);

  // --- simple point-mass flight: takeoff, figure-eight, RTL, landing ---
  const g = 9.80665, R = 120, LAT0 = -35.363261, LNG0 = 149.16523, MSL0 = 584;
  const segs = [[30, 0], [8, 0], [2 * Math.PI * R / 18, -1], [8, 0], [2 * Math.PI * R / 18, 1], [24.4, 0]];
  let x = 0, y = 0, h = 0, v = 0, psi = Math.PI / 2, phi = 0, theta = 0, mah = 0, wh = 0, phiPrev = 0, vPrev = 0;
  let mode = 0, said = {};
  const dt = 0.02, TEND = 180;
  for (let k = 0; k <= TEND / dt; k++) {
    const t = k * dt;
    let vT = 0, r = 0, climb = 0, thr = 0;
    if (t >= 6 && mode === 0) { mode = 10; msg(134, us(t), 10, 10, 2); at(t, 'Mission: 1 Takeoff'); }
    if (t < 6) { vT = 0; thr = 0; }
    else if (t < 30) { vT = 18; thr = 85; climb = v > 12 ? Math.min(4, (80 - h) * 0.4) : 0; }
    else if (t < 150) {
      if (!said.wp) { said.wp = 1; at(t, 'Reached waypoint #1 dist 12m'); at(t + 0.01, 'Mission: 2 LoiterTurns'); }
      let tt = t - 30, s = 1;
      for (; s < segs.length && tt > segs[s][0]; s++) tt -= segs[s][0];
      const dir = s < segs.length ? segs[s][1] : 0;
      vT = 18; r = dir * vT / R; thr = 55 + 6 * Math.abs(dir); climb = (80 - h) * 0.5;
      if (dir && !said['turn' + s]) { said['turn' + s] = 1; at(t, dir < 0 ? 'Mission: 3 Loiter left' : 'Mission: 4 Loiter right'); }
    } else if (h > 0.05 || t < 155) {
      if (mode !== 11) { mode = 11; msg(134, us(t), 11, 11, 7); at(t, 'Mission complete, changing mode to RTL'); }
      const want = Math.atan2(-x, -y);
      let err = want - psi; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      vT = h > 15 ? 16 : 13; r = Math.max(-vT / R, Math.min(vT / R, err * 0.4)); thr = 30; climb = -Math.min(3.6, h * 0.35 + 0.6);
    } else {
      if (!said.land) { said.land = 1; at(t, 'Landing complete'); }
      vT = 0; thr = 0;
      if (t > 176 && !said.disarm) { said.disarm = 1; at(t, 'Throttle disarmed'); }
    }
    v += Math.max(-2.5, Math.min(3, (vT - v) * 0.6)) * dt;
    if (v < 0) v = 0;
    const phiCmd = Math.atan(v * r / g);
    phi += (phiCmd - phi) * Math.min(1, dt * 3) + gauss(0.0025) * (h > 1 ? 1 : 0);
    const gamma = v > 1 ? Math.asin(Math.max(-0.5, Math.min(0.5, climb / v))) : 0;
    const thetaCmd = h > 0.5 || climb > 0 ? gamma + 0.05 : 0;
    theta += (thetaCmd - theta) * Math.min(1, dt * 2.5) + gauss(0.0015) * (h > 1 ? 1 : 0);
    const turn = v > 1 ? g * Math.tan(phi) / v : 0;
    psi += turn * dt;
    const wind = h > 2 ? 3 : 0;
    x += (v * Math.cos(gamma) * Math.sin(psi) + wind * 0.7) * dt;
    y += (v * Math.cos(gamma) * Math.cos(psi) - wind * 0.7) * dt;
    h = Math.max(0, h + climb * dt);
    const yawDeg = ((psi * 180 / Math.PI) % 360 + 360) % 360;
    const deg = (a) => a * 180 / Math.PI;
    const curr = thr ? 1.2 + thr * 0.24 + gauss(0.3) : 0.9 + gauss(0.05);
    mah += curr * dt / 3.6;
    const volt = 16.7 - mah * 0.00045 - curr * 0.018 + gauss(0.01);
    wh += volt * curr * dt / 3600;
    const q = k;
    if (q % 2 === 0) { // ATT 25 Hz
      msg(135, us(t), deg(phiCmd), deg(phi), deg(thetaCmd), deg(theta), yawDeg, yawDeg, Math.abs(gauss(0.02)) + 0.01, Math.abs(gauss(0.03)) + 0.01);
    }
    // IMU 50 Hz
    const p_ = (phi - phiPrev) / dt; phiPrev = phi;
    const ax = (v - vPrev) / dt; vPrev = v;
    msg(140, us(t) + 37, 0, p_ + gauss(0.01), gauss(0.01) + (theta - thetaCmd) * 0.2, turn * Math.cos(phi) + gauss(0.008),
        ax + gauss(0.12), gauss(0.12), -g / Math.max(0.5, Math.cos(phi)) + gauss(0.2) - (h > 1 ? gauss(0.4) : 0));
    if (q % 5 === 0) { // 10 Hz
      const lat = LAT0 + (y / 6378137) * 180 / Math.PI;
      const lng = LNG0 + (x / (6378137 * Math.cos(LAT0 * Math.PI / 180))) * 180 / Math.PI;
      const press = 101325 * Math.pow(1 - 2.25577e-5 * (MSL0 + h), 5.25588) + gauss(2);
      msg(137, us(t) + 120, 0, h + gauss(0.12), press, 21.5 - 0.0065 * h + gauss(0.02), climb + gauss(0.1), Math.round((us(t) + 120) / 1000));
      msg(139, us(t) + 250, 1500 + Math.max(-400, Math.min(400, deg(phiCmd - phi) * 25 + deg(phiCmd) * 4)), 1500 - deg(theta - thetaCmd) * 20,
          thr ? 1000 + thr * 9 : 1000, 1500 + deg(r) * 2, 1500, 1000, 1000, 1500);
      msg(141, us(t) + 300, lat, lng, MSL0 + h, h, h);
      msg(142, us(t) + 340, 0, Math.max(0, v + gauss(0.25)), 0.5 * 1.225 * v * v + gauss(0.5));
      if (q % 10 === 0) { // 5 Hz
        const gs = Math.hypot(v * Math.sin(psi) + wind * 0.7, v * Math.cos(psi) - wind * 0.7);
        const crs = ((deg(Math.atan2(v * Math.sin(psi) + wind * 0.7, v * Math.cos(psi) - wind * 0.7)) % 360) + 360) % 360;
        msg(136, us(t) + 80, 0, 3, 312000000 + Math.round(t * 1000), 2440, 14 + (rnd() < 0.2 ? 1 : 0), 0.68 + gauss(0.02),
            lat + gauss(2e-7), lng + gauss(2e-7), MSL0 + h + gauss(0.3), gs, gs > 1 ? crs : 0, -climb, 1);
        msg(138, us(t) + 400, 0, volt, volt + curr * 0.018, curr, mah, wh, 24 + t * 0.03);
      }
    }
  }
  return buf.slice(0, p);
}
if (typeof module !== 'undefined' && module.exports) module.exports = makeSampleLog;
