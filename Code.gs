/** Schedule Personil + Cover Shift — Google Apps Script backend (v2: engine terpusat).
 * Bind script ke spreadsheet atau set SPREADSHEET_ID di Script Properties.
 * File: Code.gs (API & data) + Engine.gs (mesin jadwal murni). Jalankan setupApp() lalu setAdminPinFromEditor().
 * Opsional Script Property ENGINE_CONFIG (JSON): {"coverageMin":{"M8":2,"P8":2,"S8":1},"forbiddenTransitions":[["S8","M8"]],"maxConsecutiveWork":7}
 */
const APP = {
  spreadsheetId: '1D9VyUWlNaQC0ktI74ebL7lUFjdIjX36r20nbf395HW0',
  sheets: { personnel: 'PERSONNEL', schedule: 'BASE_SCHEDULE', covers: 'COVER_REQUESTS', users: 'USERS', audit: 'AUDIT_LOG' },
  shifts: ['M8','P8','S8','P','Off'],
  sessionSeconds: 21600,
  maxFailedLogins: 5,
  lockoutSeconds: 900,
  keepBackups: 5
};
let LOCK_DEPTH_ = 0;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index').setTitle('Schedule Personil + Cover Shift')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Schedule Personil')
    .addItem('Siapkan database aplikasi', 'setupApp')
    .addItem('Atur PIN Admin', 'setAdminPinFromEditor')
    .addItem('Cadangkan jadwal sekarang', 'backupNowFromEditor')
    .addItem('Verifikasi audit log', 'verifyAuditFromEditor')
    .addToUi();
}
function db_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || APP.spreadsheetId;
  return SpreadsheetApp.openById(id);
}
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock(); lock.waitLock(20000); LOCK_DEPTH_++;
  try { return fn(); } finally { LOCK_DEPTH_--; lock.releaseLock(); }
}
function setupApp() {
  const ss = db_();
  const specs = [
    [APP.sheets.personnel, ['personnel_id','nama','jabatan','status','created_at','updated_at']],
    [APP.sheets.schedule, ['schedule_id','personnel_id','nama','tanggal','shift_dasar','source','created_at','updated_at','updated_by']],
    [APP.sheets.covers, ['cover_id','tanggal','shift_owner_id','shift_owner_nama','coverer_id','coverer_nama','shift_cover','alasan','status','requested_by','requested_at','reviewed_by','reviewed_at','catatan_admin']],
    [APP.sheets.users, ['user_id','personnel_id','username','nama','role','pin_salt','pin_hash','status','created_at','last_login']],
    [APP.sheets.audit, ['audit_id','timestamp','actor','action','entity','entity_id','details','prev_hash','hash'], 7]
  ];
  specs.forEach(([name, headers, legacyLen]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1,1,1,headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1,1,1,headers.length).setFontWeight('bold');
    } else {
      const current = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getDisplayValues()[0];
      if (headers.some((h,i) => current[i] !== h)) {
        // migrasi aman: AUDIT_LOG lama (7 kolom) hanya ditambah 2 kolom hash di kanan
        const ok = legacyLen && headers.slice(0,legacyLen).every((h,i) => current[i] === h) && current.slice(legacyLen).every(x => !x);
        if (!ok) throw new Error('Header sheet '+name+' tidak sesuai. Jangan hapus data; periksa baris pertama.');
        sh.getRange(1,legacyLen+1,1,headers.length-legacyLen).setValues([headers.slice(legacyLen)]).setFontWeight('bold');
      }
    }
  });
  return {ok:true,message:'Sheet database siap. Jalankan setAdminPinFromEditor() untuk membuat PIN admin.'};
}
function ensureSetup_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('setup_ok')) return;
  setupApp(); cache.put('setup_ok','1',600);
}
function setAdminPinFromEditor() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt('Atur PIN Admin', 'Masukkan PIN admin baru (minimal 8 karakter). Simpan baik-baik.', ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const pin = String(result.getResponseText() || '');
  if (pin.length < 8) throw new Error('PIN minimal 8 karakter.');
  setupApp();
  withLock_(() => {
    const sh = db_().getSheetByName(APP.sheets.users);
    const values = sh.getDataRange().getValues();
    const salt = Utilities.getUuid(), hash = pinHash_(salt, pin);
    let row = values.findIndex((r,i) => i > 0 && String(r[2]).toUpperCase() === 'ADMIN') + 1;
    const record = ['USR-ADMIN','', 'ADMIN', 'Administrator', 'ADMIN', salt, hash, 'ACTIVE', new Date(), ''];
    if (row < 2) row = sh.getLastRow()+1;
    sh.getRange(row,1,1,record.length).setValues([record]);
    audit_('SYSTEM','SET_ADMIN_PIN','USERS','USR-ADMIN','PIN admin dibuat/diubah');
  });
  return 'PIN admin berhasil disimpan. Jangan bagikan PIN ini.';
}
function backupNowFromEditor() { SpreadsheetApp.getUi().alert('Cadangan dibuat: ' + withLock_(backupSchedule_)); }
function verifyAuditFromEditor() { const r = verifyAudit_(); SpreadsheetApp.getUi().alert(r.ok ? 'Audit log UTUH ('+r.checked+' baris berantai, '+r.legacy+' baris lama).' : 'AUDIT RUSAK di baris '+r.brokenAt+': '+r.reason); }

