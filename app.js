/* app.js
   Versão com fluxo por telas, voz, consentimento por voz, IndexedDB, notificações e alarmes.
   Tema: azul-claro, linguagem empática.
*/

/* ====== Service Worker registro (mantido) ====== */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(e => console.warn('SW reg failed', e));
}

/* ====== IndexedDB básico (mantido / simples) ====== */
const DB_NAME = 'LembretesDB';
const STORE_NAME = 'meds';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = e => reject(e);
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onupgradeneeded = e => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}
function saveMedIDB(med){ return openDB().then(conn=> new Promise((res,rej)=> {
  const tx = conn.transaction([STORE_NAME],'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const r = store.put(med);
  r.onsuccess = ()=>res();
  r.onerror = e=>rej(e);
})); }
function loadMedsIDB(){ return openDB().then(conn=> new Promise((res,rej)=> {
  const tx = conn.transaction([STORE_NAME],'readonly');
  const store = tx.objectStore(STORE_NAME);
  const r = store.getAll();
  r.onsuccess = e=>res(e.target.result);
  r.onerror = e=>rej(e);
})); }
function deleteMedIDB(id){ return openDB().then(conn=> new Promise((res,rej)=> {
  const tx = conn.transaction([STORE_NAME],'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const r = store.delete(id);
  r.onsuccess = ()=>res();
  r.onerror = e=>rej(e);
})); }

/* ====== Estado da aplicação ====== */
const STORAGE_KEY_USER = 'cb_username';
let meds = [];                 // lista em memória
let lastImage = null;
let lastTriggered = {};        // para evitar triggers duplicados
let activeAlarmLoop = null;
let activeReminderLoop = null;
let currentActiveMed = null;

/* ====== Helpers DOM ====== */
const $ = sel => document.querySelector(sel);
const $all = sel => Array.from(document.querySelectorAll(sel));
function showView(name){
  $all('.view').forEach(v => v.style.display = (v.dataset.view === name ? '' : 'none'));
}

/* ====== Speech Recognition (voz para inputs) ====== */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
function startVoiceForInput(inputEl, onResult){
  if (!SpeechRecognition) { alert('Reconhecimento de voz não disponível. Use Chrome/Edge no Android para melhor experiência.'); return; }
  const r = new SpeechRecognition();
  r.lang = 'pt-BR';
  r.continuous = false;
  r.interimResults = false;
  r.onresult = ev => {
    const t = ev.results[0][0].transcript;
    inputEl.value = t;
    if (onResult) onResult(t);
  };
  r.onerror = ev => console.warn('Speech error', ev);
  r.start();
}

/* ====== Elementos principais ====== */
const usernameInput = $('#username');
const voiceUsernameBtn = $('#voiceUsername');
const welcomeNext = $('#welcomeNext');
const clearAllBtn = $('#clearAll');

const playConsent = $('#playConsent');
const acceptConsent = $('#acceptConsent');
const consentTextEl = $('#consentText');
const consentBack = $('#consentBack');

const voiceNameBtn = $('#voiceName');
const voiceQuantityBtn = $('#voiceQuantity');

const nameInput = $('#name');
const quantityInput = $('#quantity');
const startInput = $('#startTime');
const intervalInput = $('#intervalTime');

const remind5 = $('#remind5');
const remind3 = $('#remind3');
const remind1 = $('#remind1');

const photoInput = $('#photo');
const imgPreview = $('#imgPreview');

const formNameNext = $('#formNameNext');
const formNameBack = $('#formNameBack');
const formQtyNext = $('#formQtyNext');
const formQtyBack = $('#formQtyBack');
const formTimeNext = $('#formTimeNext');
const formTimeBack = $('#formTimeBack');
const formRemindNext = $('#formRemindNext');
const formRemindBack = $('#formRemindBack');
const formPhotoNext = $('#formPhotoNext');
const formPhotoBack = $('#formPhotoBack');

const reviewName = $('#reviewName');
const reviewQty = $('#reviewQty');
const reviewStart = $('#reviewStart');
const reviewInterval = $('#reviewInterval');
const reviewRemind = $('#reviewRemind');
const reviewPhotoBlock = $('#reviewPhotoBlock');
const saveBtn = $('#saveBtn');
const reviewBack = $('#reviewBack');

const medList = $('#medList');
const addNew = $('#addNew');
const testNow = $('#testNow');

const overlay = $('#overlay');
const overlayText = $('#overlayText');
const overlayImg = $('#overlayImg');
const takenBtn = $('#takenBtn');
const postpone30Btn = $('#postpone30');
const postpone60Btn = $('#postpone60');

const reminderOverlay = $('#reminderOverlay');
const reminderText = $('#reminderText');
const reminderImg = $('#reminderImg');
const reminderOkBtn = $('#reminderOkBtn');

/* ====== Fluxo: boas-vindas e nome ====== */
voiceUsernameBtn?.addEventListener('click', ()=> startVoiceForInput(usernameInput));
welcomeNext?.addEventListener('click', ()=> {
  const name = usernameInput.value.trim();
  if (!name) { alert('Por favor, diga ou digite como prefere ser chamado.'); return; }
  localStorage.setItem(STORAGE_KEY_USER, name);
  showView('consent');
});

/* Limpar dados (apaga DB e localStorage) */
clearAllBtn?.addEventListener('click', async ()=> {
  if (!confirm('Isso apagará todos os lembretes e seu nome. Continuar?')) return;
  try {
    const conn = await openDB();
    const tx = conn.transaction([STORE_NAME],'readwrite');
    tx.objectStore(STORE_NAME).clear();
    meds = [];
    lastTriggered = {};
    localStorage.removeItem(STORAGE_KEY_USER);
    usernameInput.value = '';
    showView('welcome');
    renderList();
    alert('Dados apagados.');
  } catch(e){ console.error(e); alert('Erro ao limpar dados.'); }
});

/* ====== Texto de consentimento (empático) ====== */
const CONSENT_TEXT = `Olá! Obrigado por confiar no CuidaBem.
Para que eu possa te ajudar a lembrar da medicação, preciso usar suas informações de maneira segura:
• As notificações, alarmes e o histórico de tomadas ficam apenas no seu dispositivo.
• Não compartilhamos seus dados com terceiros.
• Você pode excluir tudo a qualquer momento pela opção "Limpar dados".
Ao aceitar, você autoriza o uso local dessas informações para o funcionamento do app.`;

consentTextEl.innerText = CONSENT_TEXT;

/* Tocar o consentimento em voz */
playConsent?.addEventListener('click', ()=> speak(CONSENT_TEXT));

/* Botão aceitar */
acceptConsent?.addEventListener('click', ()=> {
  showView('form-name');
});

/* Ouvir aceitação por voz (se a tela de consent estiver ativa) */
function listenForConsentAcceptance(){
  if (!SpeechRecognition) return;
  const r = new SpeechRecognition();
  r.lang = 'pt-BR';
  r.interimResults = false;
  r.onresult = ev => {
    const t = ev.results[0][0].transcript.toLowerCase();
    if (t.includes('sim') || t.includes('aceito') || t.includes('autorizo')) {
      acceptConsent.click();
    }
  };
  r.onerror = e => console.log('consent listen err', e);
  r.start();
}

/* Observador para ativar escuta quando a view consent aparecer */
const viewObserver = new MutationObserver(() => {
  const active = document.querySelector('.view[style=""]')?.dataset?.view;
  if (active === 'consent') listenForConsentAcceptance();
});
viewObserver.observe(document.body, { childList:true, subtree:true, attributes:true });

/* ====== Forms: navegação e voz ====== */
formNameNext?.addEventListener('click', ()=> {
  if (!nameInput.value.trim()) { alert('Digite ou fale o nome do remédio.'); return; }
  showView('form-qty');
});
formNameBack?.addEventListener('click', ()=> showView('list'));

formQtyNext?.addEventListener('click', ()=> {
  if (!quantityInput.value.trim()) { alert('Digite ou fale a dose.'); return; }
  showView('form-time');
});
formQtyBack?.addEventListener('click', ()=> showView('form-name'));

formTimeNext?.addEventListener('click', ()=> {
  if (!startInput.value) { alert('Escolha data e hora de início.'); return; }
  showView('form-remind');
});
formTimeBack?.addEventListener('click', ()=> showView('form-qty'));

formRemindNext?.addEventListener('click', ()=> showView('form-photo'));
formRemindBack?.addEventListener('click', ()=> showView('form-time'));

formPhotoNext?.addEventListener('click', ()=> {
  populateReview();
  showView('review');
});
formPhotoBack?.addEventListener('click', ()=> showView('form-remind'));

voiceNameBtn?.addEventListener('click', ()=> startVoiceForInput(nameInput));
voiceQuantityBtn?.addEventListener('click', ()=> startVoiceForInput(quantityInput));

/* Foto */
photoInput?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) { lastImage = null; imgPreview.innerHTML = '<span class="small">Sem foto</span>'; return; }
  const reader = new FileReader();
  reader.onload = ev => {
    lastImage = ev.target.result;
    imgPreview.innerHTML = `<img src="${lastImage}" alt="foto" />`;
  };
  reader.readAsDataURL(file);
});

