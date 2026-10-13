/** Engine.gs — mesin jadwal MURNI (tanpa API Google). Dipakai Code.gs; diuji di Node (tests/run_tests.js).
 * Satu sumber kebenaran: rotasi 12 hari, cover, konflik, coverage, rencana impor, rantai audit.
 */
var ENGINE = (function () {
  'use strict';
  var DEFAULTS = {
    shifts: ['M8', 'P8', 'S8', 'P', 'Off'],
    masterStart: '2026-10-01',
    cycleLength: 12,
    coverageMin: { M8: 1, P8: 1, S8: 1 },
    forbiddenTransitions: [['S8', 'M8']],
    maxConsecutiveWork: 7
  };
  // ---------- tanggal (UTC, bebas zona waktu) ----------
  function isValidIso(s) {
    s = String(s || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function ms(s) { var p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { return new Date(ms(s) + n * 86400000).toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((ms(a) - ms(b)) / 86400000); }
  function mod(a, n) { return ((a % n) + n) % n; }
  function range(a, b) { var o = []; for (var d = a; d <= b; d = addDays(d, 1)) o.push(d); return o; }
  function monthDates(ym) {
    var p = ym.split('-').map(Number), n = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(), o = [];
    for (var i = 1; i <= n; i++) o.push(ym + '-' + (i < 10 ? '0' : '') + i);
    return o;
  }
  function isKeterangan(n) { return /^keterangan:?$/i.test(String(n || '').trim()); }
  // masterStart/cycleLength sengaja TIDAK bisa diubah lewat konfigurasi (proteksi master).
  function cfg(over) {
    var c = {}, k;
    for (k in DEFAULTS) c[k] = DEFAULTS[k];
    if (over) ['coverageMin', 'forbiddenTransitions', 'maxConsecutiveWork'].forEach(function (key) { if (over[key] !== undefined) c[key] = over[key]; });
    c.masterEnd = addDays(c.masterStart, c.cycleLength - 1);
    return c;
  }
  // ---------- model rotasi ----------
  function buildModel(people, schedule, c) {
    c = c || cfg();
    var ppl = people.filter(function (p) { return !isKeterangan(p.name); });
    var byKey = {}, dupes = {};
    schedule.forEach(function (s) {
      if (isKeterangan(s.name) || !s.date) return;
      var k = s.personnelId + '|' + s.date;
      if (byKey[k] !== undefined) dupes[k] = true;
      byKey[k] = String(s.shift == null ? '' : s.shift).trim();
    });
    var cycles = {}, errors = [];
    ppl.forEach(function (p) {
      var seq = [], bad = false;
      for (var i = 0; i < c.cycleLength; i++) {
        var d = addDays(c.masterStart, i), k = p.id + '|' + d, v = byKey[k], e = null;
        if (dupes[k]) e = ['DUPLICATE', p.name + ' memiliki duplikat master pada ' + d];
        else if (v === undefined || v === '') e = ['MISSING', p.name + ' tidak memiliki shift sumber pada ' + d];
        else if (c.shifts.indexOf(v) < 0) e = ['INVALID', p.name + ' memiliki kode shift tidak valid "' + v + '" pada ' + d];
        if (e) { errors.push({ personnelId: p.id, name: p.name, code: e[0], date: d, message: e[1] }); bad = true; } else seq.push(v);
      }
      if (!bad) cycles[p.id] = seq;
    });
    return { cfg: c, people: ppl, byKey: byKey, cycles: cycles, errors: errors };
  }
  function baseShift(m, pid, date) {
    var c = m.cfg;
    if (date < c.masterStart) {
      var v = m.byKey[pid + '|' + date];
      return v ? { shift: v, src: 'HISTORY' } : { shift: '—', src: 'NONE' };
    }
    var seq = m.cycles[pid];
    if (!seq) return { shift: '—', src: 'NONE' };
    return { shift: seq[mod(diffDays(date, c.masterStart), c.cycleLength)], src: date <= c.masterEnd ? 'MASTER' : 'PROJECTED' };
  }
  function indexCovers(covers, statuses) {
    var ix = {}; statuses = statuses || ['APPROVED'];
    function add(k, v) { (ix[k] || (ix[k] = [])).push(v); }
    covers.forEach(function (cv) {
      if (statuses.indexOf(cv.status) < 0) return;
      add(cv.date + '|' + cv.ownerId, { role: 'OWNER', cv: cv });
      add(cv.date + '|' + cv.covererId, { role: 'COVERER', cv: cv });
    });
    return ix;
  }
  // shift kerja efektif = shift dasar (kecuali dilepas lewat cover) + shift yang diambil sebagai pengganti
  function effective(m, ix, pid, date) {
    var b = baseShift(m, pid, date), ev = ix[date + '|' + pid] || [], work = [];
    var released = ev.some(function (e) { return e.role === 'OWNER'; });
    if (!released && b.shift !== 'Off' && b.shift !== '—') work.push(b.shift);
    ev.forEach(function (e) { if (e.role === 'COVERER') work.push(e.cv.shift); });
    return { base: b.shift, src: b.src, work: work, ev: ev, released: released };
  }
  // ---------- konflik ----------
  function conflicts(m, covers, dates, pids) {
    var c = m.cfg, ix = indexCovers(covers), out = [];
    if (!dates.length) return out;
    var first = dates[0], last = dates[dates.length - 1], start = addDays(first, -2 * c.maxConsecutiveWork);
    m.people.forEach(function (p) {
      if (pids && pids.indexOf(p.id) < 0) return;
      var run = 0, prev = [];
      range(start, last).forEach(function (d) {
        var e = effective(m, ix, p.id, d), w = e.work, inR = d >= first;
        if (inR && w.length > 1) out.push({ level: 'ERROR', code: 'DOUBLE_ASSIGNMENT', personnelId: p.id, name: p.name, date: d, message: p.name + ' mendapat lebih dari satu penugasan pada ' + d + ' (' + w.join('+') + ')' });
        if (inR) c.forbiddenTransitions.forEach(function (t) {
          if (prev.indexOf(t[0]) >= 0 && w.indexOf(t[1]) >= 0) out.push({ level: 'WARN', code: 'QUICK_TURNAROUND', personnelId: p.id, name: p.name, date: d, message: p.name + ': ' + t[0] + ' lalu ' + t[1] + ' berurutan pada ' + d });
        });
        run = w.length ? run + 1 : 0;
        if (inR && run === c.maxConsecutiveWork + 1) out.push({ level: 'WARN', code: 'MAX_CONSECUTIVE', personnelId: p.id, name: p.name, date: d, message: p.name + ' bekerja lebih dari ' + c.maxConsecutiveWork + ' hari berturut-turut pada ' + d });
        prev = w;
      });
    });
    return out;
  }
  // ---------- coverage ----------
  function coverage(m, ix, date) {
    var counts = { M8: 0, P8: 0, S8: 0, P: 0, Off: 0 }, known = 0, missing = 0;
    m.people.forEach(function (p) {
      var e = effective(m, ix, p.id, date);
      if (e.base === '—') missing++; else { known++; if (!e.work.length) counts.Off++; }
      e.work.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    });
    var alerts = [];
    if (known > 0) Object.keys(m.cfg.coverageMin).forEach(function (s) {
      if ((counts[s] || 0) < m.cfg.coverageMin[s]) alerts.push({ shift: s, need: m.cfg.coverageMin[s], have: counts[s] || 0 });
    });
    return { date: date, counts: counts, alerts: alerts, incomplete: missing > 0 };
  }
  function buildMonth(m, covers, ym) {
    var dates = monthDates(ym), ix = indexCovers(covers), scheduled = 0;
    var rows = m.people.map(function (p) {
      return { id: p.id, name: p.name, cells: dates.map(function (d) {
        var e = effective(m, ix, p.id, d), cell = { s: e.base, src: e.src };
        if (e.base !== '—') scheduled++;
        if (e.ev.length) cell.cv = e.ev.map(function (x) { return { r: x.role, o: x.role === 'OWNER' ? x.cv.covererName : x.cv.ownerName, sh: x.cv.shift }; });
        return cell;
      }) };
    });
    return { dates: dates, rows: rows, scheduled: scheduled, coverage: dates.map(function (d) { return coverage(m, ix, d); }), conflicts: conflicts(m, covers, dates) };
  }
  // ---------- validasi & saran cover ----------
  function validateCover(m, covers, req, opts) {
    opts = opts || {};
    var errors = [], warnings = [], statuses = opts.statuses || ['PENDING', 'APPROVED'];
    function E(code, message) { errors.push({ code: code, message: message }); }
    function has(id) { return m.people.some(function (p) { return p.id === id; }); }
    if (!isValidIso(req.date)) E('BAD_DATE', 'Tanggal tidak valid.');
    if (!has(req.ownerId) || !has(req.covererId)) E('PERSON_NOT_FOUND', 'Personel tidak ditemukan atau tidak aktif.');
    if (req.ownerId === req.covererId) E('SAME_PERSON', 'Pemilik shift dan pengganti tidak boleh orang yang sama.');
    if (errors.length) return { ok: false, errors: errors, warnings: warnings };
    var ob = baseShift(m, req.ownerId, req.date), cb = baseShift(m, req.covererId, req.date);
    if (ob.shift === '—') E('OWNER_NO_SCHEDULE', 'Pemilik shift tidak punya jadwal pada tanggal ini.');
    else if (ob.shift === 'Off') E('OWNER_OFF', 'Pemilik shift sedang Off pada tanggal ini; tidak ada shift yang perlu di-cover.');
    else if (req.shift !== ob.shift) E('SHIFT_MISMATCH', 'Shift cover harus sama dengan shift pemilik (' + ob.shift + ').');
    if (cb.shift === '—') E('COVERER_NO_SCHEDULE', 'Pengganti tidak punya jadwal pada tanggal ini.');
    else if (cb.shift !== 'Off') E('COVERER_ON_DUTY', 'Pengganti sudah bertugas (' + cb.shift + ') pada tanggal ini; hanya personel Off yang bisa mengganti.');
    var act = covers.filter(function (x) { return x.id !== opts.excludeId && x.date === req.date && statuses.indexOf(x.status) >= 0; });
    if (act.some(function (x) { return x.ownerId === req.ownerId; })) E('OWNER_ALREADY_COVERED', 'Sudah ada permintaan pending/disetujui untuk shift personel tersebut pada tanggal ini.');
    if (act.some(function (x) { return x.covererId === req.covererId || x.ownerId === req.covererId; })) E('COVERER_BUSY', 'Pengganti sudah terlibat cover lain pada tanggal ini.');
    if (!errors.length) {
      var appr = covers.filter(function (x) { return x.status === 'APPROVED' && x.id !== opts.excludeId; });
      var cand = { id: '__cand__', date: req.date, ownerId: req.ownerId, covererId: req.covererId, shift: req.shift, status: 'APPROVED', ownerName: '', covererName: '' };
      var win = range(addDays(req.date, -14), addDays(req.date, 14)), seen = {};
      conflicts(m, appr, win, [req.covererId]).forEach(function (x) { seen[x.code + '|' + x.date] = 1; });
      conflicts(m, appr.concat([cand]), win, [req.covererId]).forEach(function (x) { if (!seen[x.code + '|' + x.date]) warnings.push(x); });
    }
    return { ok: errors.length === 0, errors: errors, warnings: warnings, ownerShift: ob.shift };
  }
  function suggestCovers(m, covers, req) {
    var ob = baseShift(m, req.ownerId, req.date);
    if (ob.shift === '—' || ob.shift === 'Off') return { ownerShift: ob.shift, suggestions: [] };
    var out = [];
    m.people.forEach(function (p) {
      if (p.id === req.ownerId) return;
      var v = validateCover(m, covers, { date: req.date, ownerId: req.ownerId, covererId: p.id, shift: ob.shift });
      if (!v.ok) return;
      var load = covers.filter(function (x) { return x.status === 'APPROVED' && x.covererId === p.id && Math.abs(diffDays(x.date, req.date)) <= 30; }).length;
      out.push({ personnelId: p.id, name: p.name, load30: load, warnings: v.warnings.map(function (w) { return w.code; }), score: v.warnings.length * 100 + load * 10 });
    });
    out.sort(function (a, b) { return a.score - b.score || a.name.localeCompare(b.name); });
    return { ownerShift: ob.shift, suggestions: out.slice(0, 5) };
  }
  // ---------- rencana impor (tanpa efek samping) ----------
  function planImport(existing, accepted, m) {
    var c = m.cfg, map = {}, r = { inserts: [], unchanged: 0, ignored: 0, mismatches: [], masterConflicts: [], historyChanges: [] };
    existing.forEach(function (s) { map[s.personnelId + '|' + s.date] = s.shift; });
    accepted.forEach(function (a) {
      var old = map[a.personnelId + '|' + a.date];
      if (a.date > c.masterEnd) {   // dikelola mesin rotasi; tidak pernah ditulis
        r.ignored++;
        var b = baseShift(m, a.personnelId, a.date);
        if (b.src === 'PROJECTED' && b.shift !== a.shift) r.mismatches.push({ name: a.name, date: a.date, imported: a.shift, projected: b.shift });
        return;
      }
      if (old !== undefined) {
        if (String(old) === a.shift) { r.unchanged++; return; }
        var o = { personnelId: a.personnelId, name: a.name, date: a.date, imported: a.shift, existing: String(old) };
        if (a.date >= c.masterStart) r.masterConflicts.push(o); else r.historyChanges.push(o);
        return;
      }
      r.inserts.push(a);
    });
    return r;
  }
  // ---------- rantai audit (hash chain) ----------
  function auditHash(prev, f, hasher) { return hasher([prev || '', f.id, f.ts, f.actor, f.action, f.entity, f.entityId, f.details].join('|')); }
  // rows: [id, ts, actor, action, entity, entityId, details, prev_hash, hash]
  function verifyAuditChain(rows, hasher, tsFmt, expectedHead) {
    var prev = '', checked = 0, legacy = 0, lastHash = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r[8]) {
        if (checked > 0) return { ok: false, brokenAt: i + 2, checked: checked, legacy: legacy, reason: 'Baris tanpa hash setelah rantai dimulai.' };
        legacy++; continue;
      }
      if (String(r[7] || '') !== prev) return { ok: false, brokenAt: i + 2, checked: checked, legacy: legacy, reason: 'Rantai terputus (baris dihapus/disisipkan).' };
      var exp = auditHash(prev, { id: r[0], ts: tsFmt(r[1]), actor: r[2], action: r[3], entity: r[4], entityId: r[5], details: r[6] }, hasher);
      if (exp !== String(r[8])) return { ok: false, brokenAt: i + 2, checked: checked, legacy: legacy, reason: 'Isi baris diubah.' };
      prev = lastHash = String(r[8]); checked++;
    }
    if (expectedHead && lastHash !== expectedHead) return { ok: false, brokenAt: rows.length + 1, checked: checked, legacy: legacy, reason: 'Baris terakhir audit dihapus atau diganti.' };
    return { ok: true, checked: checked, legacy: legacy };
  }
  return { DEFAULTS: DEFAULTS, cfg: cfg, isValidIso: isValidIso, addDays: addDays, diffDays: diffDays, range: range, monthDates: monthDates,
    isKeterangan: isKeterangan, buildModel: buildModel, baseShift: baseShift, indexCovers: indexCovers, effective: effective,
    conflicts: conflicts, coverage: coverage, buildMonth: buildMonth, validateCover: validateCover, suggestCovers: suggestCovers,
    planImport: planImport, auditHash: auditHash, verifyAuditChain: verifyAuditChain };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
