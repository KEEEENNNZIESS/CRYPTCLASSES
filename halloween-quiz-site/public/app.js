'use strict';
const $ = s => document.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = {
  quizzes: [], quiz: null, editingId: null, editorQuiz: null, editorQuestions: [],
  participant: null, answers: {}, pending: new Map(), result: null, memory: null,
  importQuestions: null, backup: null, viewId: null, matchDisplay: {}, orderDisplay: {},
  pollTimer: null, adminLiveTimer: null, dashboardFilter: 'all', lastQuestionSignature: '',
};
const TYPE_NAMES = {single:'Pilihan ganda',multi:'Pilihan jamak',truefalse:'Benar / salah',matching:'Mencocokkan',ordering:'Mengurutkan'};
const STATUS_NAMES = {draft:'Draf',open:'Berlangsung',closed:'Selesai',archived:'Arsip'};
const statusLabel = {correct:'BENAR',wrong:'SALAH',blank:'KOSONG',partial:'SEBAGIAN BENAR',unanswered:'BELUM DIJAWAB'};
const participantStatusLabel = {in_progress:'Sedang mengerjakan',completed:'Selesai',locked:'Terkunci'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function toast(message){ const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),3200); }
async function api(url, options={}) {
  const headers = {...(options.headers||{})};
  let body = options.body;
  if(body !== undefined && !(body instanceof FormData) && typeof body !== 'string') { body=JSON.stringify(body); headers['Content-Type']='application/json'; }
  const res = await fetch(url,{credentials:'same-origin',...options,headers,body});
  const type = res.headers.get('content-type')||'';
  const data = type.includes('application/json') ? await res.json().catch(()=>({})) : await res.text();
  if(!res.ok) { const err = new Error(data?.error || (typeof data==='string'?data:'Permintaan gagal.')); err.status=res.status; err.data=data; throw err; }
  return data;
}
function post(url, body){return api(url,{method:'POST',body});}
function show(id){
  // Set a single explicit view flag before visibility changes. CSS uses this
  // state instead of expensive relational :has() selectors for app navigation.
  const app=$('#app');
  if(app) app.dataset.view=id;
  ['home','adminGate','dashboard','quizEditor','quizView','participantQuiz','miniGame','result'].forEach(name=>{
    const section=$('#'+name);
    if(section) section.classList.toggle('hidden',name!==id);
  });
  if(id!=='participantQuiz') stopParticipantPolling();
  if(id!=='quizView' && state.adminLiveTimer){clearInterval(state.adminLiveTimer);state.adminLiveTimer=null;}
  window.scrollTo(0,0);
}
function stopParticipantPolling(){if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null;}}
function tokenKey(code,name){return `cryptclass:token:v2:${String(code||'').toUpperCase()}:${String(name||'').trim().toLowerCase()}`;}
function draftKey(){return state.participant ? `cryptclass:draft:${state.participant.id}:${state.attemptId||'new'}` : '';}
function pendingKey(){return state.participant ? `cryptclass:pending:${state.participant.id}:${state.attemptId||'new'}` : '';}
function safeLocalRead(key, fallback){try{return JSON.parse(localStorage.getItem(key)||'null') ?? fallback;}catch{return fallback;}}
function saveLocalParticipant(){
  if(!state.participant) return;
  try { localStorage.setItem(draftKey(),JSON.stringify(state.answers)); localStorage.setItem(pendingKey(),JSON.stringify(Object.fromEntries(state.pending))); } catch {}
}
function setSaveState(text,kind=''){const el=$('#saveState'); if(el){el.textContent=`● ${text}`;el.className=kind;}}
function nameOfType(type){return TYPE_NAMES[type]||type;}

// Navigation and admin account setup.
$('#adminOpen').addEventListener('click', async ()=>{
  try {
    const me=await api('/api/admin/me');
    if(me.authenticated){await loadDashboard();show('dashboard');}
    else {const setup=await api('/api/setup/status');$('#setupWrap').classList.toggle('hidden',setup.configured);$('#loginWrap').classList.toggle('hidden',!setup.configured);$('#recoveryWrap').classList.add('hidden');show('adminGate');}
  } catch(e){toast(e.message);}
});
$$('[data-home]').forEach(b=>b.addEventListener('click',()=>show('home')));
$$('[data-dashboard]').forEach(b=>b.addEventListener('click',async()=>{await loadDashboard();show('dashboard');}));
$('#setupForm').addEventListener('submit',async e=>{
  e.preventDefault();$('#setupError').textContent='';
  try{const data=await post('/api/setup',{pin:$('#setupPin').value,recoveryCode:$('#setupRecovery').value});$('#setupForm').reset();$('#setupWrap').classList.add('hidden');$('#loginWrap').classList.remove('hidden');toast(data.message||'Admin dibuat.');}
  catch(err){$('#setupError').textContent=err.message;}
});
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('#loginError').textContent='';
  try{await post('/api/admin/login',{pin:$('#adminPin').value});$('#adminPin').value='';await loadDashboard();show('dashboard');toast('Berhasil masuk ke control room.');}
  catch(err){$('#loginError').textContent=err.message;}
});
$('#showRecovery').addEventListener('click',()=>{$('#loginWrap').classList.add('hidden');$('#recoveryWrap').classList.remove('hidden');});
$('#backToLogin').addEventListener('click',()=>{$('#recoveryWrap').classList.add('hidden');$('#loginWrap').classList.remove('hidden');});
$('#recoveryForm').addEventListener('submit',async e=>{
  e.preventDefault();$('#recoveryError').textContent='';
  try{const data=await post('/api/admin/recover',{recoveryCode:$('#recoveryCode').value,newPin:$('#newPin').value});$('#recoveryForm').reset();$('#recoveryWrap').classList.add('hidden');$('#loginWrap').classList.remove('hidden');toast(data.message||'PIN diperbarui.');}
  catch(err){$('#recoveryError').textContent=err.message;}
});
$('#logout').addEventListener('click',async()=>{try{await post('/api/admin/logout',{});}catch{}show('home');toast('Admin logout.');});

// Decorative gothic sidebar navigation; all actions route to existing app views.
$('#sideDashboard')?.addEventListener('click',async()=>{await loadDashboard();show('dashboard');});
$('#sideQuizzes')?.addEventListener('click',async()=>{await loadDashboard();show('dashboard');requestAnimationFrame(()=>$('#quizList')?.scrollIntoView({behavior:'auto',block:'start'}));});
$('#sideCreate')?.addEventListener('click',()=>openEditor(null));
$('#sideResults')?.addEventListener('click',async()=>{try{const target=state.viewId||state.quizzes[0]?.id;if(!target){await loadDashboard();toast('Buat kuis pertama untuk mulai melihat laporan.');return;}await viewQuiz(target);requestAnimationFrame(()=>$('#reportStats')?.scrollIntoView({behavior:'auto',block:'start'}));}catch(e){toast(e.message);}});
$('#sideHome')?.addEventListener('click',()=>show('home'));