// ---------- util ----------
function pinHash_(salt,pin) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt)+'|'+String(pin), Utilities.Charset.UTF_8)); }
function hex_(bytes) { return bytes.map(b => ('0'+((b+256)%256).toString(16)).slice(-2)).join(''); }
function sha256_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function safeEq_(a,b) { a=String(a); b=String(b); let d=a.length^b.length; for(let i=0;i<Math.max(a.length,b.length);i++) d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0); return d===0; }
function id_(prefix) { return prefix+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,14).toUpperCase(); }
function norm_(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g,' '); }
function rows_(sheetName) {
  const sh = db_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().map((r,i) => ({r:r, row:i+2}));
}
function requireAdmin_(user) { if(!user || user.role!=='ADMIN') throw new Error('Fitur ini hanya untuk admin.'); }
function validIsoDate_(s) { return ENGINE.isValidIso(s); }
function dateIso_(v) {
  if(!v) return '';
  if(v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s=String(v);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d=new Date(s); return isNaN(d.getTime())?'':Utilities.formatDate(d,Session.getScriptTimeZone(),'yyyy-MM-dd');
}
function tsFmt_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : String(v); }
function engineCfg_() {
  let over = null;
  try { over = JSON.parse(PropertiesService.getScriptProperties().getProperty('ENGINE_CONFIG') || 'null'); } catch (e) {}
  return ENGINE.cfg(over);
}

// ---------- audit log berantai (hash chain) ----------
function audit_(actor,action,entity,entityId,details) {
  withLock_(() => {
    const sh = db_().getSheetByName(APP.sheets.audit), props = PropertiesService.getScriptProperties();
    const last = sh.getLastRow();
    const prev = last >= 2 ? String(sh.getRange(last,9).getValue() || '') : '';
    const now = new Date(), id = id_('AUD'), det = typeof details==='string'?details:JSON.stringify(details||{});
    const hash = ENGINE.auditHash(prev, {id:id, ts:tsFmt_(now), actor:String(actor||'SYSTEM'), action:action, entity:entity, entityId:entityId, details:det}, sha256_);
    sh.appendRow([id,now,String(actor||'SYSTEM'),action,entity,entityId,det,prev,hash]);
    props.setProperty('AUDIT_HEAD', hash);
  });
}
function verifyAudit_() {
  const rows = rows_(APP.sheets.audit).map(x => { const r = x.r.slice(0,9); while (r.length<9) r.push(''); return r; });
  return ENGINE.verifyAuditChain(rows, sha256_, tsFmt_, PropertiesService.getScriptProperties().getProperty('AUDIT_HEAD') || '');
}
function backupSchedule_() {
  const ss = db_(), src = ss.getSheetByName(APP.sheets.schedule);
  const copy = src.copyTo(ss);
  copy.setName('BACKUP_BASE_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss'));
  try { copy.hideSheet(); } catch (e) {}
  const names = ss.getSheets().map(s => s.getName()).filter(n => n.indexOf('BACKUP_BASE_') === 0).sort();
  names.slice(0, Math.max(0, names.length - APP.keepBackups)).forEach(n => ss.deleteSheet(ss.getSheetByName(n)));
  return copy.getName();
}

