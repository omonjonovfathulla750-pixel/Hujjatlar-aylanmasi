// ===== Ilova =====
const applyPrefs=()=>{
  if(typeof localStorage==='undefined')return;
  const th=localStorage.getItem('ui_theme');
  if(th==='light'||th==='dark')document.documentElement.setAttribute('data-theme',th);
  else if(th==='auto')document.documentElement.removeAttribute('data-theme');
  const ac=localStorage.getItem('ui_accent');
  if(ac&&typeof document!=='undefined'&&document.documentElement?.style?.setProperty)document.documentElement.style.setProperty('--pri',ac);
};
applyPrefs();
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),pad=n=>String(n).padStart(2,'0');
const iso=d=>d.toISOString().slice(0,10),days=(a,b)=>Math.round((new Date(b)-new Date(a))/864e5),addD=(s,n)=>{const d=new Date(s);d.setUTCDate(d.getUTCDate()+n);return iso(d)};
let today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});
const fmt=s=>{if(!s)return'—';if(!s.includes('T'))return s.slice(0,10).split('-').reverse().join('.');const d=new Date(s);return Number.isNaN(d.getTime())?s:d.toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})};
const nowClock=()=>new Date().toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const fmtSize=b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(1)+' MB';
const MN=['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentyabr','Oktyabr','Noyabr','Dekabr'],MS=['Yan','Fev','Mar','Apr','May','Iyn','Iyl','Avg','Sen','Okt','Noy','Dek'];
const ST={ok:'Vaqtida bajarildi',late:'Muddatdan oshdi',prog:'Jarayonda',new:'Biriktirilmagan'},ORDER=['late','prog','new','ok'],ROLE_UZ={admin:'Admin',operator:'Operator',viewer:'Kuzatuvchi',user:'Xodim'};
const PR_UZ={urgent:'Shoshilinch',high:'Yuqori',normal:'Oddiy',low:'Past'};
const EVT_ICON={created:'📄',assigned:'👤',delegated:'🔀',viewed:'👁',viewed_assignee:'👁',completed:'✅',completed_late:'⚠️',signed:'✍️',transferred:'📤',received:'📥',file_uploaded:'📎',response_file:'📤',unassigned:'✖️',task_deleted:'🗑'};
let S={me:null,orgs:[],users:[],docs:[],integrations:[],archive:[],tgLink:null,T:[],page:'dash',doc:null,year:+today.slice(0,4),month:+today.slice(5,7)-1,calYear:+today.slice(0,4),calMonth:+today.slice(5,7)-1,day:today,f:{q:'',st:'all',org:'all',uid:'all',ty:'all'},unread:0,notifications:[]};
let lastLoadAt=0,loadInFlight=null,lastDataSig='',renderedPage='dash',mutSeq=0,kpiSt=false,dirtyForm=false;