/* Preenchimento da revisão */
function populateReview(){
  reviewName.innerText = nameInput.value || '-';
  reviewQty.innerText = quantityInput.value || '-';
  const dt = new Date(startInput.value);
  reviewStart.innerText = dt.toLocaleString('pt-BR');
  reviewInterval.innerText = intervalInput.value || '00:00';
  const arr = [];
  if (remind5.checked) arr.push('5 min');
  if (remind3.checked) arr.push('3 min');
  if (remind1.checked) arr.push('1 min');
  reviewRemind.innerText = arr.length ? arr.join(', ') : 'Nenhum';
  reviewPhotoBlock.innerHTML = lastImage ? `<img src="${lastImage}" style="width:120px;border-radius:10px;border:1px solid #e6f4ff" />` : '';
}

/* Salvar lembrete */
saveBtn?.addEventListener('click', async ()=> {
  const name = nameInput.value.trim();
  const qty = quantityInput.value.trim();
  const startTime = startInput.value;
  const intervalTime = intervalInput.value;
  const remind = [];
  if (remind5.checked) remind.push(5);
  if (remind3.checked) remind.push(3);
  if (remind1.checked) remind.push(1);
  if (!name || !qty || !startTime || !intervalTime) { alert('Preencha todos os campos.'); return; }

  const intervalMinutes = parseInterval(intervalTime);
  const id = Math.random().toString(36).substring(2,9)+Date.now();
  const med = { id, name, qty, startTime: new Date(startTime).getTime(), intervalMinutes, img: lastImage, remind, history: [] };
  try {
    await saveMedIDB(med);
    meds.push(med);
    resetForm();
    speak(`${localStorage.getItem(STORAGE_KEY_USER) || 'Você'}, lembrete salvo com sucesso. Vou te lembrar com carinho.`);
    showView('list');
    renderList();
  } catch(e) { console.error(e); alert('Erro ao salvar lembrete.'); }
});