// ---------- loader data ----------
function loadPeople_() { return rows_(APP.sheets.personnel).map(x => ({id:String(x.r[0]),name:String(x.r[1]),role:String(x.r[2]||''),status:String(x.r[3]||'ACTIVE')})).filter(p => p.status.toUpperCase()==='ACTIVE'); }
function loadSchedule_() { return rows_(APP.sheets.schedule).map(x => ({id:String(x.r[0]),personnelId:String(x.r[1]),name:String(x.r[2]),date:dateIso_(x.r[3]),shift:String(x.r[4]),source:String(x.r[5]||''),row:x.row})).filter(s => s.date); }
function loadCovers_() { return rows_(APP.sheets.covers).map(x => ({id:String(x.r[0]),date:dateIso_(x.r[1]),ownerId:String(x.r[2]),ownerName:String(x.r[3]),covererId:String(x.r[4]),covererName:String(x.r[5]),shift:String(x.r[6]),reason:String(x.r[7]),status:String(x.r[8]),requestedBy:String(x.r[9]),requestedAt:dateIso_(x.r[10]),reviewedBy:String(x.r[11]),reviewedAt:dateIso_(x.r[12]),adminNote:String(x.r[13]||''),row:x.row})); }
function model_(people, sched) { return ENGINE.buildModel(people, sched, engineCfg_()); }
function msgs_(list) { return list.map(x => x.message).join('\n'); }

// ---------- auth ----------
function apiLogin(identifier,pin) {
  ensureSetup_();
  const key = norm_(identifier), cache = CacheService.getScriptCache(), failKey = 'fail_'+key;
  if (Number(cache.get(failKey)||0) >= APP.maxFailedLogins) throw new Error('Terlalu banyak percobaan gagal. Coba lagi dalam '+Math.round(APP.lockoutSeconds/60)+' menit.');
  const match = rows_(APP.sheets.users).find(x => (norm_(x.r[2]) === key || norm_(x.r[1]) === key) && String(x.r[7]).toUpperCase()==='ACTIVE');
  if (!match || !match.r[5] || !safeEq_(pinHash_(String(match.r[5]),String(pin||'')), String(match.r[6]))) {
    cache.put(failKey, String(Number(cache.get(failKey)||0)+1), APP.lockoutSeconds);
    throw new Error('ID/PIN salah atau akun belum aktif.');
  }
  cache.remove(failKey);
  const user = {userId:String(match.r[0]), personnelId:String(match.r[1]||''), username:String(match.r[2]), name:String(match.r[3]), role:String(match.r[4]).toUpperCase()};
  const token = Utilities.getUuid()+Utilities.getUuid();
  cache.put('sess_'+token, JSON.stringify(user), APP.sessionSeconds);
  db_().getSheetByName(APP.sheets.users).getRange(match.row,10).setValue(new Date());
  audit_(user.username,'LOGIN','SESSION',user.userId,'Login berhasil');
  return {token:token,user:user};
}
function auth_(token) {
  const raw = CacheService.getScriptCache().get('sess_'+String(token||''));
  if (!raw) throw new Error('Sesi berakhir. Silakan login ulang.');
  return JSON.parse(raw);
}
function apiLogout(token) {
  const user = auth_(token);
  CacheService.getScriptCache().remove('sess_'+String(token));
  audit_(user.username,'LOGOUT','SESSION',user.userId,'Logout');
  return {ok:true};
}

// ---------- dashboard (semua perhitungan jadwal di server, satu sumber kebenaran) ----------
function apiGetDashboard(token, monthText) {
  const user = auth_(token);
  const people = loadPeople_(), schedAll = loadSchedule_(), allCovers = loadCovers_();
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthText||'')) ? String(monthText) : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  const sched = schedAll.map(s => ({id:s.id,personnelId:s.personnelId,name:s.name,date:s.date,shift:s.shift,source:s.source}));
  const m = model_(people, schedAll), c = m.cfg, month = ENGINE.buildMonth(m, allCovers, ym);
  return {user:user,month:ym,people:m.people,schedule:sched.filter(s=>s.date.slice(0,7)===ym),allSchedule:sched,
    covers:allCovers.filter(x=>x.date.slice(0,7)===ym),allCovers:allCovers,pendingCount:allCovers.filter(x=>x.status==='PENDING').length,shifts:APP.shifts,
    engine:{ok:m.errors.length===0,errors:m.errors.map(e=>e.message),masterStart:c.masterStart,masterEnd:c.masterEnd,cycleLength:c.cycleLength,coverageMin:c.coverageMin},
    matrix:{dates:month.dates,rows:month.rows,scheduled:month.scheduled},coverage:month.coverage,conflicts:month.conflicts};
}