// Dashboard and lifecycle actions.
async function loadDashboard(silent=false){
  try {
    const data=await api('/api/admin/dashboard'); state.quizzes=data.quizzes||[];
    $('#globalStats').innerHTML=[['KUIS',data.counts.quizzes],['BERLANGSUNG',data.counts.open],['TOTAL PESERTA',data.counts.participants],['SELESAI',data.counts.completed]].map(([label,value])=>`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
    renderQuizList();
    if(!silent) $('#adminMessage').textContent='';
  }catch(e){if(!silent)toast(e.message);if(e.status===401)show('adminGate');}
}
function renderQuizList(){
  const filter=$('#quizFilter').value;
  const quizzes=state.quizzes.filter(q=>filter==='all'||q.status===filter);
  if(!quizzes.length){$('#quizList').innerHTML='<div class="notice">Belum ada kuis pada kategori ini. Buat kuis baru untuk memulai.</div>';return;}
  $('#quizList').innerHTML=quizzes.map(q=>`<article class="quiz-card"><div class="quiz-card-head"><div><h3>${esc(q.title)}</h3><p>${esc(q.subject)} · ${esc(q.class_name)}</p><p class="code">KODE ${esc(q.code)}</p></div><span class="status-pill status-${esc(q.status)}">${esc(STATUS_NAMES[q.status]||q.status)}</span></div><p>${esc(q.quiz_date)} · ${esc(q.teacher_name)}</p><p>${q.participant_count} peserta · ${q.completed_count} selesai · ${q.in_progress_count} berjalan</p><div class="quiz-card-actions"><button class="button secondary" data-view="${q.id}">BUKA DETAIL</button>${['draft','open'].includes(q.status)?`<button class="button ghost" data-edit="${q.id}">EDIT</button>`:''}</div></article>`).join('');
  $$('[data-view]').forEach(b=>b.onclick=()=>viewQuiz(b.dataset.view));
  $$('[data-edit]').forEach(b=>b.onclick=async()=>{try{const q=await api(`/api/admin/quizzes/${b.dataset.edit}`);openEditor(q);}catch(e){toast(e.message);}});
}
$('#quizFilter').addEventListener('change',renderQuizList);
$('#newQuiz').addEventListener('click',()=>openEditor(null));
$('#backupDownload').addEventListener('click',()=>{window.location.href='/api/admin/backup/download';});
$('#backupRestoreOpen').addEventListener('click',()=>$('#backupFile').click());
$('#backupFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());const preview=await post('/api/admin/backup/preview',{backup:parsed});state.backup=parsed;
    $('#backupPreview').classList.remove('hidden');$('#backupPreview').innerHTML=`<strong>Pratinjau backup siap.</strong><p>Waktu: ${esc(parsed.created_at||'tidak diketahui')}</p><p>${Object.entries(preview.counts).map(([k,v])=>`${esc(k)}: ${v}`).join(' · ')}</p><p>${esc(preview.warning)}</p><button id="restoreBackupNow" class="button primary">KONFIRMASI & PULIHKAN</button> <button id="cancelBackupRestore" class="button ghost">BATAL</button>`;
    $('#restoreBackupNow').onclick=async()=>{if(!confirm('PERINGATAN: semua data kuis, peserta, jawaban, media, dan audit saat ini akan diganti isi backup. Lanjutkan?'))return;try{const r=await post('/api/admin/backup/restore',{backup:state.backup,confirm:true});state.backup=null;$('#backupPreview').classList.add('hidden');$('#backupFile').value='';await loadDashboard();toast(r.message||'Backup dipulihkan.');}catch(err){toast(err.message);}};
    $('#cancelBackupRestore').onclick=()=>{state.backup=null;$('#backupPreview').classList.add('hidden');$('#backupFile').value='';};
  }catch(err){toast(`Backup tidak bisa dibaca: ${err.message}`);$('#backupFile').value='';}
});

// Question editor factories, rendering and stable question IDs.
function newQuestion(type){
  const q={id:null,question_type:type,prompt:'',image_url:'',options:[],answer_key:{}};
  if(type==='single'){q.options=['A','B','C','D','E'].map((_,i)=>({id:`o${i+1}`,text:''}));q.answer_key={correctId:'o1'};}
  else if(type==='multi'){q.options=['A','B','C','D','E'].map((_,i)=>({id:`o${i+1}`,text:''}));q.answer_key={correctIds:['o1']};}
  else if(type==='truefalse'){q.options=[];q.answer_key={correct:true};}
  else if(type==='matching'){q.options={left:[{id:'l1',text:''},{id:'l2',text:''},{id:'l3',text:''}],right:[{id:'r1',text:''},{id:'r2',text:''},{id:'r3',text:''}]};q.answer_key={pairs:{l1:'r1',l2:'r2',l3:'r3'}};}
  else {q.options={items:[{id:'i1',text:''},{id:'i2',text:''},{id:'i3',text:''}]};q.answer_key={order:['i1','i2','i3']};}
  return q;
}
function normalizeEditorQuestion(q,type=q?.question_type||'single'){
  const base={id:q.id||null,question_type:type,prompt:q.prompt||'',image_url:q.image_url||'',options:q.options||[],answer_key:q.answer_key||{}};
  if(type==='single'||type==='multi'){
    base.options=(q.options||[]).map((o,i)=>({id:String(o.id||`o${i+1}`),text:o.text??o.label??''}));
    if(type==='single')base.answer_key={correctId:String(q.answer_key?.correctId??q.answer_key??base.options[0]?.id??'o1')};
    else base.answer_key={correctIds:Array.isArray(q.answer_key?.correctIds)?q.answer_key.correctIds.map(String):Array.isArray(q.answer_key)?q.answer_key.map(String):[base.options[0]?.id||'o1']};
  }else if(type==='truefalse')base.answer_key={correct:typeof q.answer_key==='boolean'?q.answer_key:Boolean(q.answer_key?.correct)};
  else if(type==='matching'){
    const left=q.options?.left||[];const right=q.options?.right||[];const pairs=q.answer_key?.pairs||q.answer_key||{};
    base.options={left:left.map((x,i)=>({id:String(x.id||`l${i+1}`),text:x.text||''})),right:right.map((x,i)=>({id:String(x.id||`r${i+1}`),text:x.text||''}))};base.answer_key={pairs:{...pairs}};
  }else{
    const items=q.options?.items||q.options||[];const order=q.answer_key?.order||q.answer_key||items.map(x=>x.id);
    base.options={items:items.map((x,i)=>({id:String(x.id||`i${i+1}`),text:typeof x==='string'?x:x.text||''}))};base.answer_key={order:Array.isArray(order)?order.map(String):[]};
  }
  return base;
}
function openEditor(quiz){
  state.editorQuiz=quiz?structuredClone(quiz):null;state.editingId=quiz?.id||null;
  $('#quizForm').reset();$('#editorError').textContent='';$('#importPreview').classList.add('hidden');state.importQuestions=null;$('#pasteText').value='';$('#importFile').value='';
  $('#editorTitle').textContent=quiz?'EDIT KUIS':'BUAT KUIS';
  const form=$('#quizForm');
  if(quiz){['title','subject','code','class_name','quiz_date','teacher_name','description'].forEach(k=>form.elements[k].value=quiz[k]??'');$('#questionType').value=quiz.question_type||'single';state.editorQuestions=(quiz.questions||[]).map(q=>normalizeEditorQuestion(q,q.question_type||quiz.question_type||'single'));}
  else{form.elements.quiz_date.value=today();$('#questionType').value='single';state.editorQuestions=[];}
  renderQuestionEditor();show('quizEditor');
}
function fieldVal(card,selector){return card.querySelector(selector)?.value??'';}
function collectEditorQuestions(){
  return $$('.q-card').map(card=>{
    const type=card.dataset.type;
    const q={id:card.dataset.id||null,question_type:type,prompt:fieldVal(card,'[data-qfield="prompt"]'),image_url:fieldVal(card,'[data-qfield="image_url"]'),options:[],answer_key:{}};
    if(type==='single'||type==='multi'){
      q.options=$$('[data-option-text]',card).map(el=>({id:el.dataset.optionId,text:el.value}));
      if(type==='single')q.answer_key={correctId:card.querySelector('[data-key-radio]:checked')?.value||''};
      else q.answer_key={correctIds:$$('[data-key-check]:checked',card).map(el=>el.value)};
    }else if(type==='truefalse')q.answer_key={correct:card.querySelector('[data-tf-key]:checked')?.value==='true'};
    else if(type==='matching'){
      const left=$$('[data-left-item]',card).map(el=>({id:el.dataset.leftItem,text:el.value}));
      const right=$$('[data-right-item]',card).map(el=>({id:el.dataset.rightItem,text:el.value}));
      const pairs={};$$('[data-match-key]',card).forEach(sel=>{if(sel.value)pairs[sel.dataset.leftId]=sel.value;});q.options={left,right};q.answer_key={pairs};
    }else{
      const items=$$('[data-order-item]',card).map(el=>({id:el.dataset.orderItem,text:el.value}));
      const ranked=$$('[data-order-rank]',card).map(sel=>({id:sel.dataset.itemId,rank:Number(sel.value)})).sort((a,b)=>a.rank-b.rank);q.options={items};q.answer_key={order:ranked.map(x=>x.id)};
    }
    return q;
  });
}
function optionGrid(q,index,type){
  const letters=['A','B','C','D','E'];
  const options=q.options||[];
  const rows=letters.map((letter,i)=>{const o=options[i]||{id:`o${i+1}`,text:''};const checked=type==='single'?q.answer_key?.correctId===o.id:(q.answer_key?.correctIds||[]).includes(o.id);return `<div class="option-edit"><span>${letter}</span><input type="text" data-option-text data-option-id="${esc(o.id)}" maxlength="1000" aria-label="Teks opsi ${letter}" value="${esc(o.text)}" placeholder="Opsi ${letter}"><label title="Tandai sebagai kunci" style="display:flex;align-items:center;gap:5px;font-size:.75rem"><input type="${type==='single'?'radio':'checkbox'}" ${type==='single'?'data-key-radio':'data-key-check'} name="key-${index}" value="${esc(o.id)}" ${checked?'checked':''}> Kunci</label></div>`;}).join('');
  return `<div class="option-grid">${rows}</div><div class="key-choice"><strong>${type==='single'?'PILIH SATU KUNCI':'PILIH SEMUA KUNCI'}</strong><span class="muted small">${type==='multi'?'Poin parsial untuk setiap opsi benar yang dipilih; tidak ada penalti opsi salah.':'Jawaban kosong atau salah mendapat 0 poin.'}</span></div>`;
}
function renderQuestionEditor(){
  const nominalPoints=state.editorQuestions.length?100/state.editorQuestions.length:0;
  $('#questionEditor').innerHTML=state.editorQuestions.map((raw,i)=>{
    const type=raw.question_type||'single';const q=normalizeEditorQuestion(raw,type);let body='';
    if(type==='single'||type==='multi')body=optionGrid(q,i,type);
    else if(type==='truefalse')body=`<div class="key-choice"><strong>KUNCI JAWABAN</strong><label><input type="radio" name="tf-${i}" data-tf-key value="true" ${q.answer_key.correct===true?'checked':''}> Benar</label><label><input type="radio" name="tf-${i}" data-tf-key value="false" ${q.answer_key.correct===false?'checked':''}> Salah</label></div>`;
    else if(type==='matching'){
      const L=q.options.left;const R=q.options.right;
      body=`<div class="pair-grid"><div class="pair-col"><h4>ITEM KIRI (PERTANYAAN)</h4>${L.map((item,j)=>`<div class="pair-row"><span>${j+1}</span><input data-left-item data-left-item-id="${esc(item.id)}" value="${esc(item.text)}" placeholder="Item kiri ${j+1}"></div>`).join('')}</div><div class="pair-col"><h4>ITEM KANAN (PASANGAN)</h4>${R.map((item,j)=>`<div class="pair-row"><span>${j+1}</span><input data-right-item data-right-item-id="${esc(item.id)}" value="${esc(item.text)}" placeholder="Item kanan ${j+1}"></div>`).join('')}</div></div><div class="pair-key"><strong>Pasangan yang benar</strong>${L.map((l,j)=>`<label>${esc(l.text||`Kiri ${j+1}`)}<select data-match-key data-left-id="${esc(l.id)}"><option value="">Pilih pasangan…</option>${R.map(r=>`<option value="${esc(r.id)}" ${(q.answer_key.pairs||{})[l.id]===r.id?'selected':''}>${esc(r.text||`Kanan ${R.indexOf(r)+1}`)}</option>`).join('')}</select></label>`).join('')}</div><p class="muted small">Setiap item kanan hanya boleh dipasangkan sekali. Saat kuis, urutan item kanan diacak.</p>`;
    }else{
      const items=q.options.items;const currentOrder=q.answer_key.order||[];
      body=`<div class="order-key-grid">${items.map((item,j)=>`<label><input data-order-item data-order-item-id="${esc(item.id)}" value="${esc(item.text)}" placeholder="Elemen ${j+1}"><span class="muted">Posisi benar</span><select data-order-rank data-item-id="${esc(item.id)}">${items.map((_,rank)=>`<option value="${rank+1}" ${currentOrder[rank]===item.id?'selected':''}>${rank+1}</option>`).join('')}</select></label>`).join('')}</div><p class="muted small">Tentukan posisi benar untuk setiap elemen.</p>`;
    }
    return `<article class="q-card" draggable="true" data-id="${q.id||''}" data-qindex="${i}" data-type="${type}"><div class="q-card-head"><strong>SOAL ${String(i+1).padStart(2,'0')} <span class="muted">· ${esc(nameOfType(type))} · Bobot ${nominalPoints.toLocaleString('id-ID',{maximumFractionDigits:2})} poin</span></strong><div class="q-tools"><button type="button" class="button ghost" data-move-up="${i}" aria-label="Pindah soal ke atas">↑</button><button type="button" class="button ghost" data-move-down="${i}" aria-label="Pindah soal ke bawah">↓</button><button type="button" class="button ghost" data-remove-q="${i}" aria-label="Hapus soal">HAPUS</button></div></div><label>Teks pertanyaan<textarea data-qfield="prompt" maxlength="3000" rows="2" placeholder="Tulis pertanyaan di sini…">${esc(q.prompt)}</textarea></label><div class="q-image-row"><label>URL gambar (HTTPS)<input data-qfield="image_url" value="${esc(q.image_url||'')}" placeholder="https://… atau unggah di samping"></label><label>Unggah gambar<input type="file" data-upload-image accept="image/jpeg,image/png,image/webp,image/gif"><small>Maks. 5 MB; tersimpan di database.</small></label></div>${body}</article>`;
  }).join('');
  $$('.q-card').forEach(card=>{
    const type=card.dataset.type;const q=normalizeEditorQuestion(state.editorQuestions[Number(card.dataset.qindex)],type);
    $$('[data-match-key]',card).forEach(el=>{el.dataset.leftId=el.getAttribute('data-left-id');});
    $$('[data-upload-image]',card).forEach(input=>input.addEventListener('change',async()=>{
      const file=input.files?.[0];if(!file)return;const fd=new FormData();fd.append('image',file);
      try{const result=await api('/api/admin/media',{method:'POST',body:fd});syncEditorState();const current=state.editorQuestions[Number(card.dataset.qindex)];if(current){current.image_url=result.url;renderQuestionEditor();toast('Gambar berhasil diunggah.');}}
      catch(err){toast(err.message);input.value='';}
    }));
    card.addEventListener('dragstart',e=>{card.classList.add('dragging');e.dataTransfer.setData('text/plain',card.dataset.qindex);e.dataTransfer.effectAllowed='move';});
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
    card.addEventListener('dragover',e=>e.preventDefault());
    card.addEventListener('drop',e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));const to=Number(card.dataset.qindex);if(!Number.isInteger(from)||!Number.isInteger(to)||from===to)return;syncEditorState();const [picked]=state.editorQuestions.splice(from,1);state.editorQuestions.splice(to,0,picked);renderQuestionEditor();});
  });
}
function syncEditorState(){
  try{state.editorQuestions=collectEditorQuestions().map(q=>normalizeEditorQuestion(q,q.question_type));}catch(e){/* Incomplete fields remain editable; server performs final validation. */}
}
$('#addQuestion').addEventListener('click',()=>{
  syncEditorState();if(state.editorQuestions.length>=300){toast('Maksimal 300 soal per kuis.');return;}
  $('#newQuestionType').value='single';$('#questionTypeDialog').showModal();
});
$('#confirmAddQuestion').addEventListener('click',e=>{
  e.preventDefault();const type=$('#newQuestionType').value;const dialog=$('#questionTypeDialog');dialog.close();
  if(state.editorQuestions.length>=300){toast('Maksimal 300 soal per kuis.');return;}
  state.editorQuestions.push(newQuestion(type));renderQuestionEditor();
  setTimeout(()=>{const cards=$$('.q-card');cards[cards.length-1]?.scrollIntoView({behavior:'smooth',block:'start'});},50);
});
$('#questionTypeDialog').addEventListener('click',e=>{if(e.target===$('#questionTypeDialog'))$('#questionTypeDialog').close();});
$('#questionEditor').addEventListener('click',e=>{
  const remove=e.target.closest('[data-remove-q]');const up=e.target.closest('[data-move-up]');const down=e.target.closest('[data-move-down]');
  if(!remove&&!up&&!down)return;syncEditorState();let index=Number(remove?.dataset.removeQ??up?.dataset.moveUp??down?.dataset.moveDown);
  if(remove){if(state.editorQuestions.length===1&&!confirm('Hapus satu-satunya soal? Kuis tidak dapat dibuka tanpa soal.'))return;state.editorQuestions.splice(index,1);}
  else{const target=index+(up?-1:1);if(target<0||target>=state.editorQuestions.length)return;const [q]=state.editorQuestions.splice(index,1);state.editorQuestions.splice(target,0,q);}
  renderQuestionEditor();
});
$('#quizForm').addEventListener('submit',async e=>{
  e.preventDefault();$('#editorError').textContent='';syncEditorState();
  const form=new FormData(e.currentTarget);const body=Object.fromEntries(form.entries());body.code=String(body.code||'').trim().toUpperCase();body.question_type=$('#questionType').value;
  try{
    if(!state.editingId){const created=await post('/api/admin/quizzes',body);state.editingId=created.id;state.editorQuiz=created;$('#editorTitle').textContent='EDIT KUIS';toast('Metadata kuis disimpan sebagai draf.');}
    else await api(`/api/admin/quizzes/${state.editingId}`,{method:'PUT',body});
    const questions=collectEditorQuestions().map(q=>({...q,question_type:q.question_type}));
    await api(`/api/admin/quizzes/${state.editingId}/questions`,{method:'PUT',body:{questions}});
    await loadDashboard();await viewQuiz(state.editingId);toast('Kuis dan soal berhasil disimpan.');
  }catch(err){$('#editorError').textContent=err.message;}
});

// Import preview: no database writes occur until the admin adds the valid preview into the editor and saves it.
async function showImportResult(result){
  state.importQuestions=result.canImport?result.questions:null;
  const errors=result.errors||[];const rows=result.preview||[];
  $('#importPreview').classList.remove('hidden');
  $('#importPreview').innerHTML=`<strong>Pratinjau impor: ${Number(result.total||rows.length)} baris</strong><p>${result.canImport?`Semua soal lolos validasi (${result.questions.length} soal).`:'Impor belum bisa diterapkan. Perbaiki baris yang salah di file/teks lalu pratinjau ulang.'}</p>${errors.length?`<div class="preview-errors"><strong>Daftar kesalahan:</strong><ul>${errors.map(e=>`<li>Baris ${e.row}: ${esc(e.message)}</li>`).join('')}</ul></div>`:''}<div class="table-wrap"><table class="preview-table"><thead><tr><th>Baris</th><th>Pratinjau soal</th></tr></thead><tbody>${rows.slice(0,50).map(r=>`<tr><td>${r.row}</td><td>${esc(r.prompt||'(teks soal kosong)')}</td></tr>`).join('')}</tbody></table></div>${result.total>50?`<p class="muted">Pratinjau menampilkan 50 dari ${result.total} baris.</p>`:''}${result.canImport?'<button class="button primary" id="applyImport">TAMBAHKAN SOAL KE EDITOR</button>':''}`;
  if(result.canImport)$('#applyImport').onclick=()=>{syncEditorState();state.editorQuestions.push(...state.importQuestions.map(q=>normalizeEditorQuestion({...q,question_type:$('#importQuestionType').value},$('#importQuestionType').value)));renderQuestionEditor();$('#importPreview').classList.add('hidden');$('#pasteText').value='';$('#importFile').value='';state.importQuestions=null;toast('Soal ditambahkan ke editor. Tekan Simpan Kuis & Soal untuk menyimpan.');};
}
$('#previewPaste').addEventListener('click',async()=>{
  $('#importPreview').classList.remove('hidden');$('#importPreview').textContent='Memeriksa teks…';
  try{const result=await post(`/api/admin/quizzes/${state.editingId||'new'}/import-preview`,{text:$('#pasteText').value,questionType:$('#importQuestionType').value});await showImportResult(result);}
  catch(e){$('#importPreview').innerHTML=`<p class="preview-errors">${esc(e.message)}</p>`;}
});
$('#previewFile').addEventListener('click',async()=>{
  const file=$('#importFile').files?.[0];if(!file){toast('Pilih file CSV atau Excel terlebih dahulu.');return;}if(!state.editingId){toast('Simpan metadata kuis terlebih dahulu, lalu lakukan impor.');return;}
  $('#importPreview').classList.remove('hidden');$('#importPreview').textContent='Memeriksa file…';const fd=new FormData();fd.append('file',file);
  try{const result=await api(`/api/admin/quizzes/${state.editingId}/import-preview`,{method:'POST',body:fd});await showImportResult(result);}
  catch(e){$('#importPreview').innerHTML=`<p class="preview-errors">${esc(e.message)}</p>`;}
});
$('#downloadTemplate').addEventListener('click',()=>{
  if(!state.editingId){toast('Simpan kuis terlebih dahulu untuk mengunduh template yang sesuai.');return;}window.location.href=`/api/admin/quizzes/${state.editingId}/template.csv`;
});

// Quiz detail, reporting, status changes and exports.
function renderAdminMatchingPreviews(){
  $$('.admin-matching-preview').forEach(board=>{
    const svg=board.querySelector('.admin-matching-lines');const rect=board.getBoundingClientRect();if(!svg||!rect.width||!rect.height)return;svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);svg.innerHTML='';const ns='http://www.w3.org/2000/svg';
    const section=board.closest('.admin-answer-detail');const rows=[...(section?.querySelectorAll('.admin-pair-row')||[])];
    rows.forEach(row=>{const spans=row.querySelectorAll(':scope > span');if(spans.length<4)return;const leftText=spans[0].textContent.trim();const rightText=spans[2].textContent.trim();if(!rightText||rightText==='Belum dihubungkan')return;const l=[...board.querySelectorAll('[data-admin-left]')].find(el=>el.textContent.trim()===leftText);const r=[...board.querySelectorAll('[data-admin-right]')].find(el=>el.textContent.trim()===rightText);if(!l||!r)return;const a=l.getBoundingClientRect(),b=r.getBoundingClientRect();const x1=a.right-rect.left,y1=a.top+a.height/2-rect.top,x2=b.left-rect.left,y2=b.top+b.height/2-rect.top;const dx=x2-x1,dy=y2-y1,bend=Math.max(18,Math.min(65,Math.abs(dx)*.18));const path=document.createElementNS(ns,'path');path.setAttribute('d',`M ${x1} ${y1} C ${x1+bend} ${y1+dy*.12}, ${x2-bend} ${y2-dy*.12}, ${x2} ${y2}`);path.setAttribute('class','admin-matching-connection');svg.appendChild(path);});
  });
}

async function viewQuiz(id, silent=false){
  try{
    const [quiz,report]=await Promise.all([api(`/api/admin/quizzes/${id}`),api(`/api/admin/quizzes/${id}/report`)]);
    state.quiz=quiz;state.viewId=String(id);
    $('#viewTitle').textContent=quiz.title;
    $('#quizDetails').innerHTML=`<div class="detail-meta"><div class="stat"><strong>${esc(quiz.code)}</strong><span>KODE</span></div><div class="stat"><strong>${esc(STATUS_NAMES[quiz.status]||quiz.status)}</strong><span>STATUS</span></div><div class="stat"><strong>${quiz.questions.length}</strong><span>JUMLAH SOAL</span></div><div class="stat"><strong>Campuran</strong><span>TIPE SOAL</span></div></div><p class="muted">${esc(quiz.subject)} · ${esc(quiz.class_name)} · ${esc(quiz.teacher_name)} · ${esc(quiz.quiz_date)}</p><p>${esc(quiz.description)}</p>`;
    const actions=[];
    if(['draft','open'].includes(quiz.status))actions.push(`<button class="button secondary" id="viewEdit">EDIT KUIS / SOAL</button>`);
    if(quiz.status==='draft')actions.push('<button class="button primary" id="viewOpen">BUKA KUIS ↗</button>');
    if(quiz.status==='open')actions.push('<button class="button primary" id="viewClose">TUTUP KUIS</button>');
    if(quiz.status==='closed')actions.push('<button class="button secondary" id="viewArchive">ARSIPKAN</button>');
    if(['draft','closed','archived'].includes(quiz.status))actions.push('<button class="button ghost" id="viewDuplicate">DUPLIKAT KUIS</button>');
    if(quiz.status!=='open')actions.push('<button class="button ghost" id="viewDelete">HAPUS KUIS</button>');
    actions.push('<button class="button ghost" id="viewExportCsv">EKSPOR CSV</button>');
    $('#quizActions').innerHTML=actions.join('');
    $('#questionPreview').innerHTML=quiz.questions.length?quiz.questions.map((q,i)=>`<article class="question-preview"><h4>${String(i+1).padStart(2,'0')}. <span class="muted">${esc(nameOfType(q.question_type||quiz.question_type))} · Bobot ${(100/quiz.questions.length).toLocaleString('id-ID',{maximumFractionDigits:2})} poin ·</span> ${esc(q.prompt)}</h4>${q.image_url?`<p><a href="${esc(q.image_url)}" target="_blank" rel="noopener">Lihat gambar soal</a></p>`:''}<p class="answer-key"><strong>Kunci:</strong> ${esc(formatKey(q.question_type||quiz.question_type,q.answer_key,q.options))}</p></article>`).join(''):'<div class="notice">Belum ada soal. Tambahkan soal agar kuis bisa dibuka.</div>';
    renderReport(report);
    $('#viewEdit')?.addEventListener('click',()=>openEditor(quiz));
    $('#viewOpen')?.addEventListener('click',async()=>{if(!confirm('Buka kuis sekarang? Peserta bisa masuk menggunakan kode dan nama.'))return;try{await post(`/api/admin/quizzes/${id}/status`,{status:'open'});await loadDashboard();await viewQuiz(id);toast('Kuis dibuka.');}catch(e){toast(e.message);}});
    $('#viewClose')?.addEventListener('click',async()=>{if(!confirm('Tutup kuis sekarang? Semua percobaan yang belum selesai akan dikunci dan dinilai dari jawaban yang sudah diterima server.'))return;try{await post(`/api/admin/quizzes/${id}/status`,{status:'closed'});await loadDashboard();await viewQuiz(id);toast('Kuis ditutup dan hasil disimpan.');}catch(e){if(e.status===409&&e.data?.needsConfirmation){const names=(e.data.staleParticipants||[]).slice(0,12).join(', ');if(confirm(`${e.message}\n${names}${e.data.staleParticipants?.length>12?' …':''}\n\nTetap tutup kuis? Jawaban offline yang belum sampai server tidak dijamin masuk.`)){try{await post(`/api/admin/quizzes/${id}/status`,{status:'closed',confirmStale:true});await loadDashboard();await viewQuiz(id);toast('Kuis ditutup dengan peringatan koneksi.');}catch(ee){toast(ee.message);}}}else toast(e.message);}});
    $('#viewArchive')?.addEventListener('click',async()=>{if(!confirm('Arsipkan kuis ini? Kuis akan pindah ke daftar arsip.'))return;try{await post(`/api/admin/quizzes/${id}/status`,{status:'archived'});await loadDashboard();await viewQuiz(id);toast('Kuis diarsipkan.');}catch(e){toast(e.message);}});
    $('#viewDuplicate')?.addEventListener('click',async()=>{const generated=uniqueSuggestedCode(quiz.code);const code=prompt('Tentukan kode unik untuk kuis salinan:',generated);if(code===null)return;try{const newQuiz=await post(`/api/admin/quizzes/${id}/duplicate`,{code:code.trim().toUpperCase()});await loadDashboard();await viewQuiz(newQuiz.id);toast('Kuis disalin tanpa hasil peserta.');}catch(e){toast(e.message);}});
    $('#viewDelete')?.addEventListener('click',async()=>{if(!confirm(`HAPUS PERMANEN “${quiz.title}”? Kuis, soal, peserta, jawaban, nilai, dan laporan terkait akan dihapus. Tindakan tidak dapat dibatalkan.`))return;try{await api(`/api/admin/quizzes/${id}`,{method:'DELETE',body:{confirm:true}});await loadDashboard();show('dashboard');toast('Kuis dan data terkait dihapus.');}catch(e){toast(e.message);}});
    $('#viewExportCsv')?.addEventListener('click',()=>{window.location.href=`/api/admin/quizzes/${id}/export?format=csv&report=all`;});
    if(!silent)show('quizView');
    if(state.adminLiveTimer){clearInterval(state.adminLiveTimer);state.adminLiveTimer=null;}
    if(quiz.status==='open')state.adminLiveTimer=setInterval(()=>{if(!$('#quizView')?.classList.contains('hidden')&&String(state.viewId)===String(id)&&!$('#report details[open]')&&!['participantSearch','participantStatusFilter'].includes(document.activeElement?.id))viewQuiz(id,true);},15000);
  }catch(e){if(!silent)toast(e.message);if(e.status===401)show('adminGate');}
}
function formatKey(type,key,options){
  if(type==='single')return options?.find(o=>o.id===key.correctId)?.text||key.correctId||'—';
  if(type==='multi')return (key.correctIds||[]).map(id=>options?.find(o=>o.id===id)?.text||id).join(', ')||'—';
  if(type==='truefalse')return key.correct?'Benar':'Salah';
  if(type==='matching')return Object.entries(key.pairs||{}).map(([l,r])=>`${options.left?.find(x=>x.id===l)?.text||l} → ${options.right?.find(x=>x.id===r)?.text||r}`).join('; ');
  if(type==='ordering')return (key.order||[]).map((id,i)=>`${i+1}. ${options.items?.find(x=>x.id===id)?.text||id}`).join(' → ');
  return '—';
}
function renderReport(report){
  const s=report.stats;
  $('#reportStats').innerHTML=[['GABUNG',s.joined],['SEDANG MENGERJAKAN',s.in_progress],['SELESAI',s.completed],['TERKUNCI',s.locked],['NILAI TERTINGGI',s.highest??'—'],['NILAI TERENDAH',s.lowest??'—'],['RATA-RATA',s.average??'—'],['SUDAH DINILAI',s.graded]].map(([label,value])=>`<div class="stat"><strong>${esc(value)}</strong><span>${label}</span></div>`).join('');
  $('#questionAnalysis').innerHTML=report.questionAnalysis.length?`<div class="toolbar"><h3>ANALISIS KESALAHAN SOAL</h3></div><div class="analysis-list">${report.questionAnalysis.map(q=>`<div class="analysis-row"><div class="analysis-title"><strong>${String(q.position).padStart(2,'0')}. ${esc(q.prompt)}</strong><small>Sample: ${q.sample_size} jawaban dinilai</small></div><div><strong>${q.wrong_count} (${q.wrong_pct}%)</strong><small>Salah</small></div><div><strong>${q.blank_count} (${q.blank_pct}%)</strong><small>Kosong</small></div><div class="hide-mid"><strong>${q.partial_count}</strong><small>Parsial</small></div><div class="hide-mobile"><strong>${q.sample_size}</strong><small>Sample</small></div></div>`).join('')}</div>`:'<p class="muted">Belum ada analisis soal.</p>';
  $('#leaderboard').innerHTML=report.leaderboard.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Posisi</th><th>Nama peserta</th><th>Nilai</th><th>Status</th></tr></thead><tbody>${report.leaderboard.map(p=>`<tr><td>${p.rank}</td><td>${esc(p.name)}</td><td><strong>${Number(p.score).toFixed(2)}</strong></td><td>${esc(participantStatusLabel[p.status]||p.status)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Leaderboard akan muncul setelah ada nilai.</p>';
  const questionMap=new Map(report.questions.map(q=>[String(q.id),q]));
  $('#report').innerHTML=report.participants.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Peserta</th><th>Status</th><th>Nilai</th><th>Percobaan</th><th>Aksi / riwayat</th></tr></thead><tbody>${report.participants.map(p=>{
    const detail=(p.history||[]).map(h=>`<div class="history-details"><strong>Percobaan ${h.attempt_number}</strong> · ${esc(h.state)} · Nilai ${h.score===null?'—':Number(h.score).toFixed(2)}${h.active?' · AKTIF':''}${(report.questions||[]).map(q=>{const ans=h.answers?.[String(q.id)];const st=(h.question_results||[]).find(x=>Number(x.questionId)===Number(q.id));const head=`<div class="admin-answer-head"><strong>${String(q.position).padStart(2,'0')}. ${esc(q.prompt)}<small class="admin-question-type">${esc(nameOfType(q.question_type))}</small></strong><span class="status-${esc(st?.status||'unanswered')}">${esc(statusLabel[st?.status]||'BELUM DINILAI')}</span><small>${Number(st?.points||0).toFixed(2)} / ${Number(st?.maxPoints??1).toFixed(2)} poin</small></div>`;if(q.question_type!=='matching')return `<section class="admin-answer-detail">${head}<p><strong>Jawaban siswa:</strong> ${esc(answerLabel(q,ans))}</p>${q.question_type==='single'||q.question_type==='multi'||q.question_type==='truefalse'||q.question_type==='ordering'?`<p><strong>Kunci:</strong> ${esc(formatKey(q.question_type,q.answer_key,q.options))}</p>`:''}</section>`;const given=ans&&typeof ans==='object'?ans:{};const key=q.answer_key?.pairs||{};const left=q.options.left||[];const right=q.options.right||[];const rows=left.map((l,i)=>{const picked=given[l.id];const correct=key[l.id];const status=!picked?'unanswered':String(picked)===String(correct)?'correct':'wrong';return `<div class="admin-pair-row"><span>${esc(l.text)}</span><span class="pair-arrow">→</span><span>${esc(right.find(r=>String(r.id)===String(picked))?.text||'Belum dihubungkan')}</span><span class="status-${status}">${status==='correct'?'BENAR':status==='wrong'?'SALAH':'KOSONG'}</span><small>Kunci: ${esc(right.find(r=>String(r.id)===String(correct))?.text||correct)}</small></div>`;}).join('');const studentPairs=left.map(l=>`<div class="admin-match-left" data-admin-left="${esc(l.id)}">${esc(l.text)}</div>`).join('');const rightChoices=right.map(r=>`<div class="admin-match-right" data-admin-right="${esc(r.id)}">${esc(r.text)}</div>`).join('');const visual=`<div class="admin-matching-preview" data-admin-matching-preview><svg class="admin-matching-lines" aria-hidden="true"></svg><div class="admin-matching-columns"><div class="admin-matching-col"><h5>ITEM KIRI</h5>${studentPairs}</div><div class="admin-matching-col"><h5>PASANGAN KANAN</h5>${rightChoices}</div></div></div>`;return `<section class="admin-answer-detail">${head}<p><strong>Preview garis pasangan siswa</strong></p>${visual}<p><strong>Kunci jawaban per pasangan</strong></p><div class="admin-pair-list">${rows}</div><p><strong>Skor parsial:</strong> ${Number(st?.points||0).toFixed(2)} / 1.00 poin</p></section>`;}).join('')}</div>`).join('');
    return `<tr data-participant-row data-name="${esc(String(p.display_name).toLocaleLowerCase())}" data-status="${esc(p.status)}"><td><strong>${esc(p.display_name)}</strong><br><small>Bergabung ${esc(new Date(p.joined_at).toLocaleString('id-ID'))}</small></td><td>${esc(participantStatusLabel[p.status]||p.status)}<br><small>${p.last_seen_at?`Aktif ${esc(new Date(p.last_seen_at).toLocaleString('id-ID'))}`:''}</small></td><td>${p.score===null?'—':Number(p.score).toFixed(2)}</td><td>${p.history?.length||0}</td><td><details><summary>Lihat jawaban/riwayat</summary>${detail}<div class="button-row"><button class="button ghost" data-reset-participant="${p.id}" ${report.quiz.status!=='open'?'disabled':''}>RESET PERCOBAAN</button><button class="button ghost" data-delete-participant="${p.id}">HAPUS DATA</button></div></details></td></tr>`;
  }).join('')}</tbody></table></div>`:'<p class="muted">Belum ada peserta.</p>';
  renderAdminMatchingPreviews();
  $$('#report details').forEach(detail=>detail.addEventListener('toggle',()=>{if(detail.open)requestAnimationFrame(renderAdminMatchingPreviews);}));
  $$('[data-reset-participant]').forEach(b=>b.onclick=async()=>{const p=report.participants.find(x=>String(x.id)===b.dataset.resetParticipant);if(!p||!confirm(`Reset percobaan ${p.display_name}? Riwayat lama tetap disimpan untuk audit.`))return;try{await post(`/api/admin/participants/${p.id}/reset`,{confirm:true});await viewQuiz(report.quiz.id,true);toast('Percobaan baru dibuat.');}catch(e){toast(e.message);}});
  $$('[data-delete-participant]').forEach(b=>b.onclick=async()=>{const p=report.participants.find(x=>String(x.id)===b.dataset.deleteParticipant);if(!p||!confirm(`Hapus seluruh data dan riwayat ${p.display_name}? Tidak akan disimpan catatan tindakan penghapusan.`))return;try{await api(`/api/admin/participants/${p.id}`,{method:'DELETE',body:{confirm:true}});await viewQuiz(report.quiz.id,true);toast('Data peserta dihapus.');}catch(e){toast(e.message);}});
  const applyParticipantFilters=()=>{const term=($('#participantSearch')?.value||'').trim().toLocaleLowerCase();const status=$('#participantStatusFilter')?.value||'all';let shown=0;$$('[data-participant-row]').forEach(row=>{const visible=(!term||row.dataset.name.includes(term))&&(status==='all'||row.dataset.status===status);row.classList.toggle('hidden',!visible);if(visible)shown++;});const total=$$('[data-participant-row]').length;const count=$('#participantFilterCount');if(count)count.textContent=`Menampilkan ${shown} dari ${total} peserta`;};
  $('#participantSearch')?.addEventListener('input',applyParticipantFilters);$('#participantStatusFilter')?.addEventListener('change',applyParticipantFilters);applyParticipantFilters();
  $('#refreshReport')?.addEventListener('click',async()=>{const button=$('#refreshReport');if(button)button.disabled=true;try{await viewQuiz(report.quiz.id,true);toast('Data peserta diperbarui.');}finally{if($('#refreshReport'))$('#refreshReport').disabled=false;}});
  const live=$('#liveReportStatus');if(live){live.textContent=report.quiz.status==='open'?'Kuis aktif · laporan diperbarui otomatis setiap 15 detik.':'Kuis tidak aktif · gunakan Segarkan untuk memuat data terbaru.';}
}
function answerLabel(question,answer){
  if(answer===undefined||answer===null||answer===''||(Array.isArray(answer)&&!answer.length)||(typeof answer==='object'&&!Array.isArray(answer)&&!Object.keys(answer).length))return '—';
  if(question.question_type==='single'||question.question_type==='multi'){const a=Array.isArray(answer)?answer:[answer];return a.map(id=>question.options.find(o=>String(o.id)===String(id))?.text||id).join(' / ');}
  if(question.question_type==='truefalse')return answer===true?'Benar':'Salah';
  if(question.question_type==='matching')return Object.entries(answer).map(([l,r])=>`${question.options.left.find(x=>x.id===l)?.text||l} → ${question.options.right.find(x=>x.id===r)?.text||r}`).join('; ');
  if(question.question_type==='ordering')return answer.map((id,i)=>`${i+1}. ${question.options.items.find(x=>x.id===id)?.text||id}`).join(' → ');
  return JSON.stringify(answer);
}
$('#exportReport').addEventListener('click',()=>{if(!state.viewId)return;window.location.href=`/api/admin/quizzes/${state.viewId}/export?format=${encodeURIComponent($('#exportFormat').value)}&report=${encodeURIComponent($('#exportType').value)}`;});
function uniqueSuggestedCode(base){let proposal=(String(base||'QUIZ').toUpperCase().replace(/[^A-Z0-9]/g,'')+'2').slice(0,12);if(proposal.length<4)proposal=(proposal+'XXXX').slice(0,4);return proposal;}

// Participant join, autosave, network recovery, quiz polling and grading result.
$('#joinForm').addEventListener('submit',async e=>{
  e.preventDefault();$('#joinError').textContent='';
  const code=$('#joinCode').value.trim().toUpperCase();const name=$('#joinName').value.trim().replace(/\s+/g,' ');const key=tokenKey(code,name);const resumeToken=sessionStorage.getItem(key)||'';
  try{
    const data=await post('/api/join',{code,name,resumeToken});
    sessionStorage.setItem(key,data.participant.token);
    state.quiz=data.quiz;state.participant={...data.participant,code};state.attemptId=data.attemptId;state.answers={...(data.answers||{})};state.result=data.result||null;state.matchDisplay={};state.orderDisplay={};
    const pending=safeLocalRead(pendingKey(),{});state.pending=new Map(Object.entries(pending));
    Object.entries(pending).forEach(([id,answer])=>{state.answers[id]=answer;});
    const localDraft=safeLocalRead(draftKey(),{});
    // Use a local draft only for keys queued for sync; server remains the canonical source for acknowledged answers.
    state.questions=data.questions||[];state.lastQuestionSignature=questionSignature(state.questions,state.quiz);
    $('#joinError').textContent='';
    if(data.status==='completed'||data.status==='locked'){
      if(state.result){startMemory();return;}
      $('#joinError').textContent='Percobaan telah terkunci tetapi hasil belum tersedia. Hubungi admin.';return;
    }
    if(!state.questions.length){$('#joinError').textContent='Kuis belum memiliki soal. Hubungi admin.';return;}
    renderParticipant();show('participantQuiz');startParticipantPolling();if(state.pending.size)flushSaves();
  }catch(err){$('#joinError').textContent=err.message;}
});
function questionSignature(questions,quiz=null){return JSON.stringify({revision:quiz?.updated_at||'',questions:(questions||[]).map(q=>({id:q.id,position:q.position,prompt:q.prompt,image_url:q.image_url,question_type:q.question_type,options:q.options}))});}
function shuffle(arr) {
  if (!Array.isArray(arr)) {
    console.error('Data untuk shuffle bukan array:', arr);
    return [];
  }

  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function displayQuestion(q){const type=q.question_type||state.quiz.question_type;const id=String(q.id);let html='';const answer=state.answers[id];
  if(type==='single'||type==='multi'){
    html=`<div class="answer-options">${q.options.map((o,i)=>{const checked=type==='multi'?(Array.isArray(answer)&&answer.map(String).includes(String(o.id))):String(answer??'')===String(o.id);return `<label class="answer-option"><input type="${type==='multi'?'checkbox':'radio'}" data-answer-option="${esc(o.id)}" name="ans-${id}" ${checked?'checked':''}><span><strong>${String.fromCharCode(65+i)}.</strong> ${esc(o.text)}</span></label>`;}).join('')}</div>`;
  }else if(type==='truefalse'){
    html=`<div class="answer-options">${[{label:'Benar',value:true},{label:'Salah',value:false}].map(o=>`<label class="answer-option"><input type="radio" name="ans-${id}" data-tf-value="${o.value}" ${answer===o.value?'checked':''}><span>${o.label}</span></label>`).join('')}</div>`;
  }else if(type==='matching'){
    const choices=state.matchDisplay[id]||(state.matchDisplay[id]=shuffle(q.options.right));
    html=`<div class="matching-board" data-matching-board="${id}"><svg class="matching-lines" aria-hidden="true"></svg><div class="matching-line-columns"><div class="matching-line-col"><h4>COCOKKAN DARI KIRI</h4>${q.options.left.map((item,i)=>`<button type="button" class="matching-node matching-left" data-match-left="${esc(item.id)}"><span class="match-node-dot"></span><span>${esc(item.text)}</span></button>`).join('')}</div><div class="matching-line-col"><h4>PASANGAN DI KANAN</h4>${choices.map(item=>`<button type="button" class="matching-node matching-right" data-match-right="${esc(item.id)}"><span class="match-node-dot"></span><span>${esc(item.text)}</span></button>`).join('')}</div></div><p class="muted small matching-hint">Pilih satu item di kiri, lalu pilih pasangannya di kanan. Ketuk pasangan yang sudah dibuat untuk menggantinya.</p></div>`;
  }else{
    let list=Array.isArray(answer)&&answer.length?answer.map(id=>q.options.items.find(x=>x.id===id)).filter(Boolean):null;
    if(!list){if(!state.orderDisplay[id])state.orderDisplay[id]=shuffle(q.options.items);list=state.orderDisplay[id];}
    html=`<div class="ordering-options">${list.map((item,index)=>`<div class="ordering-item" data-order-row="${esc(item.id)}"><span>${esc(item.text)}</span><button type="button" class="button ghost" data-order-move="up" data-item="${esc(item.id)}" aria-label="Naik" ${index===0?'disabled':''}>↑</button><button type="button" class="button ghost" data-order-move="down" data-item="${esc(item.id)}" aria-label="Turun" ${index===list.length-1?'disabled':''}>↓</button></div>`).join('')}</div><p class="muted small">Gunakan tombol naik/turun untuk mengatur urutan. Urutan belum dijawab jika belum diubah.</p>`;
  }
  return `<article class="participant-question" data-question="${id}"><div class="participant-question-heading"><h3><span class="number">${String(q.position).padStart(2,'0')}.</span>${esc(q.prompt)}</h3><span class="question-type-label">${esc(nameOfType(type))} · Bobot ${(state.questions.length?100/state.questions.length:0).toLocaleString('id-ID',{maximumFractionDigits:2})} poin</span></div>${q.image_url?`<img class="question-img" src="${esc(q.image_url)}" alt="Gambar soal" loading="lazy">`:''}${html}</article>`;
}
function renderParticipant(){
  $('#participantSubject').textContent=`${state.quiz.subject} · ${state.quiz.class_name}`;$('#participantTitle').textContent=state.quiz.title;$('#participantInstructions').textContent=state.quiz.description;
  $('#participantQuestions').innerHTML=state.questions.map(displayQuestion).join('');
  $$('.matching-board').forEach(renderMatchingLines);
  $('#participantError').textContent='';updateProgress();
  if(state.pending.size)setSaveState(navigator.onLine?'MENUNGGU SINKRONISASI':'TERSIMPAN DI PERANGKAT','save-pending');else setSaveState('TERSIMPAN DI SERVER','save-ok');
}
function renderMatchingLines(board){
  if(!board)return;const svg=board.querySelector('.matching-lines');const rect=board.getBoundingClientRect();if(!rect.width||!rect.height)return;svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);svg.innerHTML='';
  const qid=board.dataset.matchingBoard;const answer=state.answers[qid]||{};const ns='http://www.w3.org/2000/svg';
  // Draw delicate white cobweb connectors from the right edge of each left card
  // to the left edge of its paired right card (not from the decorative dots).
  Object.entries(answer).forEach(([leftId,rightId])=>{
    const l=board.querySelector(`[data-match-left="${CSS.escape(leftId)}"]`);const r=board.querySelector(`[data-match-right="${CSS.escape(String(rightId))}"]`);if(!l||!r)return;
    const a=l.getBoundingClientRect(),b=r.getBoundingClientRect();const x1=a.right-rect.left,y1=a.top+a.height/2-rect.top,x2=b.left-rect.left,y2=b.top+b.height/2-rect.top;
    const dx=x2-x1,dy=y2-y1;const bend=Math.max(22,Math.min(75,Math.abs(dx)*.18));const curve=(offset=0)=>`M ${x1} ${y1+offset} C ${x1+bend} ${y1+offset+dy*.12}, ${x2-bend} ${y2+offset-dy*.12}, ${x2} ${y2+offset}`;
    const strand=(d,cls='matching-web-strand')=>{const path=document.createElementNS(ns,'path');path.setAttribute('d',d);path.setAttribute('class',cls);svg.appendChild(path);};
    strand(curve(0),'matching-connection');
    // Parallel curved silk threads and fine cross-strands create a cobweb motif.
    [-11,-7,7,11].forEach(offset=>strand(curve(offset)));
    const offsets=[-11,-7,0,7,11];
    for(let t=.16;t<.9;t+=.16){
      const cx=x1+dx*t,cy=y1+dy*t;const half=Math.sin(Math.PI*t)*10+2;
      const web=document.createElementNS(ns,'path');web.setAttribute('d',`M ${cx-2} ${cy-half} Q ${cx+3} ${cy} ${cx-2} ${cy+half}`);web.setAttribute('class','matching-web-cross');svg.appendChild(web);
      const rib=document.createElementNS(ns,'path');rib.setAttribute('d',`M ${cx-2} ${cy-half} Q ${cx+2} ${cy-half*.35} ${cx+3} ${cy} Q ${cx+2} ${cy+half*.35} ${cx-2} ${cy+half}`);rib.setAttribute('class','matching-web-cross');svg.appendChild(rib);
    }
  });
  board.querySelectorAll('[data-match-left]').forEach(el=>el.classList.toggle('selected',el.dataset.matchLeft===state.matchSelectedLeft));
  board.querySelectorAll('[data-match-left],[data-match-right]').forEach(el=>el.classList.remove('connected'));Object.entries(answer).forEach(([l,r])=>{board.querySelector(`[data-match-left="${CSS.escape(l)}"]`)?.classList.add('connected');board.querySelector(`[data-match-right="${CSS.escape(String(r))}"]`)?.classList.add('connected');});
}
function updateProgress(){const answered=state.questions.filter(q=>{const v=state.answers[String(q.id)];return !(v===undefined||v===null||v===''||(Array.isArray(v)&&v.length===0)||(typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length));}).length;$('#progressBar').style.width=`${state.questions.length?answered/state.questions.length*100:0}%`;$('#progressText').textContent=`${answered} / ${state.questions.length}`;}
function queueAnswer(questionId,value){state.answers[String(questionId)]=value;state.pending.set(String(questionId),value);saveLocalParticipant();updateProgress();setSaveState(navigator.onLine?'MENYIMPAN':'TERSIMPAN DI PERANGKAT','save-pending');clearTimeout(queueAnswer.timer);queueAnswer.timer=setTimeout(flushSaves,180);}
$('#participantQuestions').addEventListener('change',e=>{
  const card=e.target.closest('[data-question]');if(!card)return;const id=card.dataset.question;const type=state.questions.find(q=>String(q.id)===String(id))?.question_type||state.quiz.question_type;
  if(type==='single'){const option=e.target.closest('[data-answer-option]');if(option)queueAnswer(id,option.dataset.answerOption);}
  else if(type==='multi'){const selected=$$('[data-answer-option]:checked',card).map(el=>el.dataset.answerOption);queueAnswer(id,selected);}
  else if(type==='truefalse'){const val=e.target.closest('[data-tf-value]');if(val)queueAnswer(id,val.dataset.tfValue==='true');}
  else if(type==='matching'){/* Connections are made by tapping endpoints. */}
});
$('#participantQuestions').addEventListener('click',e=>{
  const endpoint=e.target.closest('[data-match-left],[data-match-right]');
  if(endpoint){const board=endpoint.closest('[data-matching-board]');const id=board.dataset.matchingBoard;const current={...(state.answers[id]||{})};if(endpoint.dataset.matchLeft){state.matchSelectedLeft=endpoint.dataset.matchLeft;renderMatchingLines(board);return;}if(endpoint.dataset.matchRight&&state.matchSelectedLeft){const leftId=state.matchSelectedLeft;const rightId=endpoint.dataset.matchRight;Object.keys(current).forEach(k=>{if(current[k]===rightId||k===leftId)delete current[k];});current[leftId]=rightId;state.matchSelectedLeft=null;queueAnswer(id,current);renderMatchingLines(board);return;}if(endpoint.dataset.matchRight){const linked=Object.entries(current).find(([,r])=>r===endpoint.dataset.matchRight);if(linked){delete current[linked[0]];queueAnswer(id,current);renderMatchingLines(board);}return;}}
  const b=e.target.closest('[data-order-move]');if(!b)return;const card=b.closest('[data-question]');const id=card.dataset.question;const q=state.questions.find(x=>String(x.id)===id);let list=Array.isArray(state.answers[id])&&state.answers[id].length?state.answers[id].map(item=>q.options.items.find(x=>x.id===item)).filter(Boolean):[...(state.orderDisplay[id]||shuffle(q.options.items))];state.orderDisplay[id]=list;
  const idx=list.findIndex(x=>x.id===b.dataset.item);const target=idx+(b.dataset.orderMove==='up'?-1:1);if(idx<0||target<0||target>=list.length)return;const [item]=list.splice(idx,1);list.splice(target,0,item);queueAnswer(id,list.map(x=>x.id));const signature=questionSignature(state.questions,state.quiz);renderParticipant();state.lastQuestionSignature=signature;
});
window.addEventListener('resize',()=>{$$('.matching-board').forEach(renderMatchingLines);renderAdminMatchingPreviews();});
async function flushSaves(){
  if(!state.participant||!state.pending.size)return;
  if(!navigator.onLine){setSaveState('TERSIMPAN DI PERANGKAT','save-pending');return;}
  for(const [questionId,answer] of [...state.pending.entries()]){
    try{
      await post('/api/answer',{participantId:state.participant.id,token:state.participant.token,questionId:Number(questionId),answer});
      // Do not remove a newer edit that was queued while this request was in flight.
      if(state.pending.has(questionId) && JSON.stringify(state.pending.get(questionId))===JSON.stringify(answer)) state.pending.delete(questionId);
      saveLocalParticipant();
    }catch(e){
      if(e.status===423){setSaveState('KUIS TERKUNCI','save-pending');$('#participantError').textContent=e.message;return;}
      if(e.status===401){setSaveState('SESI TIDAK VALID','save-pending');$('#participantError').textContent=e.message;return;}
      setSaveState(navigator.onLine?'BELUM TERSINKRON':'TERSIMPAN DI PERANGKAT','save-pending');return;
    }
  }
  if(state.pending.size){setSaveState('MENUNGGU SINKRONISASI','save-pending');clearTimeout(flushSaves.timer);flushSaves.timer=setTimeout(flushSaves,120);}
  else setSaveState('TERSIMPAN DI SERVER','save-ok');
}
window.addEventListener('online',flushSaves);
window.addEventListener('offline',()=>{if(state.participant&&$('#participantQuiz')&&!$('#participantQuiz').classList.contains('hidden'))setSaveState('TERSIMPAN DI PERANGKAT','save-pending');});
function startParticipantPolling(){
  stopParticipantPolling();state.pollTimer=setInterval(async()=>{
    if(!state.participant||$('#participantQuiz').classList.contains('hidden'))return;
    try{
      const d=await post('/api/participant/state',{participantId:state.participant.id,token:state.participant.token});
      let attemptChanged=false;
      if(d.attemptId!==state.attemptId){
        state.attemptId=d.attemptId;state.pending=new Map();state.answers={...(d.answers||{})};state.matchDisplay={};state.orderDisplay={};saveLocalParticipant();attemptChanged=true;
        setSaveState('PERCOBAAN DIRESET','save-pending');
      }
      const sig=questionSignature(d.questions||[],d.quiz);
      if(sig!==state.lastQuestionSignature || attemptChanged){
        state.quiz=d.quiz;state.questions=d.questions||[];state.lastQuestionSignature=sig;
        const validIds=new Set(state.questions.map(q=>String(q.id)));
        for(const key of [...state.pending.keys()])if(!validIds.has(String(key)))state.pending.delete(key);
        state.answers={...(d.answers||{}),...Object.fromEntries(state.pending)};state.matchDisplay={};state.orderDisplay={};saveLocalParticipant();renderParticipant();
        if(!attemptChanged)toast('Admin memperbarui kuis. Perubahan sudah diterapkan.');
      }
      if(d.result&&(d.status==='completed'||d.status==='locked')){state.result={score:d.result.score,statuses:d.result.statuses};startMemory();return;}
    }catch(e){if(e.status===423){toast('Kuis sudah ditutup.');}/* Temporary network failures are handled by autosave. */}
  },12000);
}
$('#submitQuiz').addEventListener('click',async()=>{
  if(!confirm('Kirim semua jawaban sekarang? Jawaban akan dikunci setelah diterima server. Pertanyaan kosong tetap boleh dikirim.'))return;
  await flushSaves();if(state.pending.size){$('#participantError').textContent='Masih ada jawaban yang belum diterima server. Periksa koneksi dan coba lagi.';return;}
  try{const result=await post('/api/submit',{participantId:state.participant.id,token:state.participant.token});state.result={score:result.score,statuses:result.statuses};startMemory();}
  catch(e){$('#participantError').textContent=e.message;}
});
function startMemory(){
  stopParticipantPolling();show('miniGame');
  const symbols=['🎃','🦇','👻','🕷️','🕸️','🧙','🎃','🦇','👻','🕷️','🕸️','🧙'];
  // Four pairs keeps the mandatory ritual short without affecting the academic score.
  const compact=['🎃','🦇','👻','🕷️','🎃','🦇','👻','🕷️'];const shuffled=shuffle(compact);
  state.memory={symbols:shuffled,flipped:[],matched:new Set(),started:performance.now(),blocked:false};
  $('#memoryGrid').innerHTML=shuffled.map((_,i)=>`<button type="button" class="memory-card" data-card="${i}" aria-label="Kartu tertutup">✦</button>`).join('');$('#memoryStatus').textContent='Cocokkan semua pasangan simbol.';$('#showResult').classList.add('hidden');
  $$('[data-card]').forEach(b=>b.onclick=()=>flipCard(Number(b.dataset.card)));
}
function flipCard(index){
  const game=state.memory;if(!game||game.blocked||game.matched.has(index)||game.flipped.includes(index))return;
  const button=$(`[data-card="${index}"]`);button.textContent=game.symbols[index];button.classList.add('flipped');button.setAttribute('aria-label',`Kartu ${game.symbols[index]}`);game.flipped.push(index);
  if(game.flipped.length!==2)return;
  const [a,b]=game.flipped;
  if(game.symbols[a]===game.symbols[b]){
    game.matched.add(a);game.matched.add(b);game.flipped=[];[a,b].forEach(i=>$(`[data-card="${i}"]`)?.classList.add('matched'));
    if(game.matched.size===game.symbols.length){const seconds=((performance.now()-game.started)/1000).toFixed(1);$('#memoryStatus').textContent=`Ritual selesai dalam ${seconds} detik. Gelar kosmetik: Penjaga Crypt. Nilai akademik tidak berubah.`;$('#showResult').classList.remove('hidden');}
  }else{
    game.blocked=true;setTimeout(()=>{[a,b].forEach(i=>{const el=$(`[data-card="${i}"]`);if(el){el.textContent='✦';el.classList.remove('flipped');el.setAttribute('aria-label','Kartu tertutup');}});game.flipped=[];game.blocked=false;},650);
  }
}
$('#showResult').addEventListener('click',async()=>{
  if(state.participant){
    try{const latest=await post('/api/participant/state',{participantId:state.participant.id,token:state.participant.token});if(latest.result){state.result={score:latest.result.score,statuses:latest.result.statuses};state.quiz=latest.quiz;state.questions=latest.questions||state.questions;}}
    catch{/* Use the last server-confirmed result if the network is unavailable. */}
  }
  show('result');const result=state.result||{score:0,statuses:[]};$('#resultSub').textContent=state.quiz?`${state.quiz.title} · ${state.participant?.name||''}`:'';$('#finalScore').textContent=`${Number(result.score||0).toFixed(2)} / 100`;
  const statuses=new Map((result.statuses||[]).map(s=>[Number(s.questionId),s]));
  $('#resultStatuses').innerHTML=(state.questions||[]).map((q,i)=>{
    const r=statuses.get(Number(q.id));const status=r?.status||'unanswered';const type=q.question_type||state.quiz?.question_type||'single';
    let details='';
    // Detail button belongs only to questions with a genuinely partial result.
    if(status==='partial'&&type==='matching'){
      const pairMap=new Map((r?.pairResults||[]).map(x=>[String(x.leftId),x.status]));
      details=`<details class="student-feedback-details"><summary>Lihat Selengkapnya</summary><p class="muted small">Bagian yang salah atau belum diisi ditandai. Kunci jawaban tidak ditampilkan.</p><div class="student-feedback-pairs">${(q.options.left||[]).map(l=>{const st=pairMap.get(String(l.id))||'unanswered';const picked=state.answers[String(q.id)]?.[l.id];const right=(q.options.right||[]).find(x=>String(x.id)===String(picked));return `<div class="student-feedback-pair status-${esc(st)}"><span>${esc(l.text)}</span><span>→</span><span>${esc(right?.text||'Belum dihubungkan')}</span><strong>${st==='correct'?'Benar':st==='wrong'?'Salah':'Belum diisi'}</strong></div>`;}).join('')}</div></details>`;
    }else if(status==='partial'&&type==='ordering'){
      const itemStatus=new Map((r?.itemResults||[]).map(x=>[Number(x.index),x.status]));const submitted=Array.isArray(state.answers[String(q.id)])?state.answers[String(q.id)]:[];const items=submitted.map(id=>q.options.items.find(x=>String(x.id)===String(id))).filter(Boolean);
      details=`<details class="student-feedback-details"><summary>Lihat Selengkapnya</summary><p class="muted small">Urutan yang salah atau belum terisi ditandai. Kunci urutan tidak ditampilkan.</p><div class="student-feedback-pairs">${items.map((item,index)=>{const st=itemStatus.get(index)||'wrong';return `<div class="student-feedback-pair status-${esc(st)}"><span>${index+1}. ${esc(item.text)}</span><span>·</span><span>${st==='correct'?'Posisi sesuai':'Posisi tidak sesuai'}</span><strong>${st==='correct'?'Benar':'Periksa'}</strong></div>`;}).join('')}${items.length<q.options.items.length?'<p class="muted small">Ada item yang belum masuk ke urutan jawaban.</p>':''}</div></details>`;
    }else if(status==='partial'&&type==='multi'){
      const selected=new Set(Array.isArray(state.answers[String(q.id)])?state.answers[String(q.id)].map(String):[]);const itemStatus=new Map((r?.itemResults||[]).map(x=>[String(x.optionId),x.status]));
      details=`<details class="student-feedback-details"><summary>Lihat Selengkapnya</summary><p class="muted small">Pilihan yang keliru ditandai. Pilihan yang tidak dipilih tidak mengungkap kunci jawaban.</p><div class="student-feedback-pairs">${q.options.map((o,index)=>{const chosen=selected.has(String(o.id));const st=chosen?(itemStatus.get(String(o.id))||'wrong'):'unanswered';return `<div class="student-feedback-pair status-${esc(st)}"><span>${String.fromCharCode(65+index)}. ${esc(o.text)}</span><span>·</span><span>${chosen?'Dipilih':'Tidak dipilih'}</span><strong>${chosen?(st==='correct'?'Pilihan tepat':'Pilihan keliru'):'Belum dipilih'}</strong></div>`;}).join('')}${r?.missingSelections?'<p class="muted small">Ada jawaban yang seharusnya dipilih tetapi belum dipilih.</p>':''}</div></details>`;
    }
    return `<div class="result-row result-row-wrap"><div class="result-question-label"><strong>Soal ${String(q.position||i+1).padStart(2,'0')}</strong><span class="question-type-label">${esc(nameOfType(type))}</span><span class="result-question-prompt">${esc(q.prompt)}</span></div><strong class="status-${esc(status)}">${esc(statusLabel[status]||'BELUM DINILAI')}</strong>${details}</div>`;
  }).join('');
});

// Periodic dashboard/report refreshes keep in-progress metrics current.
setInterval(()=>{
  if(!$('#dashboard').classList.contains('hidden'))loadDashboard(true);
  else if(!$('#quizView').classList.contains('hidden')&&state.viewId)viewQuiz(state.viewId,true);
},15000);

// Keep participant view safe on reload; stored session token is the resume credential, never the display name alone.
window.addEventListener('beforeunload',e=>{if(state.pending.size){e.preventDefault();e.returnValue='Ada jawaban yang belum dikirim ke server.';}});