function resetForm(){
  nameInput.value = ''; quantityInput.value=''; lastImage=null; imgPreview.innerHTML='<span class="small">Sem foto</span>';
  remind1.checked=remind3.checked=remind5.checked=false;
  const now = new Date(); now.setMinutes(now.getMinutes()+1);
  const pad = n=>String(n).padStart(2,'0');
  startInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  intervalInput.value = '00:30';
}

/* ====== Carregamento inicial e restauração ====== */
window.addEventListener('DOMContentLoaded', async ()=> {
  // Restaurar nome
  usernameInput.value = localStorage.getItem(STORAGE_KEY_USER) || '';

  // Valores default para formulário
  const now = new Date(); now.setMinutes(now.getMinutes()+1);
  const pad = n=>String(n).padStart(2,'0');
  startInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  intervalInput.value = '00:30';

  try {
    meds = await loadMedsIDB();
    renderList();
  } catch(e) { console.warn('Erro carregar meds', e); }

  // Se já tem nome e lembretes, ir direto para lista
  if (localStorage.getItem(STORAGE_KEY_USER) && meds.length>0) {
    showView('list');
    speak(`Bem-vindo de volta, ${localStorage.getItem(STORAGE_KEY_USER)}. Estou pronto para ajudar.`);
  } else {
    showView('welcome');
  }

  // checagem periódica de alarmes
  setInterval(checkAlarms, 10000);
  checkAlarms();
});