// ---------- personel & akun ----------
function apiSavePersonnel(token, data) {
  const user = auth_(token); requireAdmin_(user);
  const name = String(data && data.name || '').trim();
  if (!name) throw new Error('Nama personel wajib diisi.');
  return withLock_(() => {
    const sh = db_().getSheetByName(APP.sheets.personnel);
    const existing = rows_(APP.sheets.personnel).find(x=>norm_(x.r[1])===norm_(name));
    const now = new Date(), role = String(data.role||'').trim(), status = String(data.status||'').toUpperCase();
    if (status && !['ACTIVE','INACTIVE'].includes(status)) throw new Error('Status personel tidak valid.');
    if (existing) {
      sh.getRange(existing.row,2,1,5).setValues([[name,role||String(existing.r[2]||''),status||String(existing.r[3]||'ACTIVE'),existing.r[4]||now,now]]);
      audit_(user.username,'UPDATE','PERSONNEL',String(existing.r[0]),{name:name});
      return {ok:true,id:String(existing.r[0]),updated:true};
    }
    const pid=id_('PERS');
    sh.appendRow([pid,name,role,status||'ACTIVE',now,now]);
    audit_(user.username,'CREATE','PERSONNEL',pid,{name:name});
    return {ok:true,id:pid,updated:false};
  });
}
function apiCreateUser(token,data) {
  const user=auth_(token); requireAdmin_(user);
  const pid=String(data && data.personnelId||''), username=String(data && data.username||'').trim(), pin=String(data && data.pin||'');
  const role=String(data && data.role||'PERSONNEL').toUpperCase();
  if (!pid || !username || pin.length<6) throw new Error('Pilih personel, username, dan PIN minimal 6 karakter.');
  if (!['PERSONNEL','ADMIN'].includes(role)) throw new Error('Role tidak valid.');
  return withLock_(() => {
    if (rows_(APP.sheets.users).some(x=>norm_(x.r[2])===norm_(username))) throw new Error('Username sudah digunakan.');
    const p=rows_(APP.sheets.personnel).find(x=>String(x.r[0])===pid);
    if(!p) throw new Error('Personel tidak ditemukan.');
    const salt=Utilities.getUuid(), uid=id_('USR');
    db_().getSheetByName(APP.sheets.users).appendRow([uid,pid,username,String(p.r[1]),role,salt,pinHash_(salt,pin),'ACTIVE',new Date(),'']);
    audit_(user.username,'CREATE_USER','USERS',uid,{username:username,personnelId:pid,role:role});
    return {ok:true,userId:uid};
  });
}
// Master untuk personel BARU (belum punya satu pun baris master). Insert-only: master yang sudah ada tidak bisa diubah lewat API.
function apiSetMaster(token, data) {
  const user=auth_(token); requireAdmin_(user);
  const pid=String(data && data.personnelId||''), codes=(data && data.codes||[]).map(x=>String(x).trim());
  const c=engineCfg_();
  if (codes.length!==c.cycleLength) throw new Error('Master harus berisi tepat '+c.cycleLength+' kode shift (tanggal '+c.masterStart+' s/d '+c.masterEnd+').');
  const bad=codes.find(x=>!APP.shifts.includes(x)); if (bad) throw new Error('Kode shift tidak dikenal: '+bad);
  return withLock_(() => {
    const p=rows_(APP.sheets.personnel).find(x=>String(x.r[0])===pid);
    if(!p) throw new Error('Personel tidak ditemukan.');
    const has=loadSchedule_().some(s=>s.personnelId===pid && s.date>=c.masterStart && s.date<=c.masterEnd);
    if (has) throw new Error('Personel ini sudah punya data master. Master yang ada dilindungi dan tidak dapat diubah lewat aplikasi.');
    const now=new Date(), out=codes.map((s,i)=>[id_('SCH'),pid,String(p.r[1]),new Date(ENGINE.addDays(c.masterStart,i)+'T00:00:00'),s,'MASTER_ENTRY',now,now,user.username]);
    const sh=db_().getSheetByName(APP.sheets.schedule);
    sh.getRange(sh.getLastRow()+1,1,out.length,out[0].length).setValues(out);
    audit_(user.username,'SET_MASTER','BASE_SCHEDULE',pid,{codes:codes});
    return {ok:true,rows:out.length};
  });
}

