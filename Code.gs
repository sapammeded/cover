/** Schedule Personil + Cover Shift — Google Apps Script backend.
 * Bind this script to the target spreadsheet or set SPREADSHEET_ID in Script Properties.
 * Run setupApp() once, then setAdminPinFromEditor() from the Apps Script editor.
 */
const APP = {
  spreadsheetId: '1D9VyUWlNaQC0ktI74ebL7lUFjdIjX36r20nbf395HW0',
  sheets: {
    personnel: 'PERSONNEL',
    schedule: 'BASE_SCHEDULE',
    covers: 'COVER_REQUESTS',
    users: 'USERS',
    audit: 'AUDIT_LOG'
  },
  shifts: ['M8','P8','S8','P','Off'],
  sessionSeconds: 21600
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Schedule Personil + Cover Shift')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Schedule Personil')
    .addItem('Siapkan database aplikasi', 'setupApp')
    .addItem('Atur PIN Admin', 'setAdminPinFromEditor')
    .addToUi();
}
function db_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || APP.spreadsheetId;
  return SpreadsheetApp.openById(id);
}
function setupApp() {
  const ss = db_();
  const specs = [
    [APP.sheets.personnel, ['personnel_id','nama','jabatan','status','created_at','updated_at']],
    [APP.sheets.schedule, ['schedule_id','personnel_id','nama','tanggal','shift_dasar','source','created_at','updated_at','updated_by']],
    [APP.sheets.covers, ['cover_id','tanggal','shift_owner_id','shift_owner_nama','coverer_id','coverer_nama','shift_cover','alasan','status','requested_by','requested_at','reviewed_by','reviewed_at','catatan_admin']],
    [APP.sheets.users, ['user_id','personnel_id','username','nama','role','pin_salt','pin_hash','status','created_at','last_login']],
    [APP.sheets.audit, ['audit_id','timestamp','actor','action','entity','entity_id','details']]
  ];
  specs.forEach(([name, headers]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1,1,1,headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1,1,1,headers.length).setFontWeight('bold');
    } else {
      const current = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getDisplayValues()[0];
      if (headers.some((h,i) => current[i] !== h)) throw new Error('Header sheet '+name+' tidak sesuai. Jangan hapus data; periksa baris pertama.');
    }
  });
  return {ok:true,message:'Sheet database siap. Jalankan setAdminPinFromEditor() untuk membuat PIN admin.'};
}
function setAdminPinFromEditor() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt('Atur PIN Admin', 'Masukkan PIN admin baru (minimal 8 karakter). Simpan baik-baik.', ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const pin = String(result.getResponseText() || '');
  if (pin.length < 8) throw new Error('PIN minimal 8 karakter.');
  setupApp();
  const sh = db_().getSheetByName(APP.sheets.users);
  const values = sh.getDataRange().getValues();
  const salt = Utilities.getUuid();
  const hash = pinHash_(salt, pin);
  let row = values.findIndex((r,i) => i > 0 && String(r[2]).toUpperCase() === 'ADMIN') + 1;
  const now = new Date();
  const record = ['USR-ADMIN','', 'ADMIN', 'Administrator', 'ADMIN', salt, hash, 'ACTIVE', now, ''];
  if (row < 2) row = sh.getLastRow()+1;
  sh.getRange(row,1,1,record.length).setValues([record]);
  audit_('SYSTEM','SET_ADMIN_PIN','USERS','USR-ADMIN','PIN admin dibuat/diubah');
  return 'PIN admin berhasil disimpan. Jangan bagikan PIN ini.';
}
function pinHash_(salt,pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt)+'|'+String(pin), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0'+((b+256)%256).toString(16)).slice(-2)).join('');
}
function id_(prefix) { return prefix+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,14).toUpperCase(); }
function norm_(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g,' '); }
function rows_(sheetName) {
  const sh = db_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  return vals.map((r,i) => ({r:r, row:i+2}));
}
function audit_(actor,action,entity,entityId,details) {
  const sh = db_().getSheetByName(APP.sheets.audit);
  sh.appendRow([id_('AUD'),new Date(),String(actor||'SYSTEM'),action,entity,entityId,typeof details==='string'?details:JSON.stringify(details||{})]);
}
function apiLogin(identifier,pin) {
  setupApp();
  const key = norm_(identifier);
  const match = rows_(APP.sheets.users).find(x =>
    (norm_(x.r[2]) === key || norm_(x.r[1]) === key) && String(x.r[7]).toUpperCase()==='ACTIVE'
  );
  if (!match || !match.r[5] || pinHash_(String(match.r[5]),String(pin||'')) !== String(match.r[6])) {
    throw new Error('ID/PIN salah atau akun belum aktif.');
  }
  const user = {userId:String(match.r[0]), personnelId:String(match.r[1]||''), username:String(match.r[2]), name:String(match.r[3]), role:String(match.r[4]).toUpperCase()};
  const token = Utilities.getUuid()+Utilities.getUuid();
  CacheService.getScriptCache().put('sess_'+token, JSON.stringify(user), APP.sessionSeconds);
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
function apiGetDashboard(token, monthText) {
  const user = auth_(token);
  const people = rows_(APP.sheets.personnel).map(x => ({id:String(x.r[0]),name:String(x.r[1]),role:String(x.r[2]||''),status:String(x.r[3]||'ACTIVE')})).filter(p=>p.status.toUpperCase()==='ACTIVE');
  const sched = rows_(APP.sheets.schedule).map(x=>({id:String(x.r[0]),personnelId:String(x.r[1]),name:String(x.r[2]),date:dateIso_(x.r[3]),shift:String(x.r[4]),source:String(x.r[5]||'')})).filter(s=>s.date);
  const covers = rows_(APP.sheets.covers).map(x=>({id:String(x.r[0]),date:dateIso_(x.r[1]),ownerId:String(x.r[2]),ownerName:String(x.r[3]),covererId:String(x.r[4]),covererName:String(x.r[5]),shift:String(x.r[6]),reason:String(x.r[7]),status:String(x.r[8]),requestedBy:String(x.r[9]),requestedAt:dateIso_(x.r[10]),reviewedBy:String(x.r[11]),reviewedAt:dateIso_(x.r[12]),adminNote:String(x.r[13]||'')}));
  const ym = /^\d{4}-\d{2}$/.test(String(monthText||'')) ? String(monthText) : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  return {user:user,month:ym,people:people,schedule:sched.filter(s=>s.date.slice(0,7)===ym),allSchedule:sched,covers:covers.filter(c=>c.date.slice(0,7)===ym),pendingCount:covers.filter(c=>c.status==='PENDING').length,shifts:APP.shifts};
}
function apiSavePersonnel(token, data) {
  const user = auth_(token); requireAdmin_(user);
  const name = String(data && data.name || '').trim();
  if (!name) throw new Error('Nama personel wajib diisi.');
  const sh = db_().getSheetByName(APP.sheets.personnel);
  const existing = rows_(APP.sheets.personnel).find(x=>norm_(x.r[1])===norm_(name));
  const now = new Date();
  if (existing) {
    sh.getRange(existing.row,2,1,5).setValues([[name,String(data.role||''),String(data.status||'ACTIVE'),existing.r[4]||now,now]]);
    audit_(user.username,'UPDATE','PERSONNEL',String(existing.r[0]),{name:name});
    return {ok:true,id:String(existing.r[0]),updated:true};
  }
  const pid=id_('PERS');
  sh.appendRow([pid,name,String(data.role||''),String(data.status||'ACTIVE'),now,now]);
  audit_(user.username,'CREATE','PERSONNEL',pid,{name:name});
  return {ok:true,id:pid,updated:false};
}
function apiCreateUser(token,data) {
  const user=auth_(token); requireAdmin_(user);
  const pid=String(data && data.personnelId||'');
  const username=String(data && data.username||'').trim();
  const pin=String(data && data.pin||'');
  const role=String(data && data.role||'PERSONNEL').toUpperCase();
  if (!pid || !username || pin.length<6) throw new Error('Pilih personel, username, dan PIN minimal 6 karakter.');
  if (!['PERSONNEL','ADMIN'].includes(role)) throw new Error('Role tidak valid.');
  if (rows_(APP.sheets.users).some(x=>norm_(x.r[2])===norm_(username))) throw new Error('Username sudah digunakan.');
  const p=rows_(APP.sheets.personnel).find(x=>String(x.r[0])===pid);
  if(!p) throw new Error('Personel tidak ditemukan.');
  const salt=Utilities.getUuid();
  const uid=id_('USR');
  db_().getSheetByName(APP.sheets.users).appendRow([uid,pid,username,String(p.r[1]),role,salt,pinHash_(salt,pin),'ACTIVE',new Date(),'']);
  audit_(user.username,'CREATE_USER','USERS',uid,{username:username,personnelId:pid,role:role});
  return {ok:true,userId:uid};
}
function apiImportSchedule(token, data) {
  const user=auth_(token); requireAdmin_(user);
  if(!Array.isArray(data) || data.length===0) throw new Error('Data impor kosong.');
  if(data.length>10000) throw new Error('Maksimal 10.000 baris per impor.');
  const people=rows_(APP.sheets.personnel);
  const byName=new Map(people.map(x=>[norm_(x.r[1]),{id:String(x.r[0]),name:String(x.r[1])}]));
  const seen=new Map(), errors=[], accepted=[];
  data.forEach((d,i)=>{
    const name=String(d.name||'').trim(), date=String(d.date||'').trim(), shift=String(d.shift||'').trim();
    if(!name||!date||!shift){errors.push({row:i+1,message:'Nama, tanggal, dan shift wajib diisi.'});return;}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date+'T00:00:00').getTime())) {errors.push({row:i+1,message:'Tanggal tidak valid: '+date});return;}
    if(!APP.shifts.includes(shift)){errors.push({row:i+1,message:'Kode shift tidak dikenal: '+shift});return;}
    const p=byName.get(norm_(name));
    if(!p){errors.push({row:i+1,message:'Personel belum terdaftar di PERSONNEL: '+name});return;}
    const key=p.id+'|'+date;
    if(seen.has(key)){if(seen.get(key)!==shift) errors.push({row:i+1,message:'Duplikat konflik untuk '+name+' pada '+date});return;}
    seen.set(key,shift); accepted.push({personnelId:p.id,name:p.name,date:date,shift:shift});
  });
  if(errors.length) return {ok:false,errors:errors.slice(0,100),validCount:accepted.length,message:'Ada kesalahan. Tidak ada data yang diimpor; perbaiki file lalu impor ulang.'};
  const lock=LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh=db_().getSheetByName(APP.sheets.schedule);
    const existing=rows_(APP.sheets.schedule);
    const map=new Map(existing.map(x=>[String(x.r[1])+'|'+dateIso_(x.r[3]),x]));
    const now=new Date(); let inserted=0, updated=0, unchanged=0;
    accepted.forEach(a=>{
      const key=a.personnelId+'|'+a.date, old=map.get(key);
      if(old){
        if(String(old.r[4])===a.shift){unchanged++;return;}
        sh.getRange(old.row,5,1,5).setValues([[a.shift,'EXCEL_IMPORT',old.r[6]||now,now,user.username]]);
        updated++;
      } else {
        sh.appendRow([id_('SCH'),a.personnelId,a.name,new Date(a.date+'T00:00:00'),a.shift,'EXCEL_IMPORT',now,now,user.username]);
        inserted++;
      }
    });
    audit_(user.username,'IMPORT_SCHEDULE','BASE_SCHEDULE','BATCH',{inserted:inserted,updated:updated,unchanged:unchanged,rows:accepted.length});
    return {ok:true,inserted:inserted,updated:updated,unchanged:unchanged,total:accepted.length};
  } finally {lock.releaseLock();}
}
function apiRequestCover(token,data) {
  const user=auth_(token);
  const date=String(data && data.date||'');
  const ownerId=String(data && data.ownerId||'');
  const covererId=String(data && data.covererId||'');
  const shift=String(data && data.shift||'');
  const reason=String(data && data.reason||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!ownerId||!covererId||ownerId===covererId||!APP.shifts.includes(shift)||!reason) throw new Error('Lengkapi tanggal, pemilik shift, pengganti, shift, dan alasan dengan benar.');
  const people=rows_(APP.sheets.personnel);
  const owner=people.find(x=>String(x.r[0])===ownerId), coverer=people.find(x=>String(x.r[0])===covererId);
  if(!owner||!coverer) throw new Error('Personel tidak ditemukan.');
  if(user.role!=='ADMIN' && user.personnelId!==ownerId && user.personnelId!==covererId) throw new Error('Akun hanya boleh mengajukan cover yang melibatkan dirinya.');
  const duplicate=rows_(APP.sheets.covers).some(x=>dateIso_(x.r[1])===date && String(x.r[2])===ownerId && ['PENDING','APPROVED'].includes(String(x.r[8])));
  if(duplicate) throw new Error('Sudah ada permintaan pending/disetujui untuk shift personel tersebut pada tanggal ini.');
  const id=id_('COV');
  db_().getSheetByName(APP.sheets.covers).appendRow([id,new Date(date+'T00:00:00'),ownerId,String(owner.r[1]),covererId,String(coverer.r[1]),shift,reason,'PENDING',user.username,new Date(),'','','']);
  audit_(user.username,'REQUEST_COVER','COVER_REQUESTS',id,{date:date,owner:owner.r[1],coverer:coverer.r[1],shift:shift});
  return {ok:true,id:id};
}
function apiReviewCover(token,data) {
  const user=auth_(token); requireAdmin_(user);
  const id=String(data && data.id||''), status=String(data && data.status||'').toUpperCase();
  if(!['APPROVED','REJECTED'].includes(status)) throw new Error('Status review tidak valid.');
  const sh=db_().getSheetByName(APP.sheets.covers);
  const row=rows_(APP.sheets.covers).find(x=>String(x.r[0])===id);
  if(!row) throw new Error('Permintaan cover tidak ditemukan.');
  if(String(row.r[8])!=='PENDING') throw new Error('Permintaan ini sudah diproses.');
  if(status==='APPROVED') {
    const date=dateIso_(row.r[1]), coverer=String(row.r[4]), owner=String(row.r[2]);
    const clash=rows_(APP.sheets.covers).some(x=>String(x.r[0])!==id && dateIso_(x.r[1])===date && String(x.r[8])==='APPROVED' && (String(x.r[4])===coverer || String(x.r[2])===owner));
    if(clash) throw new Error('Konflik: pengganti sudah mendapat cover lain atau shift ini sudah ditutup cover.');
  }
  sh.getRange(row.row,9).setValue(status);
  sh.getRange(row.row,12,1,3).setValues([[user.username,new Date(),String(data.note||'')]]);
  audit_(user.username,status==='APPROVED'?'APPROVE_COVER':'REJECT_COVER','COVER_REQUESTS',id,{note:String(data.note||'')});
  return {ok:true,status:status};
}
function requireAdmin_(user) { if(!user || user.role!=='ADMIN') throw new Error('Fitur ini hanya untuk admin.'); }
function dateIso_(v) {
  if(!v) return '';
  if(v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s=String(v);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d=new Date(s); return isNaN(d.getTime())?'':Utilities.formatDate(d,Session.getScriptTimeZone(),'yyyy-MM-dd');
}