/* Atualizar nome automaticamente */
usernameInput?.addEventListener('input', ()=> {
  localStorage.setItem(STORAGE_KEY_USER, usernameInput.value.trim());
});

/* Util: parse interval time (HH:MM) para minutos */
function parseInterval(s){
  const parts = (s || '00:00').split(':').map(Number);
  const [h,m] = parts;
  return (h||0)*60 + (m||0);
}

/* Falar texto */
function speak(text){
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pt-BR';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* ====== Lógica de alarmes e lembretes (preservada e adaptada) ====== */
function getNextAlarmTime(med){
  const now = Date.now();
  const startTime = med.startTime;
  const intervalMs = med.intervalMinutes*60*1000;
  if (intervalMs === 0 || med.intervalMinutes===0) return { nextTime: startTime, isFirst:true };
  if (med.history.length===0) {
    if (startTime < now - (10*60000)) {
      const elapsed = now - startTime;
      const passed = Math.floor(elapsed / intervalMs);
      const nextTime = startTime + (passed+1)*intervalMs;
      return { nextTime, isFirst:false };
    } else return { nextTime: startTime, isFirst:true };
  }
  const lastTaken = med.history[med.history.length-1];
  const next = lastTaken + intervalMs;
  if (next < now - (10*60000)) {
    const elapsed = now - lastTaken;
    const passed = Math.floor(elapsed / intervalMs);
    return { nextTime: lastTaken + (passed+1)*intervalMs, isFirst:false };
  }
  return { nextTime: next, isFirst:false };
}

function checkAlarms(){
  const now = Date.now();
  if (activeAlarmLoop !== null || activeReminderLoop !== null) return;
  for (const med of meds) {
    const { nextTime } = getNextAlarmTime(med);
    const alarmKey = med.id;
    const timeToAlarm = nextTime - now;
    if (timeToAlarm <= 60000 && timeToAlarm > -60000) {
      if (lastTriggered[alarmKey] !== nextTime) {
        startAlarmLoop(med, nextTime);
        lastTriggered[alarmKey] = nextTime;
        return;
      }
    }
    med.remind.forEach(min => {
      const reminderTime = nextTime - (min*60000);
      const reminderKey = `${med.id}-${min}`;
      const timeToReminder = reminderTime - now;
      if (timeToReminder <= 60000 && timeToReminder > -60000) {
        if (lastTriggered[reminderKey] !== nextTime) {
          startReminderLoop(med, min, nextTime, reminderKey);
          lastTriggered[reminderKey] = nextTime;
          return;
        }
      }
    });
  }
}

/* Inicia overlay de alarme (loop até ação do usuário) */
function startAlarmLoop(med, nextTime){
  if (activeAlarmLoop) clearInterval(activeAlarmLoop);
  currentActiveMed = med;
  const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
  const repeat = ()=> {
    const t = `${username}, é hora de tomar ${med.qty} de ${med.name}.`;
    overlayText.innerText = t;
    overlayImg.src = med.img || 'icons/icon-512.png';
    overlay.style.display = 'flex';
    sendNotification('Hora do remédio', t, { medId: med.id });
    speak(t);
    if ('vibrate' in navigator) navigator.vibrate([700,200,700]);
  };
  repeat();
  activeAlarmLoop = setInterval(repeat, 10000);
}

/* Inicia lembrete antecipado */
function startReminderLoop(med, min, nextTime, reminderKey){
  if (activeReminderLoop) clearInterval(activeReminderLoop);
  const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
  const repeat = ()=> {
    const t = `${username}, faltam ${min} minuto(s) para ${med.qty} de ${med.name}.`;
    reminderText.innerText = t;
    reminderImg.src = med.img || 'icons/icon-512.png';
    reminderOverlay.style.display = 'flex';
    sendNotification('Lembrete antecipado', t, { medId: med.id });
    speak(t);
    if ('vibrate' in navigator) navigator.vibrate([400,100,400]);
    if (nextTime < Date.now() + 60000) stopReminderLoop();
  };
  repeat();
  activeReminderLoop = setInterval(repeat, 10000);
}

function stopAlarmLoop(){
  if (activeAlarmLoop) clearInterval(activeAlarmLoop);
  activeAlarmLoop = null;
  currentActiveMed = null;
  overlay.style.display = 'none';
  if ('vibrate' in navigator) navigator.vibrate(0);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
function stopReminderLoop(){
  if (activeReminderLoop) clearInterval(activeReminderLoop);
  activeReminderLoop = null;
  reminderOverlay.style.display = 'none';
  if ('vibrate' in navigator) navigator.vibrate(0);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/* Ações overlays */
takenBtn?.addEventListener('click', async ()=> {
  if (!currentActiveMed) return;
  const med = meds.find(m=>m.id===currentActiveMed.id);
  if (!med) return;
  const now = Date.now();
  med.history.push(now);
  await saveMedIDB(med);
  stopAlarmLoop();
  stopReminderLoop();
  delete lastTriggered[med.id];
  renderList();
  alert(`Registrado como tomado às ${new Date(now).toLocaleString('pt-BR')}`);
});

postpone30Btn?.addEventListener('click', ()=> handlePostpone(30));
postpone60Btn?.addEventListener('click', ()=> handlePostpone(60));
reminderOkBtn?.addEventListener('click', ()=> stopReminderLoop());

async function handlePostpone(minutes){
  if (!currentActiveMed) return;
  const med = currentActiveMed;
  const postponeMs = minutes*60*1000;
  const { nextTime } = getNextAlarmTime(med);
  const newNextTime = nextTime + postponeMs;
  stopAlarmLoop(); stopReminderLoop();
  lastTriggered[med.id] = newNextTime - 1;
  setTimeout(()=> checkAlarms(), 1000);
}

/* Teste agora - simula alarme do primeiro lembrete */
testNow?.addEventListener('click', ()=> {
  if (meds.length === 0) { alert('Cadastre um lembrete para testar.'); return; }
  const med = meds[0];
  const nextTime = Date.now() + 1000;
  lastTriggered[med.id] = nextTime - 1;
  startAlarmLoop(med, nextTime);
});

/* Excluir lembrete */
window.deleteMed = async function(id){
  if (!confirm('Excluir lembrete?')) return;
  await deleteMedIDB(id);
  meds = meds.filter(m=>m.id!==id);
  delete lastTriggered[id];
  renderList();
  alert('Lembrete excluído.');
};

/* Render da lista */
function renderList(){
  if (!medList) return;
  if (meds.length===0) { medList.innerHTML = '<div class="small">Nenhum lembrete cadastrado ainda.</div>'; return; }
  medList.innerHTML = meds.map(med=>{
    const { nextTime } = getNextAlarmTime(med);
    const nextStr = new Date(nextTime).toLocaleString('pt-BR');
    const hist = med.history.length>0 ? `<div class="history-list"><strong>Histórico (${med.history.length}):</strong><br>${med.history.map(t=>`✅ ${new Date(t).toLocaleString('pt-BR')}`).join('<br>')}</div>` : '<div class="small">Ainda não foi tomado</div>';
    return `
      <div class="med-item">
        ${med.img ? `<img src="${med.img}" alt="${med.name}" />` : `<img src="icons/icon-192.png" alt="icone">`}
        <div class="med-meta">
          <strong>${escapeHtml(med.name)}</strong> - ${escapeHtml(med.qty)}
          <div class="small">Próximo: ${nextStr}</div>
          ${hist}
        </div>
        <div class="actions">
          <button class="danger-btn" onclick="deleteMed('${med.id}')">Excluir</button>
        </div>
      </div>
    `;
  }).join('');
}

/* Envia notificação via service worker */
function sendNotification(title, body, data){
  if (Notification.permission === 'granted' && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type:'SHOW_NOTIFICATION', title, body, data });
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then(p=>{ if (p==='granted') sendNotification(title, body, data); });
  }
}

/* Util cuidado: escape de texto que vem do usuário (simples) */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[s]);
}