// ---------- impor jadwal ----------
// options: {dryRun:true} hanya melapor; {allowHistoryOverwrite:true} mengizinkan koreksi jadwal SEBELUM master (dibackup dulu).
function apiImportSchedule(token, data, options) {
  const user=auth_(token); requireAdmin_(user);
  options=options||{};
  if(!Array.isArray(data) || data.length===0) throw new Error('Data impor kosong.');
  if(data.length>10000) throw new Error('Maksimal 10.000 baris per impor.');
  return withLock_(() => {
    const people=loadPeople_();
    const byName=new Map(people.map(p=>[norm_(p.name),p]));
    const seen=new Map(), errors=[], accepted=[];
    data.forEach((d,i)=>{
      const name=String(d.name||'').trim(), date=String(d.date||'').trim(), shift=String(d.shift||'').trim();
      if(!name||!date||!shift){errors.push({row:i+1,message:'Nama, tanggal, dan shift wajib diisi.'});return;}
      if(!validIsoDate_(date)){errors.push({row:i+1,message:'Tanggal tidak valid: '+date});return;}
      if(!APP.shifts.includes(shift)){errors.push({row:i+1,message:'Kode shift tidak dikenal: '+shift});return;}
      const p=byName.get(norm_(name));
      if(!p){errors.push({row:i+1,message:'Personel belum terdaftar di PERSONNEL: '+name});return;}
      const key=p.id+'|'+date;
      if(seen.has(key)){if(seen.get(key)!==shift) errors.push({row:i+1,message:'Duplikat konflik untuk '+name+' pada '+date});return;}
      seen.set(key,shift); accepted.push({personnelId:p.id,name:p.name,date:date,shift:shift});
    });
    if(errors.length) return {ok:false,errors:errors.slice(0,100),validCount:accepted.length,message:'Ada kesalahan. Tidak ada data yang diimpor; perbaiki file lalu impor ulang.'};
    const sched=loadSchedule_(), m=model_(people,sched), c=m.cfg, plan=ENGINE.planImport(sched,accepted,m);
    if(plan.masterConflicts.length){const x=plan.masterConflicts[0]; throw new Error('Impor dibatalkan tanpa perubahan: master rotasi '+c.masterStart+' s/d '+c.masterEnd+' sudah ada dan tidak boleh ditimpa ('+x.name+', '+x.date+'). Perbaiki master secara manual dengan prosedur terkontrol.');}
    const report={ok:true,dryRun:!!options.dryRun,inserted:plan.inserts.length,updated:0,unchanged:plan.unchanged,ignored:plan.ignored,total:accepted.length,
      mismatches:plan.mismatches.length,mismatchSample:plan.mismatches.slice(0,10),historyChanges:plan.historyChanges.length,historySample:plan.historyChanges.slice(0,10)};
    if(plan.historyChanges.length && !options.allowHistoryOverwrite) return Object.assign(report,{ok:false,needsHistoryConfirm:true,message:'Impor akan mengubah '+plan.historyChanges.length+' baris jadwal historis (sebelum '+c.masterStart+'). Konfirmasi eksplisit diperlukan.'});
    if(options.dryRun) return report;
    const writes=plan.inserts.length+plan.historyChanges.length;
    if(writes) report.backup=backupSchedule_();
    const sh=db_().getSheetByName(APP.sheets.schedule), now=new Date();
    if(plan.inserts.length){
      const out=plan.inserts.map(a=>[id_('SCH'),a.personnelId,a.name,new Date(a.date+'T00:00:00'),a.shift,'EXCEL_IMPORT',now,now,user.username]);
      sh.getRange(sh.getLastRow()+1,1,out.length,9).setValues(out);
    }
    const rowOf=new Map(sched.map(s=>[s.personnelId+'|'+s.date,s]));
    plan.historyChanges.forEach(h=>{const old=rowOf.get(h.personnelId+'|'+h.date); sh.getRange(old.row,5,1,5).setValues([[h.imported,'EXCEL_IMPORT_HISTORY_FIX',sh.getRange(old.row,7).getValue()||now,now,user.username]]); report.updated++;});
    report.dryRun=false;
    audit_(user.username,'IMPORT_SCHEDULE','BASE_SCHEDULE','BATCH',{inserted:report.inserted,updated:report.updated,unchanged:report.unchanged,ignored:report.ignored,mismatches:report.mismatches,rows:accepted.length,backup:report.backup||''});
    return report;
  });
}