// ---- Token / API ----
const tok=()=>localStorage.getItem('tk');
const saveTokens=d=>{localStorage.setItem('tk',d.access_token);localStorage.setItem('rt',d.refresh_token)};
const clearTokens=()=>{localStorage.removeItem('tk');localStorage.removeItem('rt')};
let refreshing=null;
const refreshTok=()=>refreshing||(refreshing=(async()=>{try{const rt=localStorage.getItem('rt');if(!rt)return false;const r=await fetch('/api/v1/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:rt})});if(!r.ok)return false;saveTokens(await r.json());return true}catch(e){return false}finally{refreshing=null}})());
async function logout(){try{await fetch('/api/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:localStorage.getItem('rt')||undefined})})}catch(e){}clearTokens();location.reload()}
const api=async(m,p,b,retry=true,silent=false)=>{let r;try{r=await fetch('/api/v1/'+p,{method:m,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok()},body:b?JSON.stringify(b):undefined})}catch(e){if(!silent)alert('Server bilan aloqa yo\u02bbq');return{error:'network'}}
 if(r.status===401&&retry&&await refreshTok())return api(m,p,b,false,silent);
 if(r.status===401){if(!silent){clearTokens();location.reload()}return{error:'auth'}}
 if(r.status===204)return{ok:true};
 let d={};try{d=await r.json()}catch(e){}
 if(!r.ok){if(!silent)alert((d.error||'Xatolik')+(d.details?'\n'+d.details.map(x=>(x.path?x.path+': ':'')+x.message).join('\n'):''));return{error:d.error||'Xatolik'}}
 return d};

async function downloadFile(urlPath,fallbackName,retry=true){
 let r;try{r=await fetch('/api/v1/'+urlPath,{headers:{Authorization:'Bearer '+tok()}})}catch(e){alert('Server bilan aloqa yo\u02bbq');return}
 if(r.status===401&&retry&&await refreshTok())return downloadFile(urlPath,fallbackName,false);
 if(!r.ok){let d={};try{d=await r.json()}catch(e){}alert(d.error||'Yuklab olishda xatolik');return}
 const blob=await r.blob();
 let name=fallbackName||'fayl';
 const cd=r.headers.get('content-disposition')||'';
 const m=/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
 if(m)name=decodeURIComponent(m[1]||m[2]);
 if(typeof URL!=='undefined'&&URL.createObjectURL){
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1000);
 }
}

let previewUrl=null;
function pvTableHtml(rows){
 return`<div class="pv-wrap"><table class="pv-tbl"><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
async function previewFile(fileId,fallbackName,mimeHint){
 const m=$('#global-modal');
 if(m)m.innerHTML=`<div class="modal-wrap"><div class="modal-box" style="max-width:860px"><div class="bar"><h3 style="margin:0;flex:1">📄 ${esc(fallbackName||'Fayl')}</h3><button class="mini" data-a="close-gmodal">✕</button></div><p class="loading">Fayl yuklanmoqda...</p></div></div>`;
 const pv=await api('GET',`attachments/${fileId}/preview`);
 if(pv.error){if(m)m.innerHTML='';return;}
 const name=pv.orig_name||fallbackName||'fayl';
 let body='';
 if(pv.kind==='xlsx'){
  body=(pv.sheets||[]).map(s=>`<h3 style="margin:10px 0 6px">${esc(s.name)}</h3>${s.rows.length?pvTableHtml(s.rows):'<p class="mut">Bo\u02bbsh varaq</p>'}`).join('')||'<p class="mut">Jadval ma\u02bblumoti topilmadi</p>';
 }else if(pv.kind==='docx'){
  const pHtml=(pv.paragraphs||[]).map(p=>`<p class="pv-p">${esc(p)}</p>`).join('');
  const tHtml=(pv.tables||[]).map(tb=>`<div style="margin-top:10px">${pvTableHtml(tb)}</div>`).join('');
  body=`<div class="pv-wrap">${pHtml}${tHtml||(!pHtml?'<p class="mut">Hujjat bo\u02bbsh</p>':'')}</div>`;
 }else if(pv.kind==='text'){
  body=`<pre class="pv-wrap" style="white-space:pre-wrap;font-size:13px;margin:0">${esc(pv.text)}</pre>`;
 }else{
  const mime=(pv.mime_type||mimeHint||'').toLowerCase();
  if(mime.includes('pdf')||(mime.startsWith('image/')&&!mime.includes('svg'))){
   const tk=await api('POST',`attachments/${fileId}/ticket`);
   if(tk.error){if(m)m.innerHTML='';return;}
   previewUrl=`/api/v1/attachments/view/${tk.ticket}`;
   const tabBtn=`<button class="btn gh sm" data-a="open-tab">↗ Alohida oynada ochish</button>`;
   if(mime.includes('pdf')){
    body=`<iframe src="${previewUrl}" style="width:100%;height:70vh;border:0;border-radius:12px;background:#fff"></iframe>`;
   }else{
    body=`<img src="${previewUrl}" style="max-width:100%;max-height:70vh;border-radius:12px;display:block;margin:0 auto">`;
   }
   if(m)m.innerHTML=`<div class="modal-wrap"><div class="modal-box" style="max-width:860px"><div class="bar" style="margin-bottom:10px"><h3 style="margin:0;flex:1">📄 ${esc(name)}</h3>${tabBtn}<button class="btn sm" data-a="dl-file" data-id="${fileId}" data-name="${esc(name)}">⬇ Yuklab olish</button><button class="mini" data-a="close-gmodal">✕</button></div>${body}</div></div>`;
   return;
  }
  body=`<p class="mut" style="padding:20px 0">Ushbu fayl formatini (${esc(mime||'hujjat')}) brauzerda bevosita ko\u02bbrish imkoniyati yo\u02bbq. Ko\u02bbrish uchun yuklab oling.</p>`;
 }
 if(m)m.innerHTML=`<div class="modal-wrap"><div class="modal-box" style="max-width:860px"><div class="bar" style="margin-bottom:10px"><h3 style="margin:0;flex:1">📄 ${esc(name)}</h3><button class="btn sm" data-a="dl-file" data-id="${fileId}" data-name="${esc(name)}">⬇ Yuklab olish</button><button class="mini" data-a="close-gmodal">✕</button></div>${body}</div></div>`;
}

function fileToBase64(file){
 return new Promise((resolve,reject)=>{
  const fr=new FileReader();
  fr.onload=()=>{const res=String(fr.result||'');const i=res.indexOf(',');resolve(i>=0?res.slice(i+1):res)};
  fr.onerror=()=>reject(new Error('Faylni o\u02bbqishda xatolik'));
  fr.readAsDataURL(file);
 });
}

async function uploadOneFile(endpoint,file,note=null,retry=true){
 if(typeof FormData==='undefined'||typeof Blob==='undefined'){
  let b64;
  try{b64=await fileToBase64(file);}catch(e){alert(e?.message||'Faylni o\u02bbqishda xatolik');return false}
  const body={filename:file.name,mime_type:file.type||'application/octet-stream',data_base64:b64};
  if(note)body.note=note;
  const r=await api('POST',endpoint,body);
  return !r.error;
 }
 const fd=new FormData();
 fd.append('file',file,file.name);
 if(note)fd.append('note',note);
 let r;
 try{r=await fetch('/api/v1/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+tok()},body:fd});}
 catch(e){alert('Server bilan aloqa yo\u02bbq');return false}
 if(r.status===401&&retry&&await refreshTok())return uploadOneFile(endpoint,file,note,false);
 if(r.status===401){clearTokens();location.reload();return false}
 let d={};try{d=await r.json();}catch(e){}
 if(!r.ok){alert(d.error||'Fayl yuklashda xatolik');return false}
 return true;
}

async function uploadSelectedFiles(endpoint,files,note=null){
 if(!files||!files.length)return true;
 for(const f of files){
  if(f.size>10*1024*1024){alert(`${f.name}: hajmi 10 MB dan oshmasligi kerak`);return false}
  if(!(await uploadOneFile(endpoint,f,note)))return false;
 }
 return true;
}

// ---- Yordamchi funksiyalar ----
const ast=(a,t)=>a.done_date?(a.done_date<=t.deadline?'ok':'late'):(today>t.deadline?'late':'prog');
const tst=t=>!t.assignees.length?'new':t.assignees.some(a=>ast(a,t)==='late')?'late':t.assignees.some(a=>ast(a,t)==='prog')?'prog':'ok';
const worst=l=>ORDER.find(s=>l.some(t=>t.st===s))||'';
const user=id=>S.users.find(u=>u.id===id)||{name:'—',org_id:0},org=id=>S.orgs.find(o=>o.id===id)||{name:'—'};
const short=n=>n.split(/\s+/).slice(0,2).join(' '),admin=()=>['admin','operator'].includes(S.me.role),isA=()=>S.me.role==='admin',seeAll=()=>S.me.role!=='user';
const rebuildTasks=()=>{S.T=S.docs.flatMap(d=>d.tasks.map(t=>({...t,doc:d,date:d.created_at,st:tst(t)})))};
const dataSig=d=>`${d.today}|${(d.users||[]).length}|${(d.orgs||[]).length}|`+(d.docs||[]).map(x=>`${x.id}:${x.number}:${x.title}:${x.tasks.map(t=>`${t.id}:${t.assignees.map(a=>`${a.id}:${a.done_date||''}:${a.delegated_to||''}:${a.viewed_at||''}:${(a.files||[]).map(f=>f.id+':'+(f.note||'')).join('+')}`).join(',')}`).join(';')}:${(x.attachments||[]).map(f=>f.id+':'+(f.note||'')).join('+')}:${x.signatures.map(s=>s.signed_at||'').join(',')}:${x.transfers.length}`).join('|');

// ---- Ma'lumot yuklash ----
async function load(opts={}){
  if(loadInFlight){
    if(opts.force)await loadInFlight;
    else return loadInFlight;
  }
  const seq=mutSeq;
  const run=(async()=>{
    const d=await api('GET','data',undefined,true,!!opts.silent);
    if(d.error||!d.me)return false;
    if(seq!==mutSeq&&!opts.force)return false;
    const sig=dataSig(d);
    const changed=sig!==lastDataSig||S.unread!==(d.unread||0);
    lastDataSig=sig;
    const isFirst=!lastLoadAt;
    lastLoadAt=Date.now();
    if(d.today)today=d.today;
    if(isFirst&&d.today){
      S.year=+d.today.slice(0,4);S.month=+d.today.slice(5,7)-1;
      S.calYear=S.year;S.calMonth=S.month;S.day=d.today;
    }
    Object.assign(S,d);
    rebuildTasks();
    S.unread=d.unread||0;
    if(opts.renderIfChanged&&changed&&!isUiBusyEditing())render();
    return true;
  })();
  loadInFlight=run;
  try{return await run;}finally{if(loadInFlight===run)loadInFlight=null;}
}
function isUiBusyEditing(){
  if(hasOpenModal())return true;
  if(S.page==='new'||dirtyForm)return true;
  if(typeof document==='undefined')return false;
  const ae=document.activeElement;
  if(ae&&/^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName))return true;
  if(typeof document.querySelectorAll!=='function')return false;
  if([...document.querySelectorAll('input[type="file"]')].some(el=>el.files&&el.files.length>0))return true;
  return[...document.querySelectorAll('.resp-note,#df-note,#n-ti,#n-no,#n-dept,#org-new-inp,#sp-cur,#sp-new,#sp-con,#sms-url,#sms-login,#sms-pass,#sms-sender,#sms-test-phone')].some(el=>String(el.value||'').trim().length>0);
}
function hasOpenModal(){
  const gm=$('#global-modal'),um=$('#user-modal');
  return Boolean((gm&&gm.innerHTML)||(um&&um.innerHTML));
}
async function loadUnread(){
  const d=await api('GET','notifications/unread',undefined,true,true);
  if(!d.error){S.unread=d.count;const b=$('#notif-btn');if(b)b.title=`Bildirishnomalar${d.count?' ('+d.count+' yangi)':''}`;}
}
async function loadIntegrations(){
  if(!isA())return;
  const r=await api('GET','integrations',undefined,true,true);
  if(!r.error&&Array.isArray(r.data)){S.integrations=r.data;if(S.page==='set'&&!isUiBusyEditing())render();}
}
async function loadTelegramLink(){
  const r=await api('GET','auth/telegram-link',undefined,true,true);
  if(!r.error){S.tgLink=r;if(S.page==='set'&&!isUiBusyEditing())render();}
}
async function loadArchive(){
  const r=await api('GET','archive');
  if(!r.error&&Array.isArray(r.data)){S.archive=r.data;render();}
}
async function openDoc(id,force=false){
  const hasLocal=S.docs.some(x=>x.id===id);
  if(hasLocal&&!force){
    S.doc=id;S.page='doc';render();
  }
  const seq=mutSeq;
  const d=await api('GET',`documents/${id}`,undefined,true,hasLocal&&!force);
  if(!d.error&&d.id){
    if(seq!==mutSeq&&!force)return openDoc(id,true);
    const prev=S.docs.find(x=>x.id===d.id);
    const changed=!prev||JSON.stringify(prev)!==JSON.stringify(d);
    const i=S.docs.findIndex(x=>x.id===d.id);
    if(i>=0)S.docs[i]=d;else S.docs.unshift(d);
    rebuildTasks();
    if(!hasLocal||force||(S.page==='doc'&&S.doc===id&&changed&&!isUiBusyEditing())){
      S.doc=id;S.page='doc';render();
    }
  }else if(hasLocal&&force){
    S.doc=id;S.page='doc';render();
  }
}

// ---- Render yordamchilari ----
const scope=()=>seeAll()?S.T:S.T.filter(t=>t.assignees.some(a=>a.user_id===S.me.id));
const inP=(t,m=S.month)=>t.date.startsWith(S.year+'-')&&(m<0||+t.date.slice(5,7)===m+1);
function sum(l){const c={ok:0,late:0,prog:0,new:0};l.forEach(t=>c[t.st]++);const ds=l.flatMap(t=>(t.empA?[t.empA]:t.assignees).filter(a=>a.done_date).map(a=>days(t.date,a.done_date)));const tot=l.length;return{...c,total:tot,avg:ds.length?ds.reduce((x,y)=>x+y,0)/ds.length:0,pct:tot?Math.round(c.ok/tot*100):0,latePct:tot?Math.round(c.late/tot*100):0,progPct:tot?Math.round((c.prog+c.new)/tot*100):0}}
const badge=k=>`<span class="bd ${k}">${ST[k]}</span>`;
const opts=(a,v)=>a.map(([k,l])=>`<option value="${k}"${String(k)===String(v)?' selected':''}>${l}</option>`).join('');
const sel=(f,a,v)=>`<select class="chip" data-f="${f}">${opts(a,v)}</select>`;
const CY=+today.slice(0,4),years=[CY-1,CY,CY+1].map(y=>[y,y+'-yil']);
const period=()=>`<div class="chips">${sel('year',years,S.year)}${sel('month',[[-1,'Butun yil'],...MN.map((n,i)=>[i,n])],S.month)}</div>`;
const exportBtns=()=>`<div class="exp-grp"><button class="btn sm ok" data-a="exp-xlsx" title="Excel jadval ko'rinishida yuklash">📊 Excel (.xlsx)</button><button class="btn sm info" data-a="exp-docx" title="Word hujjat ko'rinishida yuklash">📝 Word (.docx)</button></div>`;
const stOpts=[['all','Barcha holatlar'],...ORDER.map(k=>[k,ST[k]])];
const tyOpts=[['all','Barcha turlar'],...['Nazorat varaqasi','Xat','Buyruq','Farmoyish'].map(x=>[x,x])];
const q_=()=>S.f.q.toLowerCase();
const execUsers=()=>S.users.filter(u=>(u.role==='user'&&!u.onboarding_required)||S.T.some(t=>t.assignees.some(a=>a.user_id===u.id)));
const evalForUser=(t,uid)=>{if(!uid||uid==='all')return t;const a=t.assignees.find(x=>x.user_id===+uid);return a?{...t,st:ast(a,t),empA:a}:null};
const hasActiveFilters=()=>S.f.st!=='all'||S.f.org!=='all'||S.f.uid!=='all'||S.f.ty!=='all'||!!S.f.q;
function filteredTasks({usePeriod=true,useStatus=true,useEmp=true,useOrg=true,useType=true}={}){
  const uid=!seeAll()?S.me.id:(useEmp&&S.f.uid!=='all'?+S.f.uid:null);
  const ql=q_();
  let l=scope().map(t=>evalForUser(t,uid)).filter(Boolean);
  if(useOrg&&S.f.org!=='all')l=l.filter(t=>t.doc.org_id===+S.f.org);
  if(useType&&S.f.ty!=='all')l=l.filter(t=>t.doc.type===S.f.ty);
  if(ql)l=l.filter(t=>(t.doc.number+' '+t.title+' '+t.doc.title+' '+(t.doc.department||'')+' '+t.assignees.map(a=>user(a.user_id).name).join(' ')).toLowerCase().includes(ql));
  if(usePeriod)l=l.filter(t=>inP(t));
  if(useStatus&&S.f.st!=='all')l=l.filter(t=>t.st===S.f.st);
  return l.sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
}
function filterBar({showPeriod=true,showEmp=true,showOrg=true,showStatus=true,showType=false}={}){
  return`<div class="fbar">
    ${showPeriod?sel('year',years,S.year)+sel('month',[[-1,'Butun yil'],...MN.map((n,i)=>[i,n])],S.month):''}
    ${seeAll()&&showEmp?sel('fuid',[['all','Barcha xodimlar'],...execUsers().map(u=>[u.id,esc(u.name)])],S.f.uid):''}
    ${seeAll()&&showOrg?sel('forg',[['all','Barcha tashkilotlar'],...S.orgs.map(o=>[o.id,esc(o.name)])],S.f.org):''}
    ${showStatus?sel('fst',stOpts,S.f.st):''}
    ${showType?sel('fty',tyOpts,S.f.ty):''}
    ${hasActiveFilters()?'<button class="btn gh sm" data-a="clear-filters">✕ Tozalash</button>':''}
  </div>`;
}
const taskTable=l=>`<div class="pn sc"><table><thead><tr><th>Hujjat №</th><th>Mazmuni</th><th>Kim bergan</th><th>Bajaruvchilar</th><th>Muddat</th><th>Holat</th>${isA()?'<th></th>':''}</tr></thead><tbody>${l.map(t=>`<tr class="rw" data-a="doc" data-id="${t.doc.id}"><td><b>${esc(t.doc.number)}</b><small>${esc(t.doc.type)}</small></td><td>${esc(t.title)}</td><td>${esc(short(user(t.issued_by).name))}</td><td>${t.assignees.map(a=>{const k=ast(a,t);return`<span class="as ${k}">${esc(short(user(a.user_id).name))} ${k==='ok'?'✓ '+(a.done_date||''):k==='late'?'!':'…'}</span>`}).join('')||'<span class="mut">—</span>'}</td><td>${t.deadline}</td><td>${badge(t.st)}</td>${isA()?`<td><button class="mini" data-a="del-task" data-id="${t.id}" title="Topshiriqni oʻchirish" style="color:var(--late)">🗑</button></td>`:''}</tr>`).join('')||`<tr><td colspan="${isA()?7:6}" class="mut">Topshiriq topilmadi</td></tr>`}</tbody></table></div>`;
const tasksTbl=()=>taskTable(filteredTasks({usePeriod:true,useStatus:true}));
const docMatchesFilter=(d,ql)=>{const uid=!seeAll()?S.me.id:(S.f.uid==='all'?null:+S.f.uid);return(S.f.org==='all'||d.org_id===+S.f.org)&&(S.f.ty==='all'||d.type===S.f.ty)&&(!uid||d.tasks.some(t=>t.assignees.some(a=>a.user_id===uid)))&&(S.f.st==='all'||d.tasks.some(t=>{const ev=evalForUser({...t,st:tst(t)},uid);return ev&&ev.st===S.f.st}))&&(!ql||(d.number+' '+d.title+' '+d.type+' '+(d.department||'')).toLowerCase().includes(ql))};
const docTaskWorst=d=>{const uid=!seeAll()?S.me.id:(S.f.uid==='all'?null:+S.f.uid);const sts=d.tasks.map(t=>evalForUser({...t,st:tst(t)},uid)).filter(Boolean);return worst(sts)||'new'};
const docsTbl=()=>{const ql=q_();const l=S.docs.filter(d=>docMatchesFilter(d,ql)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id);
 return`<div class="pn sc"><table><thead><tr><th>№</th><th>Mazmuni</th><th>Tashkilot / Boʻlim</th><th>Fayllar</th><th>Bajarilish holati</th><th>Sana</th><th></th></tr></thead><tbody>${l.map(d=>{const fc=(d.attachments||[]).length+d.tasks.reduce((n,t)=>n+t.assignees.reduce((m,a)=>m+(a.files||[]).length,0),0);return`<tr class="rw" data-a="doc" data-id="${d.id}"><td><b>${esc(d.number)}</b><small>${esc(d.type)}</small></td><td>${esc(d.title)}<small class="pri-${d.priority||'normal'}">${PR_UZ[d.priority||'normal']||''}</small></td><td>${esc(org(d.org_id).name)}${d.department?`<small>${esc(d.department)}</small>`:''}</td><td>${fc?`📎 ${fc}`:'<span class="mut">—</span>'}</td><td>${badge(docTaskWorst(d))}</td><td>${d.created_at}</td><td style="white-space:nowrap"><button class="mini" data-a="timeline" data-id="${d.id}" title="Hayot sikli">📊</button>${isA()?`<button class="mini" data-a="del-doc" data-id="${d.id}" title="Hujjatni oʻchirish" style="color:var(--late)">🗑</button>`:''}</td></tr>`}).join('')||'<tr><td colspan="7" class="mut">Hujjat topilmadi</td></tr>'}</tbody></table></div>`};

function dash(){
 const A=filteredTasks({usePeriod:false,useStatus:false});
 const P=A.filter(t=>inP(t));
 const L=S.f.st==='all'?P:P.filter(t=>t.st===S.f.st);
 const s=sum(P),y=sum(A.filter(t=>inP(t,-1))),C=251.3;
 const gr=s.pct>=90?['A\u02bblo','var(--ok)']:s.pct>=75?['Yaxshi','var(--pri)']:s.pct>=60?['Qoniqarli','var(--prog)']:['Past','var(--late)'];
 const monSrc=S.f.st==='all'?A:A.filter(t=>t.st===S.f.st);
 const mon=MS.map((_,i)=>monSrc.filter(t=>inP(t,i)).length),mx=Math.max(1,...mon);
 const card=(l,v,c,sub)=>`<div class="pn kp" data-a="go" data-p="tasks" data-s="${c}"><small>${l}</small><b style="color:${c==='all'?'var(--tx)':'var(--'+c+')'}">${v}</b><em>${sub}</em></div>`;
 let acc=0;const ring=['ok','prog','late','new'].map(k=>{const l=s.total?s[k]/s.total*C:0,e=`<circle r="40" cx="60" cy="60" fill="none" stroke="var(--${k})" stroke-width="16" stroke-dasharray="${l} ${C-l}" stroke-dashoffset="${-acc}" transform="rotate(-90 60 60)"/>`;acc+=l;return e}).join('');
 const ql=q_();
 const rec=S.docs.filter(d=>docMatchesFilter(d,ql)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id).slice(0,6);
 const pOk=s.total?s.ok/s.total*100:0,pProg=s.total?s.prog/s.total*100:0,pLate=s.total?s.late/s.total*100:0,pNew=s.total?s.new/s.total*100:0;
 const empBanner=(seeAll()&&S.f.uid!=='all')?(()=>{const u=user(+S.f.uid);return`<div class="emp-banner"><div><b>👤 ${esc(u.name)}</b><small>${esc(org(u.org_id).name)}${u.department?' · '+esc(u.department):''}${u.pos?' · '+esc(u.pos):''}</small></div><button class="btn gh sm" data-a="pick-emp" data-uid="all">✕ Barcha xodimlarga qaytish</button></div>`;})():'';
 let empSection='';
 if(seeAll()){
  const empPool=filteredTasks({usePeriod:true,useStatus:false,useEmp:false});
  const empRows=execUsers().filter(u=>S.f.org==='all'||u.org_id===+S.f.org).map(u=>{
   const ut=empPool.map(t=>evalForUser(t,u.id)).filter(Boolean);
   const us=sum(ut);
   return{u,us};
  }).filter(x=>x.us.total>0||String(x.u.id)===String(S.f.uid)).sort((a,b)=>b.us.total-a.us.total||b.us.pct-a.us.pct);
  empSection=`<div class="pn"><div class="bar"><h3 style="margin:0;flex:1">👥 Xodimlar boʻyicha ijro statistikasi</h3><span class="mut" style="font-size:12px">Xodim ustiga bosing — alohida filtrlanadi</span></div><div class="sc"><table><thead><tr><th>Xodim</th><th>Jami</th><th>Vaqtida</th><th>Jarayonda</th><th>Kechikkan</th><th>Oʻrtacha kun</th><th>Samaradorlik</th></tr></thead><tbody>${empRows.map(({u,us})=>`<tr class="rw" data-a="pick-emp" data-uid="${u.id}" ${String(S.f.uid)===String(u.id)?'style="background:color-mix(in srgb,var(--pri) 14%,transparent)"':''}><td><b>${esc(u.name)}</b><small>${esc(org(u.org_id).name)}${u.pos?' · '+esc(u.pos):''}</small></td><td><b>${us.total}</b></td><td><i class="ok">${us.ok}</i></td><td><i class="prog">${us.prog}</i></td><td><i class="late">${us.late}</i></td><td>${us.avg.toFixed(1)}</td><td><span class="mini-bar"><i style="width:${us.pct}%"></i></span><b>${us.pct}%</b></td></tr>`).join('')||'<tr><td colspan="7" class="mut">Tanlangan davr uchun biriktirilgan topshiriqlar yoʻq</td></tr>'}</tbody></table></div></div>`;
 }
 const panelLabel=S.me.role==='admin'?'Administrator paneli':S.me.role==='operator'?'Operator paneli':S.me.role==='viewer'?'Kuzatuvchi paneli':'Xodim paneli';
 return`<div class="bar"><div style="flex:1"><h2>Salom, ${esc(short(S.me.name))} 👋</h2><span class="mut">${panelLabel} · ${S.year}-yil${S.month<0?'':' · '+MN[S.month]} · hujjat aylanish ko\u02bbrsatkichlari</span></div>${exportBtns()}</div>
${filterBar({showPeriod:true,showEmp:true,showOrg:true,showStatus:true,showType:true})}
${empBanner}
<div class="k4">${card('Jami topshiriqlar',s.total,'all',`yil bo\u02bbyicha ${y.total} ta`)}${card('Vaqtida bajarildi',s.ok,'ok',s.pct+'% bajarildi')}${card('Muddatdan oshdi',s.late,'late',s.latePct+'% muddati o\u02bbtgan')}${card('Jarayonda',s.prog+s.new,'prog',`${s.progPct}% · ${s.new} ta biriktirilmagan`)}</div>
<div class="pbar" title="Bajarilgan: ${s.pct}% | Jarayonda: ${Math.round(pProg)}% | Kechikkan: ${s.latePct}% | Yangi: ${Math.round(pNew)}%"><span style="width:${pOk}%;background:var(--ok)"></span><span style="width:${pProg}%;background:var(--prog)"></span><span style="width:${pLate}%;background:var(--late)"></span><span style="width:${pNew}%;background:var(--new)"></span></div>
<div class="r2"><div class="pn"><h3>Oylar bo\u02bbyicha kelgan topshiriqlar</h3><div class="ch">${mon.map((v,i)=>`<div class="bc${i===S.month?' on':''}" data-a="mon" data-m="${i}"><b>${v}</b><div class="bw"><i style="height:${v/mx*100}%"></i></div><span>${MS[i]}</span></div>`).join('')}</div></div>
<div class="pn"><h3>Holatlar (%)</h3><svg viewBox="0 0 120 120" width="100%" style="max-height:150px"><circle r="40" cx="60" cy="60" fill="none" stroke="var(--line)" stroke-width="16"/>${ring}<text x="60" y="62" text-anchor="middle" class="dn">${s.total}</text><text x="60" y="73" text-anchor="middle" class="ds">topshiriq</text></svg><div class="lgd">${ORDER.map(k=>`<span style="--c:var(--${k})">${ST[k]}: ${s[k]} (${s.total?Math.round(s[k]/s.total*100):0}%)</span>`).join('')}</div></div>
<div class="pn"><h3>Bajarilish ko\u02bbrsatkichi</h3><svg viewBox="0 0 200 115" width="100%"><path d="M20 100A80 80 0 0 1 180 100" fill="none" stroke="var(--line)" stroke-width="16" stroke-linecap="round"/><path d="M20 100A80 80 0 0 1 180 100" fill="none" stroke="${gr[1]}" stroke-width="16" stroke-linecap="round" stroke-dasharray="251.3" stroke-dashoffset="${251.3*(1-s.pct/100)}"/><text x="100" y="95" text-anchor="middle" class="dn">${s.pct}%</text></svg><div class="gl" style="color:${gr[1]}">${gr[0]}</div><small style="text-anchor:middle;text-align:center">o\u02bbrtacha ${s.avg.toFixed(1)} kunda bajarilgan</small></div></div>
${empSection}
<div class="bar" style="margin-top:8px"><h3 style="margin:0;flex:1">✅ Topshiriqlar va bajarilish holati (${L.length})</h3><button class="btn gh sm" data-a="go" data-p="tasks">Barchasi</button></div><div id="dt">${taskTable(L.slice(0,20))}</div>
<div class="pn"><div class="bar"><h3 style="margin:0;flex:1">So\u02bbnggi hujjatlar</h3><button class="btn gh" data-a="go" data-p="docs">Barchasi</button></div><div class="sc"><table><tbody>${rec.map(d=>`<tr class="rw" data-a="doc" data-id="${d.id}"><td><b>${esc(d.number)}</b><small>${esc(d.type)}</small></td><td>${esc(d.title)}</td><td>${esc(org(d.org_id).name)}${d.department?`<small>${esc(d.department)}</small>`:''}</td><td>${badge(docTaskWorst(d))}</td><td>${d.created_at}</td></tr>`).join('')||'<tr><td colspan="5" class="mut">Hali hujjatlar yo\u02bbq</td></tr>'}</tbody></table></div></div>`}

const tasksV=()=>{const l=filteredTasks({usePeriod:true,useStatus:true});const s=sum(l);return`<div class="bar"><h2>Topshiriqlar</h2>${exportBtns()}</div>${filterBar({showPeriod:true,showEmp:true,showOrg:true,showStatus:true,showType:true})}<div class="sum-strip"><span class="bd">Jami: ${s.total}</span><span class="bd ok">Vaqtida: ${s.ok} (${s.pct}%)</span><span class="bd prog">Jarayonda: ${s.prog}</span><span class="bd late">Muddatdan oshdi: ${s.late}</span><span class="bd new">Biriktirilmagan: ${s.new}</span></div><div id="dt">${taskTable(l)}</div>`};
const docsV=()=>`<div class="bar"><h2>Hujjatlar</h2>${admin()?'<button class="btn" data-a="go" data-p="new">＋ Yangi hujjat</button>':''}${exportBtns()}</div>${filterBar({showPeriod:false,showEmp:true,showOrg:true,showStatus:true,showType:true})}<div id="dt">${docsTbl()}</div>`;

function cal(){const y=S.calYear,m=S.calMonth<0?0:S.calMonth,A=filteredTasks({usePeriod:false,useStatus:false}),off=(new Date(Date.UTC(y,m,1)).getUTCDay()+6)%7,dn=new Date(Date.UTC(y,m+1,0)).getUTCDate(),by={};
 A.forEach(t=>(by[t.date]=by[t.date]||[]).push(t));let cells='';for(let i=0;i<off;i++)cells+='<div class="cd e"></div>';
 for(let d=1;d<=dn;d++){const ds=`${y}-${pad(m+1)}-${pad(d)}`,l=by[ds]||[],c=sum(l),w=worst(l);
  cells+=`<div class="cd${w?' w-'+w:''}${ds===S.day?' sel':''}${ds===today?' now':''}" data-a="day" data-d="${ds}"><span>${d}</span>${l.length?`<div class="pl">${ORDER.filter(k=>c[k]).map(k=>`<i class="c-${k}">${c[k]}</i>`).join('')}</div>`:''}</div>`}
 const dl=(by[S.day]||[]),ds=sum(dl);
 return`<div class="bar"><h2>Kalendar</h2><button class="ico" data-a="cm" data-v="-1">‹</button><b class="cmt">${MN[m]} ${y}</b><button class="ico" data-a="cm" data-v="1">›</button>${sel('cyear',years,y)}${sel('cmonth',MN.map((n,i)=>[i,n]),m)}</div>
${seeAll()?filterBar({showPeriod:false,showEmp:true,showOrg:true,showStatus:false}):''}
<div class="lgd" style="margin:0 0 12px">${ORDER.map(k=>`<span style="--c:var(--${k})">${ST[k]}</span>`).join('')}</div>
<div class="cg">${['Du','Se','Ch','Pa','Ju','Sh','Ya'].map(x=>`<div class="ch0">${x}</div>`).join('')}${cells}</div>
<h3>${S.day} kuni kelgan topshiriqlar (${dl.length})</h3>
<div class="cal-sum"><span class="bd">Tushgan: ${ds.total}</span><span class="bd ok">Bajarilgan: ${ds.ok} (${ds.pct}%)</span><span class="bd prog">Jarayonda: ${ds.prog}</span><span class="bd late">Muddati o\u02bbtgan: ${ds.late}</span><span class="bd new">Biriktirilmagan: ${ds.new}</span></div>
${taskTable(dl)}`}

// ---- Topshiriq kartasi (ko'rish vaqti, delegatsiya, javob fayllari) ----
const filePickHtml=(id,multiple=false)=>`<label class="file-pick"><input type="file" id="${id}" class="vh-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.png,.jpg,.jpeg,.webp,.zip,.rar,.7z"${multiple?' multiple':''}><span class="file-pick-btn">📎 Fayl yuklash</span><span class="file-name">Tanlanmagan</span></label>`;
const initials=n=>short(n).split(/\s+/).map(x=>x[0]||'').join('').slice(0,2).toUpperCase()||'X';
const respItemHtml=f=>`<div class="att-chip"><div class="att-info"><span class="att-name">📄 ${esc(f.orig_name)} <span class="mut" style="font-weight:400">(${fmtSize(f.size_bytes)})${f.archived_tg?' · ☁️ Telegram Arxiv':''}</span></span>${f.note?`<span class="att-note">📝 ${esc(f.note)}</span>`:''}</div><div style="display:flex;gap:4px;align-items:center"><button data-a="view-file" data-id="${f.id}" data-name="${esc(f.orig_name)}" data-mime="${esc(f.mime_type||'')}" title="Ko\u02bbrish">👁 Ko\u02bbrish</button><button data-a="dl-file" data-id="${f.id}" data-name="${esc(f.orig_name)}" title="Yuklab olish">⬇</button>${isA()?`<button data-a="del-file" data-id="${f.id}" title="Faylni o\u02bbchirish (Admin)" style="color:var(--late)">🗑</button>`:''}</div></div>`;
const taskCard=t=>{const st=tst(t),free=S.users.filter(u=>u.role==='user'&&u.active&&!u.onboarding_required&&!t.assignees.some(a=>a.user_id===u.id));
 return`<div class="pn"><div class="bar"><b style="flex:1">${esc(t.title)}</b>${badge(st)}${isA()?`<button class="mini" data-a="del-task" data-id="${t.id}" title="Topshiriqni oʻchirish" style="color:var(--late)">🗑 Topshiriqni oʻchirish</button>`:''}</div><p class="mut" style="margin:0 0 8px">Bergan: ${esc(user(t.issued_by).name)} · muddat ${t.deadline}</p>${t.assignees.map(a=>{const k=ast(a,t);const uObj=user(a.user_id);const delegTo=a.delegated_to?user(a.delegated_to):{name:null};const isOwn=a.user_id===S.me.id;const canAct=admin()||isOwn;
 return`<div class="exec-card"><div class="exec-head"><div class="exec-user"><div class="exec-av">${esc(initials(uObj.name))}</div><div><b>${esc(uObj.name)}</b><small>${esc(org(uObj.org_id).name)} · biriktirgan: ${esc(user(a.assigned_by).name)}, ${a.assigned_at}</small><div class="meta-pills">${a.viewed_at?`<span class="viewed-tag">👁 Ko\u02bbrildi: ${fmt(a.viewed_at)}</span>`:'<span class="not-viewed">Hali ko\u02bbrilmagan</span>'}${a.delegated_to?`<span class="deleg-tag">🔀 → ${esc(delegTo.name)} ga uzatildi${a.delegation_note?' ('+esc(a.delegation_note)+')':''}</span>`:''}</div>${a.completion_note?`<div class="resp-quote">💬 <b>Ijro iqtibosi:</b> ${esc(a.completion_note)}${a.done_at?` <span class="mut">(${fmt(a.done_at)})</span>`:''}</div>`:''}</div></div><div class="exec-acts"><span class="bd ${k}">${k==='ok'?'✓ '+a.done_date:k==='late'?(a.done_date?'Kech '+a.done_date:'Muddati o\u02bbtdi'):'Jarayonda'}</span>
 ${isOwn?`<button class="mini" data-a="done" data-id="${a.id}" data-v="${a.done_date?'':'1'}" title="${a.done_date?'Bajarilishni bekor qilish':'Bajarildi deb belgilash'}">${a.done_date?'\u21ba Bekor':'✓ Bajarildi'}</button>`:''}
 ${canAct?`<button class="mini" data-a="delegate" data-aid="${a.id}" title="Boshqa xodimga uzatish">🔀 Uzatish</button>`:''}
 ${isOwn&&!a.viewed_at?`<button class="mini" data-a="mark-viewed" data-aid="${a.id}">👁 Ko\u02bbrdim</button>`:''}
 ${isA()?`<button class="mini" data-a="del-assignee" data-id="${a.id}" title="Xodimdan vazifani bekor qilish" style="color:var(--late)">✕ Bekor qilish</button>`:''}
 </div></div>
 ${((a.files&&a.files.length)||isOwn)?`<div class="resp-files">${(a.files&&a.files.length)?`<div class="resp-chips">${a.files.map(respItemHtml).join('')}</div>`:''}${isOwn?`<div class="resp-box"><div class="resp-box-title">${a.done_date?'➕ Qoʻshimcha javob fayli yuborish':'📤 Topshiriqqa javob yuborish (Fayl + Majburiy iqtibos)'}</div><textarea id="rn${a.id}" class="resp-note" rows="2" placeholder="Majburiy iqtibos / ijro tavsifi: bajarilgan ish haqida aniq maʼlumot yozing..."></textarea><div class="resp-row">${filePickHtml('rf'+a.id,false)}<button class="btn sm" data-a="up-resp" data-aid="${a.id}">📤 Javob yuborish</button></div></div>`:''}</div>`:''}
 </div>`}).join('')||'<p class="mut">Hali biriktirilmagan</p>'}${admin()&&free.length?`<div class="bar" style="margin-top:12px"><select id="as${t.id}" class="chip">${opts(free.map(u=>[u.id,esc(u.name)]),0)}</select><button class="btn" data-a="assign" data-id="${t.id}">Biriktirish</button></div>`:''}</div>`};

// ---- Hujjat ko'rinishi (fayllar va topshiriqlar) ----
function docV(){const d=S.docs.find(x=>x.id===S.doc);if(!d)return'<p class="mut">Topilmadi</p>';
 const atts=d.attachments||[];
 const respFiles=d.tasks.flatMap(t=>t.assignees.flatMap(a=>(a.files||[]).map(f=>({...f,userName:user(a.user_id).name}))));
 return`<div class="bar"><button class="btn gh" data-a="go" data-p="docs">← Hujjatlar</button><h2>№ ${esc(d.number)} · ${esc(d.type)}</h2>${badge(docTaskWorst(d))}<button class="mini" data-a="timeline" data-id="${d.id}" title="Hayot sikli">📊 Hayot sikli</button>${exportBtns()}${isA()?`<button class="btn sm btn-danger" data-a="del-doc" data-id="${d.id}" title="Hujjat va barcha topshiriqlarni oʻchirish">🗑 Oʻchirish</button>`:''}</div>
<div class="pn"><b>${esc(d.title)}</b><p class="mut">${esc(org(d.org_id).name)}${d.department?' · Bo\u02bblim: '+esc(d.department):''} · yaratilgan ${d.created_at} · ${esc(user(d.created_by).name)} · <span class="pri-${d.priority||'normal'}">${PR_UZ[d.priority||'normal']||''}</span></p></div>
<div class="pn"><h3>📎 Topshiriq / Hujjat fayllari (${atts.length})</h3>
<div class="att-list">${atts.map(f=>`<div class="att-item"><div class="att-info" data-a="view-file" data-id="${f.id}" data-name="${esc(f.orig_name)}" data-mime="${esc(f.mime_type||'')}" style="cursor:pointer"><span class="att-name">📄 ${esc(f.orig_name)}</span>${f.note?`<span class="att-note">📝 ${esc(f.note)}</span>`:''}<span class="att-meta">${fmtSize(f.size_bytes)} · ${esc(short(user(f.uploaded_by).name))} · ${fmt(f.created_at)}</span></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn gh sm" data-a="view-file" data-id="${f.id}" data-name="${esc(f.orig_name)}" data-mime="${esc(f.mime_type||'')}">👁 Ko\u02bbrish</button><button class="btn sm" data-a="dl-file" data-id="${f.id}" data-name="${esc(f.orig_name)}">⬇ Yuklab olish</button>${isA()?`<button class="mini" data-a="del-file" data-id="${f.id}" title="Faylni o\u02bbchirish" style="color:var(--late)">🗑 O\u02bbchirish</button>`:''}</div></div>`).join('')||'<p class="mut">Biriktirilgan fayl yo\u02bbq</p>'}</div>
${admin()?`<div class="file-row">${filePickHtml('df-files',true)}<input id="df-note" placeholder="Fayl tavsifi (ixtiyoriy)" style="flex:1;min-width:180px;font-size:12px"><button class="btn sm" data-a="up-doc-file" data-id="${d.id}">📎 Fayl biriktirish</button></div>`:''}</div>
${respFiles.length?`<div class="pn"><h3>📥 Xodimlar yuborgan javob fayllari (${respFiles.length})</h3><div class="att-list">${respFiles.map(f=>`<div class="att-item"><div class="att-info" data-a="view-file" data-id="${f.id}" data-name="${esc(f.orig_name)}" data-mime="${esc(f.mime_type||'')}" style="cursor:pointer"><span class="att-name">📄 ${esc(f.orig_name)}</span>${f.note?`<span class="att-note">📝 ${esc(f.note)}</span>`:''}<span class="att-meta">Yuborgan: ${esc(f.userName)} · ${fmtSize(f.size_bytes)} · ${fmt(f.created_at)}</span></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn gh sm" data-a="view-file" data-id="${f.id}" data-name="${esc(f.orig_name)}" data-mime="${esc(f.mime_type||'')}">👁 Ko\u02bbrish</button><button class="btn sm" data-a="dl-file" data-id="${f.id}" data-name="${esc(f.orig_name)}">⬇ Yuklab olish</button>${isA()?`<button class="mini" data-a="del-file" data-id="${f.id}" title="Faylni o\u02bbchirish" style="color:var(--late)">🗑 O\u02bbchirish</button>`:''}</div></div>`).join('')}</div></div>`:''}
<h3>Topshiriqlar</h3>${d.tasks.map(t=>taskCard(t)).join('')}`}

// ---- Hayot sikli ----
function timelineV(){
  const tl=S.timeline;
  if(!tl)return'<p class="mut">Yuklanmoqda...</p>';
  const d=S.docs.find(x=>x.id===tl.doc_id)||{number:tl.doc_number,title:tl.doc_title};
  return`<div class="bar"><button class="btn gh" data-a="doc" data-id="${tl.doc_id}">← Hujjatga qaytish</button><h2>📊 Hayot sikli: № ${esc(d.number||tl.doc_number)}</h2></div>
<div class="pn"><b>${esc(d.title||tl.doc_title)}</b></div>
<div class="pn tl-wrap">${tl.timeline.map((e,i)=>`
<div class="tl-item">
  <div class="tl-icon ${e.type}">${EVT_ICON[e.type]||'•'}</div>
  ${i<tl.timeline.length-1?'<div class="tl-line-v"></div>':'<div class="tl-line-v last"></div>'}
  <div class="tl-body">
    <div class="tl-label">${esc(e.label)}</div>
    <div class="tl-time">${fmt(e.time)}</div>
    ${e.wait_minutes!=null?`<div class="tl-meta">Ko\u02bbrishga ketgan vaqt: <b>${e.wait_minutes<60?e.wait_minutes+' daqiqa':Math.round(e.wait_minutes/60)+' soat'}</b></div>`:''}
    ${e.on_time!=null?`<div class="tl-meta ${e.on_time?'ok':'late'}">${e.on_time?'✅ O\u02bbz vaqtida bajarildi':'⚠️ Muddatdan kechikib bajarildi'}</div>`:''}
    ${e.note?`<div class="tl-note">📝 ${esc(e.note)}</div>`:''}
    ${e.deadline?`<div class="tl-meta">Muddat: ${e.deadline}</div>`:''}
  </div>
</div>`).join('')||'<p class="mut">Voqealar yo\u02bbq</p>'}</div>`}

// ---- Yangi hujjat ----
function newV(){const us=S.users.filter(u=>u.role==='user'&&u.active&&!u.onboarding_required);
 return`<div class="bar"><button class="btn gh" data-a="go" data-p="docs">← Hujjatlar</button><h2>Yangi hujjat</h2></div>
<div class="pn fm">
  <label>Raqam<input id="n-no" placeholder="123/-26"></label>
  <label>Turi<select id="n-ty">${opts(['Nazorat varaqasi','Xat','Buyruq','Farmoyish'].map(x=>[x,x]),'')}</select></label>
  <label>Tashkilot<div class="inline-row"><select id="n-og">${opts(S.orgs.map(o=>[o.id,esc(o.name)]),0)}</select><button type="button" class="mini" data-a="toggle-new-org" title="Yangi tashkilot qo\u02bbshish">＋</button></div></label>
  <label>Boʻlim<input id="n-dept" placeholder="Masalan: Axborot texnologiyalari bo\u02bblimi"></label>
  <label>Muddat<input id="n-dl" type="date" value="${addD(today,7)}"></label>
  <label>Muhimlik<select id="n-pr">${opts([['normal','Oddiy'],['high','Yuqori'],['urgent','Shoshilinch'],['low','Past']],'normal')}</select></label>
  <label class="w2">Qisqacha mazmuni / Hujjat tafsilotlari<textarea id="n-ti" rows="3"></textarea></label>
  <label>Bajaruvchi<select id="n-as"><option value="">— keyin biriktiriladi —</option>${opts(us.map(u=>[u.id,esc(u.name)]),'')} </select></label>
  <div><small style="margin-bottom:4px">Hujjat fayllari (PDF, Word, Excel, rasm)</small>${filePickHtml('n-files',true)}</div>
  <div class="w2"><button class="btn" data-a="create">Yaratish va yuborish</button></div>
</div>`}

// ---- Foydalanuvchilar ----
const usersV=()=>{
 const uList=S.users.filter(u=>S.f.org==='all'||u.org_id===+S.f.org);
 const pool=S.T.filter(t=>inP(t));
 return`<div class="bar"><h2>Xodimlar</h2>${isA()?'<button class="btn" data-a="new-user">＋ Yangi xodim</button>':''}</div>
${filterBar({showPeriod:true,showEmp:false,showOrg:true,showStatus:false,showType:false})}
<div class="pn sc" style="margin-top:12px"><table><thead><tr><th>Xodim</th><th>Tashkilot / Boʻlim</th><th>Lavozim</th><th>Rol</th><th>Holat</th><th>Roʻyxatdan oʻtgan</th><th>Topshiriq</th><th>Vaqtida</th><th>Jarayonda</th><th>Kechikkan</th><th>Samaradorlik</th>${isA()?'<th>ID / Login</th><th></th>':'<th></th>'}</tr></thead><tbody>${uList.map(u=>{const s=sum(pool.map(t=>evalForUser(t,u.id)).filter(Boolean));return`<tr ${!u.active?'style="opacity:.5"':''}><td>${esc(u.name)}${u.onboarding_required?' <span class="bd new">Shablon eshik</span>':''}</td><td>${esc(org(u.org_id).name)}${u.department?`<small>${esc(u.department)}</small>`:''}</td><td>${esc(u.pos||'')}</td><td>${ROLE_UZ[u.role]||u.role}</td><td>${u.active?'<span class="active-y">● Faol</span>':'<span class="active-n">● Bloklangan</span>'}</td><td>${fmt(u.created_at)}</td><td>${s.total}</td><td><i class="ok">${s.ok}</i></td><td><i class="prog">${s.prog}</i></td><td><i class="late">${s.late}</i></td><td><span class="mini-bar"><i style="width:${s.pct}%"></i></span>${s.pct}%</td>${isA()?`<td>${esc(u.code||'')}</td><td style="white-space:nowrap"><button class="mini" data-a="emp-dash" data-id="${u.id}" title="Statistika">📊</button><button class="mini" data-a="edit-user" data-id="${u.id}" title="Tahrirlash">✏️</button><button class="mini" data-a="toggle-user" data-id="${u.id}" data-v="${u.active?'0':'1'}" title="${u.active?'Bloklash':'Faollashtirish'}">${u.active?'🔒':'🔓'}</button>${u.id!==S.me.id?`<button class="mini" data-a="del-user" data-id="${u.id}" title="Xodimni o\u02bbchirish" style="color:var(--late)">🗑</button>`:''}</td>`:`<td><button class="mini" data-a="emp-dash" data-id="${u.id}" title="Statistika">📊</button></td>`}</tr>`}).join('')}</tbody></table></div><div id="user-modal"></div>`;
};

function showUserModal(uid){
  const u=uid?S.users.find(x=>x.id===uid):null;
  const m=$('#user-modal');if(!m)return;
  m.innerHTML=`<div class="modal-wrap"><div class="modal-box"><h3>${u?'Xodimni tahrirlash':'Yangi xodim qo\u02bbshish (Maxfiy)'}</h3><div class="form-gr">
    <label>Ism<input id="u-name" class="inp" value="${esc(u?.name||'')}" placeholder="To\u02bbliq ism"></label>
    <label>Login / ID kod${u?'':' *'}<input id="u-code" class="inp" value="${esc(u?.code||'')}" placeholder="masalan: U010" ${u?'readonly':''}></label>
    <label>Tashkilot<select id="u-org" class="inp">${S.orgs.map(o=>`<option value="${o.id}"${u?.org_id===o.id?' selected':''}>${esc(o.name)}</option>`).join('')}</select></label>
    <label>Boʻlim<input id="u-dept" class="inp" value="${esc(u?.department||'')}" placeholder="Bo\u02bblim nomi"></label>
    <label>Lavozim<input id="u-pos" class="inp" value="${esc(u?.pos||'')}" placeholder="Lavozim"></label>
    <label>Rol<select id="u-role" class="inp">${['user','operator','viewer','admin'].map(r=>`<option value="${r}"${(u?.role||'user')===r?' selected':''}>${ROLE_UZ[r]}</option>`).join('')}</select></label>
    <label>Telegram Chat ID (ixtiyoriy)<input id="u-tg" class="inp" value="${esc(u?.telegram_chat_id||'')}" placeholder="Masalan: 123456789"></label>
    <label>Vaqtinchalik parol${u?' (o\u02bbzgartirish uchun)':' *'}<input id="u-pwd" type="password" class="inp" placeholder="Kamida 8 belgi"></label>
    <label class="full" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer"><input id="u-reset" type="checkbox" ${(!u||u.auth_reset_required)?'checked':''}> Xodim kirgach parolni o\u02bbzi o\u02bbzgartirishi shart</label>
  </div><div class="modal-actions">
    <button class="btn gh" data-a="close-modal">Bekor qilish</button>
    <button class="btn" data-a="save-user" data-id="${u?.id||''}">Saqlash</button>
  </div></div></div>`;
}

function showDelegateModal(aid){
  const curA=S.T.flatMap(t=>t.assignees).find(a=>a.id===aid);
  const list=S.users.filter(u=>u.role==='user'&&u.active&&!u.onboarding_required&&u.id!==S.me.id&&(!curA||u.id!==curA.user_id));
  const m=$('#global-modal');if(!m)return;
  m.innerHTML=`<div class="modal-wrap"><div class="modal-box"><h3>🔀 Topshiriqni boshqa xodimga uzatish</h3><div class="form-gr">
    <label class="full">Xodimni tanlang<select id="dl-user" class="inp">${list.length?list.map(u=>`<option value="${u.id}">${esc(u.name)} (${esc(org(u.org_id).name)})</option>`).join(''):'<option value="">Uzatish uchun boshqa xodim yo\u02bbq</option>'}</select></label>
    <label class="full">Izoh (ixtiyoriy)<textarea id="dl-note" rows="3" placeholder="Uzatish sababi yoki ko\u02bbrsatma..."></textarea></label>
  </div><div class="modal-actions">
    <button class="btn gh" data-a="close-gmodal">Bekor qilish</button>
    <button class="btn" data-a="confirm-delegate" data-aid="${aid}">Uzatish</button>
  </div></div></div>`;
}

function showForcePwModal(){
  return`<div class="modal-wrap"><div class="modal-box"><h3>🔐 Parolni yangilash (Majburiy)</h3><p class="mut" style="margin-bottom:12px">Siz vaqtinchalik parol bilan kirdingiz. Davom etish uchun o\u02bbzingizning shaxsiy parolingizni o\u02bbrnating.</p><div class="form-gr">
    <label class="full">Joriy (vaqtinchalik) parol<input id="fp-cur" type="password" placeholder="Vaqtinchalik parol"></label>
    <label class="full">Yangi parol (kamida 8 belgi)<input id="fp-new" type="password" placeholder="Yangi parol"></label>
    <label class="full">Yangi parolni tasdiqlang<input id="fp-con" type="password" placeholder="Takrorlang"></label>
  </div><div id="fp-err" class="err-msg"></div><div class="modal-actions">
    <button class="btn gh" data-a="out">Chiqish</button>
    <button class="btn" data-a="save-force-pw">Parolni saqlash</button>
  </div></div></div>`;
}

function showOnboardingModal(){
  const orgOpts=(S.orgs||[]).map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('');
  return`<div class="modal-wrap" style="position:fixed;inset:0;z-index:999">
    <div class="modal-box" style="max-width:520px">
      <h3>👤 Yangi xodimni roʻyxatdan oʻtkazish</h3>
      <p class="mut" style="margin-bottom:14px">Davom etish uchun shaxsiy maʼlumotlaringizni kiriting va oʻzingiz uchun doimiy login hamda parol yarating.</p>
      <div class="form-gr">
        <label class="full">Ism va Familiya *<input id="reg-name" class="inp" placeholder="Masalan: Rustam Karimov" autocomplete="name"></label>
        <label class="full">Tashkilot<select id="reg-org" class="inp">${orgOpts}</select></label>
        <label class="full">Boʻlim va Lavozimi *<input id="reg-pos" class="inp" placeholder="Masalan: Moliya boʻlimi yetakchi mutaxassisi"></label>
        <label class="full">Yangi shaxsiy Login *<input id="reg-login" class="inp" placeholder="Masalan: r_karimov" autocomplete="username"></label>
        <label>Yangi Parol *<input id="reg-pw" type="password" class="inp" placeholder="Kamida 8 belgi" autocomplete="new-password"></label>
        <label>Parolni tasdiqlash *<input id="reg-pw2" type="password" class="inp" placeholder="Parolni takrorlang" autocomplete="new-password"></label>
      </div>
      <div id="reg-err" class="err-msg" style="margin-top:8px"></div>
      <div class="modal-actions" style="justify-content:space-between">
        <button type="button" class="btn gh" data-a="out">Chiqish</button>
        <button type="button" class="btn" data-a="register-emp">Saqlash va kirish</button>
      </div>
    </div>
  </div>`;
}

// ---- Tashkilotlar ----
const orgsV=()=>`<div class="bar"><h2>Tashkilotlar</h2>${admin()?`<div style="display:flex;gap:8px;align-items:center"><input id="org-new-inp" placeholder="Yangi tashkilot nomi"><button class="btn" data-a="add-org">＋ Qo\u02bbshish</button></div>`:''}</div><div class="k4" style="margin-top:12px">${S.orgs.map(o=>{const ds=S.docs.filter(d=>d.org_id===o.id),s=sum(S.T.filter(t=>t.doc.org_id===o.id));return`<div class="pn"><b>${esc(o.name)}</b><p class="mut">${S.users.filter(u=>u.org_id===o.id&&u.role==='user').length} xodim</p><p>Hujjat: <b>${ds.length}</b><br>Topshiriq: <b>${s.total}</b><br>Samaradorlik: <b>${s.pct}%</b></p></div>`}).join('')}</div>`;

// ---- Sozlamalar (real sozlamalar, parol yangilash va SMS provayderini o'rnatish) ----
const SMS_PRESETS={eskiz:'https://notify.eskiz.uz/api/message/sms/send',playmobile:'https://send.smsxabar.uz/broker-api/send',custom:''};
function setV(){
  const curTh=(typeof localStorage!=='undefined'&&localStorage.getItem('ui_theme'))||'dark';
  const curAc=(typeof localStorage!=='undefined'&&localStorage.getItem('ui_accent'))||'#f08a1c';
  const smsRow=(S.integrations||[]).find(x=>x.key==='sms_provider');
  const cfg=smsRow?.value||{};
  const prov=cfg.provider||(/eskiz/i.test(cfg.api_url||'')?'eskiz':(/smsxabar|playmobile/i.test(cfg.api_url||'')?'playmobile':'eskiz'));
  const configured=Boolean(cfg.api_url);
const tgLinked=Boolean(S.me?.telegram_linked||S.tgLink?.linked);
  const tgUrl=S.tgLink?.url||'';
  return`<h2>Sozlamalar</h2>
<div class="pn" style="margin-top:12px"><div class="bar"><h3 style="margin:0;flex:1">🤖 Telegram bot integratsiyasi</h3><span class="${tgLinked?'st-on':'st-off'}">${tgLinked?'● Ulangan'+(S.tgLink?.telegram_username?' (@'+esc(S.tgLink.telegram_username)+')':''):'○ Ulanmagan'}</span></div>
<p class="mut" style="margin:0 0 12px">Botga ulanganingizdan so\u02bbng sizga biriktirilgan nazorat varaqalari, muddatlar va hujjat fayllari to\u02bbg\u02bbridan-to\u02bbg\u02bbri Telegramingizga yuboriladi.</p>
<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn" data-a="link-tg">${tgUrl?'🔗 Telegram botni ulash':'🤖 Telegramga ulanish yo\u02bbriqnomasi'}</button>${S.tgLink?.bot_username?`<span class="mut" style="font-size:12px">Bot: @${esc(S.tgLink.bot_username)}</span>`:''}</div>
<div id="tg-link-msg" class="mut" style="margin-top:8px;font-size:12px"></div></div>
<div class="pn"><h3>Ko\u02bbrinish</h3><div class="chips">${[['auto','Avtomatik'],['light','Yorug\u02bb'],['dark','Qorong\u02bbi']].map(([v,l])=>`<button class="chip${curTh===v?' on':''}" data-a="theme" data-v="${v}">${l}</button>`).join('')}</div><h3>Asosiy rang</h3><div class="chips">${['#f08a1c','#1fbf84','#4f8cff','#d94f9a'].map(c=>`<span class="sw${curAc===c?' on':''}" style="background:${c}" data-a="accent" data-v="${c}"></span>`).join('')}</div></div>
<div class="pn"><h3>🔐 Parolni o\u02bbzgartirish</h3><div class="form-gr" style="max-width:520px">
  <label>Joriy parol<input id="sp-cur" type="password" autocomplete="current-password" placeholder="Joriy parol"></label>
  <label>Yangi parol<input id="sp-new" type="password" autocomplete="new-password" placeholder="Kamida 8 belgi"></label>
  <label class="full">Tasdiqlash<input id="sp-con" type="password" autocomplete="new-password" placeholder="Yangi parolni takrorlang"></label>
</div><div style="margin-top:12px"><button class="btn" data-a="change-pw">Parolni yangilash</button></div><div id="sp-msg"></div></div>
${isA()?`<div class="pn"><div class="bar"><h3 style="margin:0;flex:1">📱 SMS provayderini o\u02bbrnatish</h3><span class="${configured?'st-on':'st-off'}">${configured?'● O\u02bbrnatilgan'+(smsRow.updated_at?' ('+smsRow.updated_at+')':''):'○ O\u02bbrnatilmagan'}</span></div>
<div class="form-gr" style="max-width:680px">
  <label>Provayder<select id="sms-prov" data-f="sms-prov">${opts([['eskiz','Eskiz.uz'],['playmobile','Playmobile'],['custom','Maxsus HTTP API']],prov)}</select></label>
  <label>API manzili (URL)<input id="sms-url" value="${esc(cfg.api_url||SMS_PRESETS[prov]||'')}" placeholder="https://notify.eskiz.uz/api/message/sms/send"></label>
  <label>Login / Email<input id="sms-login" value="${esc(cfg.login||'')}" placeholder="API login yoki email"></label>
  <label>Parol / Bearer Token<input id="sms-pass" type="password" placeholder="${cfg.has_password?'Saqlangan (yangilash uchun kiriting)':'Parol yoki API token'}"></label>
  <label>Yuboruvchi nomi (Sender / From)<input id="sms-sender" value="${esc(cfg.sender||'')}" placeholder="4546"></label>
  <label>Test telefon raqami<input id="sms-test-phone" value="${esc(cfg.test_phone||'')}" placeholder="+998901234567"></label>
  <label class="full" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer"><input id="sms-enabled" type="checkbox" ${cfg.enabled?'checked':''}> SMS xabarnoma yuborishni faollashtirish</label>
</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" data-a="save-sms-prov">💾 Saqlash</button><button class="btn gh" data-a="test-sms-prov">📤 Test SMS yuborish</button>${configured?'<button class="mini" data-a="del-sms-prov" style="color:var(--late)">🗑 Oʻchirish</button>':''}</div>
<div id="sms-prov-msg"></div></div>`:''}`}

// ---- Bildirishnomalar ----
const notifDocId=n=>{if(n.doc_id)return n.doc_id;const m=/№\s*([^\s·,]+)/.exec((n.title||'')+' '+(n.body||''));const d=m&&S.docs.find(x=>x.number===m[1]);return d?d.id:''};
const notifMsg=n=>{const raw=(n.title||'')+(n.body?' — '+n.body:'');const m=/№\s*([^\s·,]+)/.exec(raw);if(n.type==='new_task'&&m)return`Sizga <b>№ ${esc(m[1])}</b> raqamli nazorat varaqasi biriktirildi`;if(m)return`${esc(n.title)} (<b>№ ${esc(m[1])}</b>)`;return esc(n.title||'Yangi bildirishnoma')};
const notifV=()=>`<div class="bar"><h2>🔔 Bildirishnomalar</h2></div>
<div class="ios-notif-list">${Array.isArray(S.notifications)&&S.notifications.length?S.notifications.map(n=>{const did=notifDocId(n);return`
<div class="ios-notif ${n._justRead?'unread':'read'}${did?' clickable':''}" ${did?`data-a="open-notif" data-doc="${did}"`:''}>
  <div class="ios-notif-ic">${n.type==='new_task'?'📋':n.type==='delegated'?'🔀':n.type==='response_file'?'📤':n.type==='file_uploaded'?'📎':'🔔'}</div>
  <div class="ios-notif-content">
    <div class="ios-notif-top"><span class="ios-notif-app">HUJJAT AYLANISHI</span><span class="ios-notif-time">${fmt(n.created_at)}</span></div>
    <div class="ios-notif-msg">${notifMsg(n)}</div>
    ${n.body?`<div class="ios-notif-sub">${esc(n.body)}</div>`:''}
  </div>
  ${n._justRead?'<span class="ios-notif-dot"></span>':''}
</div>`}).join(''):'<p class="mut empty">Bildirishnomalar yo\u02bbq</p>'}
</div>`;

// ---- Arxiv ----
const archiveTbl=()=>{const l=(S.archive||[]).filter(r=>{const ql=q_();return !ql||(r.doc_number+' '+r.doc_title+' '+r.orig_name+' '+(r.note||'')+' '+(r.completion_note||'')+' '+(r.uploader_name||'')).toLowerCase().includes(ql)});
 return`<div class="pn sc" style="margin-top:12px"><table><thead><tr><th>Hujjat</th><th>Fayl</th><th>Turi</th><th>Iqtibos / Ijro tavsifi</th><th>Xodim / Yuboruvchi</th><th>Vaqt</th><th>Saqlash</th><th></th></tr></thead><tbody>${l.map(r=>`<tr><td class="rw" data-a="doc" data-id="${r.doc_id}"><b>${esc(r.doc_number)}</b><small>${esc(r.doc_title)}</small></td><td><b>📄 ${esc(r.orig_name)}</b><small>${fmtSize(r.size_bytes)}</small></td><td>${r.kind==='response'?'<span class="bd ok">📥 Ijro javobi</span>':'<span class="bd prog">📎 Hujjat</span>'}</td><td>${esc(r.note||r.completion_note||'—')}</td><td>${esc(r.uploader_name||'—')}</td><td>${fmt(r.done_at||r.uploaded_at)}</td><td>${r.tg_file_id?'<span class="viewed-tag">☁️ Telegram Arxiv</span>':'<span class="not-viewed">💾 Lokal</span>'}</td><td style="white-space:nowrap"><button class="mini" data-a="view-file" data-id="${r.attachment_id}" data-name="${esc(r.orig_name)}" data-mime="${esc(r.mime_type||'')}">👁 Ko\u02bbrish</button><button class="mini" data-a="dl-file" data-id="${r.attachment_id}" data-name="${esc(r.orig_name)}">⬇</button></td></tr>`).join('')||'<tr><td colspan="8" class="mut">Arxivda hozircha fayllar yo\u02bbq</td></tr>'}</tbody></table></div>`};
const archiveV=()=>`<div class="bar"><h2>🗄 Arxiv — Barcha hujjatlar, javob fayllari va iqtiboslar</h2><button class="btn gh sm" data-a="refresh-archive">🔄 Yangilash</button></div><div id="dt">${archiveTbl()}</div>`;

// ---- Navigatsiya ----
const NAV=[['🏠','Dashboard','dash'],['📄','Hujjatlar','docs'],['✅','Topshiriqlar','tasks'],['📅','Kalendar','cal'],['🗄','Arxiv','archive'],['👥','Xodimlar','users'],['🏛','Tashkilotlar','orgs'],['⚙️','Sozlamalar','set'],['🔔','Bildirishnomalar','notif']];
let renderedAuthReset=null,renderedDoc=null;

function render(){
  if(S.me&&S.me.onboarding_required){
    $('#app').innerHTML=showOnboardingModal();
    renderedAuthReset=null;
    return;
  }
  const p=S.page;
  const sy=typeof scrollY==='number'?scrollY:0;
  const pg={dash,docs:docsV,doc:docV,timeline:timelineV,cal,archive:archiveV,tasks:tasksV,users:usersV,orgs:orgsV,set:setV,new:newV,notif:notifV}[p];
  const unreadBadge=S.unread>0?`<span class="badge" style="position:absolute;top:2px;right:2px;background:var(--late);color:#fff;border-radius:8px;padding:0 4px;font-size:9px">${S.unread}</span>`:'';
  const forceModal=S.me&&S.me.auth_reset_required?showForcePwModal():'';
  const navHtml=`<div class="lg0">D</div>${NAV.map(([i,t,k])=>`<button class="si${p===k||(['doc','new','timeline'].includes(p)&&k==='docs')?' on':''}" data-a="go" data-p="${k}" title="${t}" style="position:relative">${i}${k==='notif'?unreadBadge:''}</button>`).join('')}`;
  const pageChanged=p!==renderedPage||(p==='doc'&&S.doc!==renderedDoc);
  const bodyEl=typeof document.createElement==='function'?$('#mc-body'):null;
  if(bodyEl&&renderedAuthReset===Boolean(forceModal)){
    const sb=$('.sb');if(sb)sb.innerHTML=navHtml;
    const qEl=$('#q');if(qEl&&document.activeElement!==qEl&&qEl.value!==S.f.q)qEl.value=S.f.q;
    bodyEl.innerHTML=pg();
  }else{
    $('#app').innerHTML=`<nav class="sb">${navHtml}</nav><main class="mc"><header class="top"><input id="q" type="search" name="doc_search" autocomplete="off" autocorrect="off" spellcheck="false" readonly class="srch" placeholder="Hujjat raqami, mazmuni yoki bo\u02bblim bo\u02bbyicha qidirish..." value="${esc(S.f.q)}">${admin()?'<button class="btn" data-a="go" data-p="new">＋ Yangi hujjat</button>':''}<span id="clk" class="mut" style="font-size:12px;white-space:nowrap">🕒 ${nowClock()}</span><span class="who">${esc(short(S.me.name))}</span><button class="ico" data-a="out" title="Chiqish">⎋</button></header><div id="mc-body">${pg()}</div></main><div id="global-modal"></div>${forceModal}`;
    renderedAuthReset=Boolean(forceModal);
  }
  renderedPage=p;renderedDoc=S.doc;
  if(typeof scrollTo==='function'){if(pageChanged)scrollTo(0,0);else if(sy)scrollTo(0,sy);}
}

function smsFormPayload(isTest=false){
  const p={
    provider:$('#sms-prov')?.value||'eskiz',
    api_url:($('#sms-url')?.value||'').trim(),
    login:($('#sms-login')?.value||'').trim(),
    sender:($('#sms-sender')?.value||'').trim(),
    test_phone:($('#sms-test-phone')?.value||'').trim(),
    enabled:!!$('#sms-enabled')?.checked,
  };
  const pwd=$('#sms-pass')?.value||'';
  if(pwd)p.password=pwd;
  if(isTest)p.test_connection=true;
  return p;
}

// ---- Voqealar ----
document.addEventListener('click',async ev=>{
  const t=ev.target.closest('[data-a]');if(!t)return;
  const isBtn=t.tagName==='BUTTON'&&t.classList&&'disabled'in t;
  if(isBtn&&t.disabled)return;
  if(isBtn){t.disabled=true;t.classList.add('is-busy');}
  try{
    const a=t.dataset.a,v=t.dataset.v,id=+t.dataset.id;let sync=false;
    if(a==='go'){
      dirtyForm=false;
      S.page=t.dataset.p;
      if(t.dataset.s!==undefined){S.f.st=t.dataset.s||'all';kpiSt=true;}
      else if(kpiSt){S.f.st='all';kpiSt=false;}
      if(S.page==='notif'){
        const r=await api('GET','notifications');
        if(!r.error){
          const list=Array.isArray(r.data)?r.data:[];S.notifications=list.map(n=>({...n,_justRead:!n.read}));
          if(list.some(n=>!n.read)||S.unread>0){await api('POST','notifications/read-all');}
          S.unread=0;
        }
      }
      else if(S.page==='archive'){loadArchive();}
      else if(S.page==='set'){loadTelegramLink();if(isA())loadIntegrations();}
      else if(['dash','docs','tasks','cal','users','orgs'].includes(S.page)&&Date.now()-lastLoadAt>2000){load({silent:true,renderIfChanged:true});}
    }
    else if(a==='refresh-archive'){await loadArchive();return;}
    else if(a==='link-tg'){
      const r=await api('GET','auth/telegram-link');
      if(!r.error){
        S.tgLink=r;
        if(r.url&&typeof open==='function'){open(r.url,'_blank');}
        const m=$('#tg-link-msg');
        if(m)m.innerHTML=r.url?`Havola ochildi: <a href="${esc(r.url)}" target="_blank" style="color:var(--pri)">${esc(r.url)}</a>`:'Bot ichida <b>/ulash &lt;login&gt; &lt;parol&gt;</b> buyrugʻini yuboring.';
      }
      return;
    }
    else if(a==='open-notif'){const did=+t.dataset.doc;if(did){dirtyForm=false;await openDoc(did);return;}}
    else if(a==='clear-filters'){S.f={q:'',st:'all',org:'all',uid:'all',ty:'all'};kpiSt=false;}
    else if(a==='pick-emp'){S.f.uid=t.dataset.uid||'all';}
    else if(a==='emp-dash'){dirtyForm=false;S.f.uid=String(id);S.page='dash';}
    else if(a==='doc'){dirtyForm=false;await openDoc(id);return}
    else if(a==='day')S.day=t.dataset.d;
    else if(a==='mon')S.month=+t.dataset.m;
    else if(a==='cm'){let m=S.calMonth+ +v,y=S.calYear;if(m<0){m=11;y--}if(m>11){m=0;y++}S.calMonth=m;S.calYear=y;S.day=`${y}-${pad(m+1)}-01`}
    else if(a==='assign'){
      const df=$('#df-files')?.files,note=($('#df-note')?.value||'').trim()||null;
      const uid=+$('#as'+id)?.value;if(!uid){alert('Xodimni tanlang');return;}
      mutSeq+=1;lastDataSig='';
      if(df&&df.length&&S.doc){
        const ok=await uploadSelectedFiles(`documents/${S.doc}/files`,df,note);
        if(!ok)return;
      }
      const r=await api('POST',`tasks/${id}/assignees`,{user_id:uid});
      if(r.error)return;
      dirtyForm=false;sync=true;
    }
    else if(a==='done'){
      const rf=$('#rf'+id)?.files;
      if(v&&rf&&rf.length){
        const note=($('#rn'+id)?.value||'').trim();
        if(!note){alert('Javob fayli uchun qoʻshimcha tavsif yozish shart!');$('#rn'+id)?.focus?.();return;}
        mutSeq+=1;lastDataSig='';
        if(await uploadSelectedFiles(`assignees/${id}/files`,rf,note)){dirtyForm=false;sync=true;}
      }else{
        mutSeq+=1;lastDataSig='';
        let r=await api('PATCH','assignees/'+id,{done_date:v?(S.today||today):null},true,true);
        if(r.error&&v&&/kelajak/i.test(r.error)){
          await load({silent:true,force:true});
          r=await api('PATCH','assignees/'+id,{done_date:S.today||today});
        }else if(r.error){
          alert(r.error);
        }
        if(!r.error)sync=true;
      }
    }
    else if(a==='del-doc'){
      if(typeof confirm!=='function'||confirm('Ushbu hujjat va uning barcha topshiriqlari o\u02bbchirilsinmi?')){
        mutSeq+=1;lastDataSig='';
        const r=await api('DELETE',`documents/${id}`);
        if(!r.error){
          S.docs=S.docs.filter(x=>x.id!==id);
          rebuildTasks();
          if(S.page==='doc'){S.doc=null;S.page='docs';}
          load({silent:true,force:true,renderIfChanged:true});
        }
      }
    }
    else if(a==='del-task'){
      if(typeof confirm!=='function'||confirm('Ushbu topshiriq va barcha biriktirilgan ijrochilar o\u02bbchirilsinmi?')){
        mutSeq+=1;lastDataSig='';
        const r=await api('DELETE',`tasks/${id}`);
        if(!r.error)sync=true;
      }
    }
    else if(a==='del-assignee'){
      if(typeof confirm!=='function'||confirm('Xodimga yuklangan vazifa bekor qilinsinmi?')){
        mutSeq+=1;lastDataSig='';
        const r=await api('DELETE',`assignees/${id}`);
        if(!r.error)sync=true;
      }
    }
    else if(a==='toggle-new-org'){
      const m=$('#global-modal');
      if(m)m.innerHTML=`<div class="modal-wrap"><div class="modal-box"><h3>🏛 Yangi tashkilot qo\u02bbshish</h3><div class="form-gr"><label class="full">Tashkilot nomi<input id="n-org-name" placeholder="Masalan: Boshqarma nomi"></label></div><div class="modal-actions"><button class="btn gh" data-a="close-gmodal">Bekor qilish</button><button class="btn" data-a="create-org">Qo\u02bbshish</button></div></div></div>`;
      return;
    }
    else if(a==='create-org'){
      const name=($('#n-org-name')?.value||'').trim();if(!name){alert('Tashkilot nomini kiriting');return;}
      const r=await api('POST','organizations',{name});
      if(!r.error){
        S.orgs.push(r);
        const m=$('#global-modal');if(m)m.innerHTML='';
        const selEl=$('#n-og');
        if(selEl){selEl.innerHTML=opts(S.orgs.map(o=>[o.id,esc(o.name)]),r.id);selEl.value=String(r.id);}
      }
      return;
    }
    else if(a==='add-org'){
      const name=($('#org-new-inp')?.value||'').trim();if(!name){alert('Tashkilot nomini kiriting');return;}
      const r=await api('POST','organizations',{name});
      if(!r.error){S.orgs.push(r);dirtyForm=false;}
    }
    else if(a==='create'){
      const files=$('#n-files')?.files;
      if(files&&files.length){
        for(const f of files){if(f.size>10*1024*1024){alert(`${f.name}: hajmi 10 MB dan oshmasligi kerak`);return;}}
      }
      const assigneeId=+$('#n-as').value||null;
      const body={number:$('#n-no').value,type:$('#n-ty').value,org_id:+$('#n-og').value,department:($('#n-dept')?.value||'').trim()||null,deadline:$('#n-dl').value,title:$('#n-ti').value,priority:$('#n-pr')?.value||'normal',assignee:(files&&files.length)?null:assigneeId,signers:[]};
      mutSeq+=1;lastDataSig='';
      const r=await api('POST','documents',body);if(r.error)return;
      if(files&&files.length){
        const ok=await uploadSelectedFiles(`documents/${r.id}/files`,files);
        if(!ok){
          alert('Hujjat yaratildi, lekin faylni yuklashda xatolik yuz berdi. Hujjat sahifasidan faylni qayta yuklashingiz mumkin.');
          dirtyForm=false;mutSeq+=1;lastDataSig='';
          await load({force:true});await openDoc(r.id,true);return;
        }
        if(assigneeId&&r.tasks&&r.tasks[0]){
          await api('POST',`tasks/${r.tasks[0].id}/assignees`,{user_id:assigneeId});
        }
      }
      dirtyForm=false;mutSeq+=1;lastDataSig='';
      await load({force:true});await openDoc(r.id,true);return;
    }
    else if(a==='up-doc-file'){
      const files=$('#df-files')?.files,note=($('#df-note')?.value||'').trim()||null;
      if(!files||!files.length){alert('Fayl tanlang');return;}
      mutSeq+=1;lastDataSig='';
      if(await uploadSelectedFiles(`documents/${id}/files`,files,note)){dirtyForm=false;mutSeq+=1;await openDoc(id,true);load({silent:true,force:true});}
      return;
    }
    else if(a==='up-resp'){
      const aid=+t.dataset.aid,files=$('#rf'+aid)?.files,note=($('#rn'+aid)?.value||'').trim();
      if(!files||!files.length){alert('Javob faylini tanlang');return;}
      if(!note){alert('Javob fayli uchun qo\u02bbshimcha tavsif yozish shart!');$('#rn'+aid)?.focus?.();return;}
      mutSeq+=1;lastDataSig='';
      if(await uploadSelectedFiles(`assignees/${aid}/files`,files,note)){dirtyForm=false;mutSeq+=1;await openDoc(S.doc,true);load({silent:true,force:true});}
      return;
    }
    else if(a==='view-file'){await previewFile(id,t.dataset.name||'fayl',t.dataset.mime||'');return;}
    else if(a==='open-tab'){if(previewUrl&&typeof open==='function')open(previewUrl,'_blank');return;}
    else if(a==='dl-file'){await downloadFile(`attachments/${id}/download`,t.dataset.name||'fayl');return;}
    else if(a==='del-file'){if(typeof confirm!=='function'||confirm('Fayl o\u02bbchirilsinmi?')){mutSeq+=1;lastDataSig='';await api('DELETE',`attachments/${id}`);mutSeq+=1;await openDoc(S.doc,true);load({silent:true,force:true});}return;}
    else if(a==='exp-xlsx'||a==='exp-docx'){
      const ext=a==='exp-xlsx'?'xlsx':'docx';
      const qp=[];
      if(S.page==='doc'&&S.doc){
        qp.push('doc_id='+S.doc);
      }else{
        if(S.page!=='docs'){
          if(S.year)qp.push('year='+S.year);
          if(S.month>=0)qp.push('month='+(S.month+1));
        }
        if(S.f.st&&S.f.st!=='all')qp.push('status='+encodeURIComponent(S.f.st));
        if(S.f.org&&S.f.org!=='all')qp.push('org_id='+encodeURIComponent(S.f.org));
        if(S.f.uid&&S.f.uid!=='all')qp.push('user_id='+encodeURIComponent(S.f.uid));
        if(S.f.q)qp.push('q='+encodeURIComponent(S.f.q));
      }
      await downloadFile(`reports/export.${ext}${qp.length?'?'+qp.join('&'):''}`,`hujjat-hisobot.${ext}`);
      return;
    }
    else if(a==='theme'){if(typeof localStorage!=='undefined')localStorage.setItem('ui_theme',v);if(v==='auto')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',v)}
    else if(a==='accent'){if(typeof localStorage!=='undefined')localStorage.setItem('ui_accent',v);document.documentElement.style.setProperty('--pri',v)}
    else if(a==='out'){await logout();return}
    else if(a==='timeline'){const r=await api('GET',`documents/${id}/timeline`);if(!r.error){S.timeline=r;S.page='timeline';}}
    else if(a==='delegate'){showDelegateModal(+t.dataset.aid);return;}
    else if(a==='close-gmodal'){if(previewUrl&&previewUrl.startsWith('blob:')&&typeof URL!=='undefined')URL.revokeObjectURL(previewUrl);previewUrl=null;const m=$('#global-modal');if(m)m.innerHTML='';return;}
    else if(a==='confirm-delegate'){
      const aid=+t.dataset.aid,toId=+($('#dl-user')?.value||0),note=$('#dl-note')?.value||'';
      if(!toId){alert('Xodimni tanlang');return;}
      const r=await api('POST',`assignees/${aid}/delegate`,{user_id:toId,note:note||undefined});
      if(!r.error){const m=$('#global-modal');if(m)m.innerHTML='';alert(r.delegated_to_name+' ga muvaffaqiyatli uzatildi');sync=true;}
    }
    else if(a==='mark-viewed'){await api('POST',`assignees/${+t.dataset.aid}/viewed`,{});sync=true;}
    else if(a==='new-user'){showUserModal(null);return;}
    else if(a==='edit-user'){showUserModal(id);return;}
    else if(a==='save-user'){
      const uid=+t.dataset.id||0;const pwd=$('#u-pwd')?.value;
      const resetReq=!!$('#u-reset')?.checked;
      const tgChat=($('#u-tg')?.value||'').trim();
      const data={name:$('#u-name')?.value,department:($('#u-dept')?.value||'').trim()||null,pos:$('#u-pos')?.value,role:$('#u-role')?.value,org_id:+$('#u-org')?.value,auth_reset_required:resetReq,telegram_chat_id:tgChat||null};
      if(!uid)data.code=$('#u-code')?.value;
      if(pwd)data.password=pwd;
      if(!uid&&!data.password){alert('Parol majburiy');return;}
      const r=uid?await api('PATCH',`users/${uid}`,data):await api('POST','users',data);
      if(!r.error){
        $('#user-modal').innerHTML='';
        if(!uid&&pwd)alert(`Xodim qo\u02bbshildi!\nLogin (ID): ${data.code}\nParol: ${pwd}`);
        sync=true;
      }
    }
    else if(a==='close-modal'){const m=$('#user-modal');if(m)m.innerHTML='';return;}
    else if(a==='toggle-user'){const r=await api('PATCH',`users/${id}`,{active:v==='1'});if(!r.error)sync=true;}
    else if(a==='del-user'){
      if(typeof confirm!=='function'||confirm('Ushbu xodim tizimdan butunlay o\u02bbchirilsinmi?')){
        const r=await api('DELETE',`users/${id}`);
        if(!r.error)sync=true;
      }
    }
    else if(a==='save-sms-prov'||a==='test-sms-prov'){
      const payload=smsFormPayload(a==='test-sms-prov');
      const msgEl=$('#sms-prov-msg');
      if(!payload.api_url){if(msgEl){msgEl.className='err-msg';msgEl.textContent='API manzilini kiriting';}return;}
      const r=await api('POST','integrations/sms_provider',payload);
      if(!r.error){
        dirtyForm=false;
        await loadIntegrations();
        const afterMsg=$('#sms-prov-msg');
        if(afterMsg){
          afterMsg.className=r.status==='error'?'err-msg':'ok-msg';
          afterMsg.textContent=r.message||(r.status==='saved'?'✅ SMS provayderi saqlandi':'✅ Tayyor');
        }
      }
      return;
    }
    else if(a==='del-sms-prov'){
      if(typeof confirm!=='function'||confirm('SMS provayder sozlamalari o\u02bbchirilsinmi?')){
        const r=await api('DELETE','integrations/sms_provider');
        if(!r.error)await loadIntegrations();
      }
      return;
    }
    else if(a==='register-emp'){
      const errEl=$('#reg-err');if(errEl)errEl.textContent='';
      const full_name=($('#reg-name')?.value||'').trim();
      const position=($('#reg-pos')?.value||'').trim();
      const login=($('#reg-login')?.value||'').trim();
      const password=$('#reg-pw')?.value||'';
      const password_confirm=$('#reg-pw2')?.value||'';
      const org_id=+($('#reg-org')?.value||1)||1;
      if(full_name.length<2){if(errEl)errEl.textContent='Ism va familiyani kiriting';return;}
      if(position.length<2){if(errEl)errEl.textContent='Boʻlim va lavozimni kiriting';return;}
      if(!/^[a-zA-Z0-9._-]{2,64}$/.test(login)){if(errEl)errEl.textContent='Login kamida 2 ta belgi (lotin harflari, raqamlar, . _ -) boʻlishi kerak';return;}
      if(password.length<8){if(errEl)errEl.textContent='Parol kamida 8 belgidan iborat boʻlishi kerak';return;}
      if(password!==password_confirm){if(errEl)errEl.textContent='Parol va tasdiqlash paroli mos kelmadi';return;}
      const r=await api('POST','auth/register-employee',{full_name,position,login,password,password_confirm,org_id},true,true);
      if(r.error){if(errEl)errEl.textContent=r.error;return;}
      if(r.access_token){
        saveTokens(r);
        mutSeq+=1;lastDataSig='';renderedAuthReset=null;
        S.page='dash';
        await load({force:true});
        render();
        loadUnread();
      }
      return;
    }
    else if(a==='save-force-pw'){
      const cur=$('#fp-cur')?.value||'',nw=$('#fp-new')?.value||'',con=$('#fp-con')?.value||'';
      if(!cur||nw.length<8){$('#fp-err').textContent='Yangi parol kamida 8 belgi bo\u02bblishi kerak';return;}
      if(nw!==con){$('#fp-err').textContent='Parollar mos kelmadi';return;}
      const r=await api('POST','auth/change-password',{current_password:cur,new_password:nw});
      if(!r.error&&r.access_token){saveTokens(r);S.me.auth_reset_required=false;render();}
      return;
    }
    else if(a==='change-pw'){
      const cur=$('#sp-cur')?.value||'',nw=$('#sp-new')?.value||'',con=$('#sp-con')?.value||'';
      if(!cur||nw.length<8){$('#sp-msg').className='err-msg';$('#sp-msg').textContent='Yangi parol kamida 8 belgi bo\u02bblishi kerak';return;}
      if(nw!==con){$('#sp-msg').className='err-msg';$('#sp-msg').textContent='Parollar mos kelmadi';return;}
      const r=await api('POST','auth/change-password',{current_password:cur,new_password:nw});
      if(!r.error&&r.access_token){saveTokens(r);S.me.auth_reset_required=false;dirtyForm=false;$('#sp-cur').value='';$('#sp-new').value='';$('#sp-con').value='';$('#sp-msg').className='ok-msg';$('#sp-msg').textContent='✅ Parol muvaffaqiyatli yangilandi';}
      return;
    }
    else if(a==='mark-read'){await api('POST',`notifications/${id}/read`);const r=await api('GET','notifications');if(!r.error){S.notifications=r.data;S.unread=r.data.filter(n=>!n.read).length;}}
    else if(a==='read-all'){await api('POST','notifications/read-all');const r=await api('GET','notifications');if(!r.error){S.notifications=r.data;S.unread=0;}}
    if(sync){dirtyForm=false;mutSeq+=1;lastDataSig='';if(S.page==='doc'&&S.doc){await openDoc(S.doc,true);load({silent:true,force:true});}else{await load({force:true});render();}return;}
    render();
  }finally{
    if(isBtn){t.disabled=false;t.classList.remove('is-busy');}
  }
});
document.addEventListener('pointerdown',ev=>{if(ev.target?.id==='q'&&ev.target.removeAttribute)ev.target.removeAttribute('readonly')});
document.addEventListener('focusin',ev=>{if(ev.target?.id==='q'&&ev.target.removeAttribute)ev.target.removeAttribute('readonly')});
document.addEventListener('change',ev=>{const t=ev.target;
 if(t&&t.type==='file'&&t.closest){dirtyForm=true;const lbl=t.closest('.file-pick')?.querySelector?.('.file-name');if(lbl){const fs=t.files;lbl.textContent=!fs||!fs.length?'Tanlanmagan':fs.length===1?`${fs[0].name} (${fmtSize(fs[0].size)})`:`${fs.length} ta fayl tanlandi`;}return;}
 const f=t?.dataset?.f;
 if(!f){if(t&&t.id!=='q'&&/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))dirtyForm=true;return;}
 if(f==='sms-prov'){dirtyForm=true;const u=$('#sms-url');if(u&&(!u.value||Object.values(SMS_PRESETS).includes(u.value)))u.value=SMS_PRESETS[t.value]||'';return;}
 if(f==='fst'){S.f.st=t.value;kpiSt=false;}else if(f==='forg')S.f.org=t.value;else if(f==='fuid')S.f.uid=t.value;else if(f==='fty')S.f.ty=t.value;else if(f==='cyear'){S.calYear=+t.value;S.day=`${S.calYear}-${pad(Math.max(S.calMonth,0)+1)}-01`}else if(f==='cmonth'){S.calMonth=+t.value;S.day=`${S.calYear}-${pad(Math.max(S.calMonth,0)+1)}-01`}else{S[f]=+t.value;}render()});
document.addEventListener('input',ev=>{const t=ev.target;if(t?.id!=='q'){if(t&&!t.dataset?.f&&/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))dirtyForm=true;return;}S.f.q=t.value;const dt=$('#dt');if(!dt)return;if(S.page==='docs')dt.innerHTML=docsTbl();else if(S.page==='tasks')dt.innerHTML=tasksTbl();else if(S.page==='archive')dt.innerHTML=archiveTbl();else if(S.page==='dash')dt.innerHTML=taskTable(filteredTasks({usePeriod:true,useStatus:true}).slice(0,20));});
document.addEventListener('keydown',ev=>{if(ev.target.id==='q'&&ev.key==='Enter'){S.page='docs';render();$('#q')?.focus?.()}});

function loginUI(){$('#app').innerHTML='<div class="lgn pn"><h1>Hujjat aylanish tizimi</h1><p class="mut">Kirish uchun login yoki ID va parolni kiriting</p><input id="lid" placeholder="Login yoki Xodim ID" autocomplete="username"><input id="lpw" type="password" placeholder="Parol" autocomplete="current-password"><button class="btn" id="lb">Kirish</button><p class="mut" id="le"></p></div>';
 const go=async()=>{$('#le').textContent='';let r,d={};try{r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:$('#lid').value.trim(),password:$('#lpw').value})});d=await r.json()}catch(e){$('#le').textContent='Server bilan aloqa yo\u02bbq';return}
  if(r.ok&&d.access_token){saveTokens(d);S.page='dash';if(typeof location!=='undefined'&&'hash'in location)location.hash=d.user?.role==='user'?'#employee':'#admin';location.reload()}else $('#le').textContent=d.error||'Xatolik'};
 $('#lb').onclick=go;$('#lid').onkeydown=$('#lpw').onkeydown=e=>{if(e.key==='Enter')go()}}

(async()=>{
  if(!tok())return loginUI();
  if(!(await load())){
    if(tok())$('#app').innerHTML='<div class="lgn pn"><p class="mut">Serverga ulanib bo\u02bblmadi</p><button class="btn" id="rt">Qayta urinish</button></div>',$('#rt').onclick=()=>location.reload();
    else loginUI();
    return;
  }
  S.page='dash';
  render();
  if(!S.me?.onboarding_required)loadUnread();
  if(typeof setInterval==='function'){
    setInterval(()=>{if(S.me?.onboarding_required)return;loadUnread();if(typeof document.visibilityState==='undefined'||document.visibilityState==='visible')load({silent:true,renderIfChanged:true});},15000);
    setInterval(()=>{const c=$('#clk');if(c)c.textContent='🕒 '+nowClock();},30000);
  }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&tok()&&!S.me?.onboarding_required){loadUnread();load({silent:true,renderIfChanged:true});}});
})();