// ---------- cover ----------
function coverReq_(data) { return {date:String(data&&data.date||''),ownerId:String(data&&data.ownerId||''),covererId:String(data&&data.covererId||''),shift:String(data&&data.shift||'')}; }
function apiSuggestCover(token, data) {
  auth_(token);
  const r=coverReq_(data);
  if(!ENGINE.isValidIso(r.date)||!r.ownerId) throw new Error('Pilih tanggal dan pemilik shift.');
  const m=model_(loadPeople_(),loadSchedule_());
  return ENGINE.suggestCovers(m,loadCovers_(),r);
}
function apiRequestCover(token,data) {
  const user=auth_(token), r=coverReq_(data), reason=String(data && data.reason||'').trim();
  if(!validIsoDate_(r.date)||!r.ownerId||!r.covererId||r.ownerId===r.covererId||!APP.shifts.includes(r.shift)||!reason) throw new Error('Lengkapi tanggal, pemilik shift, pengganti, shift, dan alasan dengan benar.');
  if(user.role!=='ADMIN' && user.personnelId!==r.ownerId && user.personnelId!==r.covererId) throw new Error('Akun hanya boleh mengajukan cover yang melibatkan dirinya.');
  return withLock_(() => {
    const people=loadPeople_(), covers=loadCovers_(), m=model_(people,loadSchedule_());
    const v=ENGINE.validateCover(m,covers,r);
    if(!v.ok) throw new Error(msgs_(v.errors));
    const owner=people.find(p=>p.id===r.ownerId), coverer=people.find(p=>p.id===r.covererId), id=id_('COV');
    db_().getSheetByName(APP.sheets.covers).appendRow([id,new Date(r.date+'T00:00:00'),r.ownerId,owner.name,r.covererId,coverer.name,r.shift,reason,'PENDING',user.username,new Date(),'','','']);
    audit_(user.username,'REQUEST_COVER','COVER_REQUESTS',id,{date:r.date,owner:owner.name,coverer:coverer.name,shift:r.shift,warnings:v.warnings.map(w=>w.code)});
    return {ok:true,id:id,warnings:v.warnings.map(w=>w.message)};
  });
}
function apiReviewCover(token,data) {
  const user=auth_(token); requireAdmin_(user);
  const id=String(data && data.id||''), status=String(data && data.status||'').toUpperCase();
  if(!['APPROVED','REJECTED'].includes(status)) throw new Error('Status review tidak valid.');
  return withLock_(() => {
    const sh=db_().getSheetByName(APP.sheets.covers), covers=loadCovers_(), row=covers.find(x=>x.id===id);
    if(!row) throw new Error('Permintaan cover tidak ditemukan.');
    if(row.status!=='PENDING') throw new Error('Permintaan ini sudah diproses.');
    let warnings=[];
    if(status==='APPROVED') {
      const m=model_(loadPeople_(),loadSchedule_());
      const v=ENGINE.validateCover(m,covers,{date:row.date,ownerId:row.ownerId,covererId:row.covererId,shift:row.shift},{excludeId:id,statuses:['APPROVED']});
      if(!v.ok) throw new Error('Konflik: '+msgs_(v.errors));
      warnings=v.warnings;
    }
    sh.getRange(row.row,9).setValue(status);
    sh.getRange(row.row,12,1,3).setValues([[user.username,new Date(),String(data.note||'')]]);
    audit_(user.username,status==='APPROVED'?'APPROVE_COVER':'REJECT_COVER','COVER_REQUESTS',id,{note:String(data.note||''),warnings:warnings.map(w=>w.code)});
    return {ok:true,status:status,warnings:warnings.map(w=>w.message)};
  });
}

// ---------- audit ----------
function apiGetAudit(token, limit) {
  const user=auth_(token); requireAdmin_(user);
  const n=Math.max(1,Math.min(1000,Number(limit)||200));
  const rows=rows_(APP.sheets.audit).map(x=>({time:tsFmt_(x.r[1]),actor:String(x.r[2]),action:String(x.r[3]),entity:String(x.r[4]),entityId:String(x.r[5]),details:String(x.r[6])}));
  return {chain:verifyAudit_(),total:rows.length,rows:rows.slice(-n).reverse()};
}
