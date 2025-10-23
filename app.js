// === CuidaBem - Lembrete de Medicamentos (corrigido: tratamento de quota + compressão progressiva) ===

const views = document.querySelectorAll('.view');
const overlay = document.getElementById('overlay');
const reminderOverlay = document.getElementById('reminderOverlay');
const overlayText = document.getElementById('overlayText');
const overlayImg = document.getElementById('overlayImg');
const medList = document.getElementById('medList');
const consentText = document.getElementById('consentText');

const synth = window.speechSynthesis;
const recognition = ('webkitSpeechRecognition' in window) ? new webkitSpeechRecognition() : null;
if (recognition) {
  recognition.lang = 'pt-BR';
  recognition.continuous = false;
  recognition.interimResults = false;
}

let userName = localStorage.getItem('userName') || '';
let meds = JSON.parse(localStorage.getItem('meds') || '[]');
let consentAccepted = localStorage.getItem('consentAccepted') === 'true';
let currentMed = {};
let timers = [];

function showView(name) {
  views.forEach(v => v.style.display = (v.dataset.view === name ? 'block' : 'none'));
}

function speak(text) {
  if (!synth) return;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'pt-BR';
  synth.speak(utter);
}

function listen(callback) {
  if (!recognition) return;
  recognition.start();
  recognition.onresult = e => {
    const text = e.results[0][0].transcript.trim();
    callback(text);
  };
}

function requestNotificationPermission() {
  if (Notification.permission !== 'granted') {
    Notification.requestPermission().then(permission => {
      console.log('Permissão de notificação:', permission);
    });
  }
}

// util: detecta erro de quota localStorage
function isQuotaExceeded(e) {
  if (!e) return false;
  return e instanceof DOMException && (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  );
}

// util: converte dataURL para imagem redimensionada (promise)
function resizeDataUrl(dataUrl, maxSize = 600, quality = 0.7) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const scale = Math.min(1, Math.min(maxSize / img.width, maxSize / img.height));
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const reduced = canvas.toDataURL('image/jpeg', quality);
          resolve(reduced);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = (err) => reject(err);
      img.src = dataUrl;
    } catch (err) {
      reject(err);
    }
  });
}

// tenta salvar no localStorage com estratégias caso o espaço seja insuficiente
async function safeSaveMeds(medsArray) {
  // tentativa direta primeiro
  try {
    localStorage.setItem('meds', JSON.stringify(medsArray));
    return { ok: true };
  } catch (e) {
    if (!isQuotaExceeded(e)) {
      console.error('Erro desconhecido ao salvar:', e);
      return { ok: false, error: e };
    }
    console.warn('QuotaExceeded: tentando estratégias de redução de tamanho...');
  }

  // Estratégia 1: se currentMed tem foto, tente recomprimir ainda mais essa foto
  try {
    // encontra índice do currentMed (último adicionado ou baseado em nome/dose/start)
    const idx = medsArray.length - 1;
    if (idx >= 0 && medsArray[idx] && medsArray[idx].photo) {
      let photo = medsArray[idx].photo;
      // tentativa progressiva: 600@0.7 -> 400@0.55 -> 300@0.45
      const attempts = [
        { size: 400, q: 0.55 },
        { size: 300, q: 0.45 },
      ];
      for (const a of attempts) {
        try {
          const reduced = await resizeDataUrl(photo, a.size, a.q);
          medsArray[idx].photo = reduced;
          try {
            localStorage.setItem('meds', JSON.stringify(medsArray));
            return { ok: true, strategy: 'recompressed-current' };
          } catch (err2) {
            if (!isQuotaExceeded(err2)) throw err2;
            // continua para próxima tentativa
            photo = reduced;
          }
        } catch (errR) {
          console.warn('Falha ao recomprimir foto:', errR);
        }
      }
    }
  } catch (err) {
    console.warn('Erro na estratégia de recompressão:', err);
  }

  // Estratégia 2: Remover fotos dos itens antigos (conservador) — preserva foto do atual, se possível
  try {
    // cria cópia profunda para manipular
    const clone = JSON.parse(JSON.stringify(medsArray));
    // primeiro, remove fotos de itens antigos (do início para o fim) mas mantém o último (current)
    for (let i = 0; i < clone.length - 1; i++) {
      if (clone[i].photo) {
        delete clone[i].photo;
        try {
          localStorage.setItem('meds', JSON.stringify(clone));
          return { ok: true, strategy: 'removed-old-photos' };
        } catch (err) {
          if (!isQuotaExceeded(err)) throw err;
          // continua removendo mais fotos
        }
      }
    }
  } catch (err) {
    console.warn('Erro ao remover fotos antigas:', err);
  }

  // Estratégia 3: Remover todas as fotos (inclusive current) — último recurso
  try {
    const clone2 = JSON.parse(JSON.stringify(medsArray));
    for (let i = 0; i < clone2.length; i++) {
      if (clone2[i].photo) delete clone2[i].photo;
    }
    try {
      localStorage.setItem('meds', JSON.stringify(clone2));
      return { ok: true, strategy: 'removed-all-photos' };
    } catch (err) {
      if (!isQuotaExceeded(err)) throw err;
      console.warn('Ainda sem espaço após remover fotos.');
    }
  } catch (err) {
    console.warn('Erro na última estratégia:', err);
  }

  // Tudo falhou
  return { ok: false, error: new Error('QuotaExceeded after all strategies') };
}

// === INICIALIZAÇÃO ===
window.addEventListener('load', () => {
  requestNotificationPermission();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js');
  
  if (userName && consentAccepted) {
    renderList();
    showView('list');
    scheduleAllMeds();
  } else if (!userName) {
    showView('welcome');
    speak("Olá! Seja bem-vindo ao CuidaBem. Como posso te chamar?");
  } else {
    showView('consent');
    speak("Antes de continuar, preciso que você leia ou ouça o termo de consentimento.");
  }
});

// === BOAS-VINDAS ===
document.getElementById('voiceUsername').onclick = () => listen(name => {
  document.getElementById('username').value = name;
});
document.getElementById('welcomeNext').onclick = () => {
  const val = document.getElementById('username').value.trim();
  if (!val) return alert('Por favor, digite seu nome');
  userName = val;
  localStorage.setItem('userName', val);
  showView('consent');
  speak(`Prazer em te conhecer, ${val}. Antes de começar, preciso do seu consentimento.`);
};
document.getElementById('clearAll').onclick = () => {
  if (confirm('Deseja limpar todos os dados?')) {
    localStorage.clear();
    location.reload();
  }
};

// === CONSENTIMENTO ===
const consentTextContent = `
Este aplicativo CuidaBem ajuda você a lembrar de seus medicamentos.
Suas informações são armazenadas apenas no seu dispositivo e não são compartilhadas.
Ao aceitar, você autoriza o uso local dos dados e das notificações.
`;
consentText.innerText = consentTextContent;
document.getElementById('playConsent').onclick = () => speak(consentTextContent);
document.getElementById('acceptConsent').onclick = () => {
  consentAccepted = true;
  localStorage.setItem('consentAccepted', 'true');
  startForm();
};
document.getElementById('consentBack').onclick = () => showView('welcome');

// === FORMULÁRIO ===
function startForm() {
  currentMed = {};
  showView('form-name');
  speak(`${userName}, qual é o nome do medicamento?`);
}

document.getElementById('voiceName').onclick = () => listen(text => document.getElementById('name').value = text);
document.getElementById('formNameNext').onclick = () => {
  const name = document.getElementById('name').value.trim();
  if (!name) return alert('Digite o nome do medicamento');
  currentMed.name = name;
  showView('form-qty');
  speak('Qual a dose do medicamento?');
};
document.getElementById('formNameBack').onclick = () => showView('consent');

document.getElementById('voiceQuantity').onclick = () => listen(text => document.getElementById('quantity').value = text);
document.getElementById('formQtyNext').onclick = () => {
  const qty = document.getElementById('quantity').value.trim();
  if (!qty) return alert('Digite a dose');
  currentMed.quantity = qty;
  showView('form-time');
  speak('Quando você vai começar a tomar?');
};
document.getElementById('formQtyBack').onclick = () => showView('form-name');

document.getElementById('formTimeNext').onclick = () => {
  const start = document.getElementById('startTime').value;
  const interval = document.getElementById('intervalTime').value;
  if (!start) return alert('Informe o horário inicial');
  currentMed.start = start;
  currentMed.interval = interval;
  showView('form-remind');
  speak('Deseja receber lembretes antecipados?');
};
document.getElementById('formTimeBack').onclick = () => showView('form-qty');

document.getElementById('formRemindNext').onclick = () => {
  currentMed.remind = [];
  if (document.getElementById('remind5').checked) currentMed.remind.push(5);
  if (document.getElementById('remind3').checked) currentMed.remind.push(3);
  if (document.getElementById('remind1').checked) currentMed.remind.push(1);
  showView('form-photo');
  speak('Deseja adicionar uma foto do medicamento?');
};
document.getElementById('formRemindBack').onclick = () => showView('form-time');

// === FOTO (com compressão imediata e fallback) ===
const photoInput = document.getElementById('photo');
const imgPreview = document.getElementById('imgPreview');
photoInput.onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  // lê a imagem como dataURL
  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      // compressão inicial para 600px@0.7
      const reduced = await resizeDataUrl(evt.target.result, 600, 0.7);
      imgPreview.innerHTML = `<img src="${reduced}">`;
      currentMed.photo = reduced;
    } catch (err) {
      console.warn('Falha na compressão inicial, usando data original:', err);
      // fallback: usa data original (pior caso)
      imgPreview.innerHTML = `<img src="${evt.target.result}">`;
      currentMed.photo = evt.target.result;
    }
  };
  reader.readAsDataURL(file);
};

document.getElementById('formPhotoNext').onclick = () => {
  showView('review');
  document.getElementById('reviewName').textContent = currentMed.name;
  document.getElementById('reviewQty').textContent = currentMed.quantity;
  document.getElementById('reviewStart').textContent = document.getElementById('startTime').value || 'Não informado';
  document.getElementById('reviewInterval').textContent = currentMed.interval;
  document.getElementById('reviewRemind').textContent = currentMed.remind.join(', ') || 'Nenhum';
  document.getElementById('reviewPhotoBlock').innerHTML = currentMed.photo ? `<img src="${currentMed.photo}">` : '';
  speak('Revise suas informações e clique em salvar lembrete.');
};
document.getElementById('formPhotoBack').onclick = () => showView('form-remind');

// === SALVAR E AGENDAR (robusto) ===
document.getElementById('saveBtn').onclick = async () => {
  try {
    const startInput = document.getElementById('startTime').value;
    const intervalInput = document.getElementById('intervalTime').value;

    const startVal = startInput || currentMed.start;
    const intervalVal = intervalInput || currentMed.interval;

    if (!currentMed.name || !currentMed.quantity || !startVal || !intervalVal) {
      alert('Por favor, preencha todas as etapas antes de salvar.');
      return;
    }

    const parsedStart = new Date(startVal);
    if (isNaN(parsedStart.getTime())) {
      alert('Horário inicial inválido. Verifique o campo Início.');
      console.error('Start inválido ao salvar:', startVal);
      return;
    }
    currentMed.start = parsedStart.toISOString();

    if (typeof intervalVal !== 'string' || !/^[0-9]{2}:[0-9]{2}$/.test(intervalVal)) {
      alert('Intervalo inválido. Use o formato HH:MM.');
      console.error('Intervalo inválido ao salvar:', intervalVal);
      return;
    }
    currentMed.interval = intervalVal;

    if (!Array.isArray(currentMed.remind)) currentMed.remind = [];

    // prepara array para salvar (faz uma cópia para não corromper currentMed se precisarmos manipular)
    const toSave = JSON.parse(JSON.stringify(meds));
    toSave.push(currentMed);

    // tenta salvar com estratégias de fallback
    const result = await safeSaveMeds(toSave);
    if (!result.ok) {
      console.error('Falha ao salvar após estratégias:', result.error);
      alert('Não foi possível salvar. Espaço de armazenamento insuficiente no dispositivo. Considere remover lembretes antigos ou fotos.');
      return;
    }

    // atualiza estado local com a versão que foi realmente gravada (busca do localStorage para garantir consistência)
    try {
      meds = JSON.parse(localStorage.getItem('meds') || '[]');
    } catch (e) {
      // se parsing falhar, fallback para toSave sem fotos (proteção)
      meds = toSave.map(m => { const copy = Object.assign({}, m); delete copy.photo; return copy; });
      localStorage.setItem('meds', JSON.stringify(meds));
    }

    renderList();
    scheduleAllMeds();
    showView('list');
    speak('Lembrete salvo com sucesso! (se houver fotos grandes, elas podem ter sido reduzidas ou removidas para economizar espaço)');
  } catch (err) {
    console.error('Erro ao salvar lembrete:', err);
    alert('Ocorreu um erro ao salvar o lembrete. Verifique os dados e tente novamente.');
  }
};

document.getElementById('reviewBack').onclick = () => showView('form-photo');

// === LISTA ===
function renderList() {
  medList.innerHTML = meds.length ? '' : '<p>Nenhum lembrete cadastrado.</p>';
  meds.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'med-item';
    div.innerHTML = `
      ${m.photo ? `<img src="${m.photo}">` : '<img src="icons/icon-192.png">'}
      <div class="med-meta">
        <strong>${m.name}</strong>
        <div class="small">${m.quantity}</div>
        <div class="small">${new Date(m.start).toLocaleString()}</div>
      </div>
      <button class="btn-secondary" onclick="deleteMed(${i})">🗑️</button>
    `;
    medList.appendChild(div);
  });
}
window.deleteMed = (i) => {
  if (confirm('Excluir lembrete?')) {
    meds.splice(i, 1);
    try {
      localStorage.setItem('meds', JSON.stringify(meds));
    } catch (e) {
      console.error('Erro ao atualizar localStorage ao deletar:', e);
      // tenta remover fotos e tentar novamente
      const clone = meds.map(m => { const c = Object.assign({}, m); delete c.photo; return c; });
      try { localStorage.setItem('meds', JSON.stringify(clone)); } catch (err) { console.error(err); }
    }
    renderList();
  }
};
document.getElementById('addNew').onclick = () => startForm();
document.getElementById('testNow').onclick = () => showAlarm({ name: "Teste", quantity: "1 cápsula" });

// === AGENDAMENTO ===
function scheduleAllMeds() {
  timers.forEach(t => clearTimeout(t));
  timers = [];

  meds.forEach((m) => {
    const start = new Date(m.start);
    if (isNaN(start.getTime())) {
      console.warn('Ignorando lembrete com start inválido:', m);
      return;
    }

    if (!m.interval || typeof m.interval !== 'string' || m.interval.indexOf(':') === -1) {
      console.warn('Ignorando lembrete com intervalo inválido:', m);
      return;
    }
    const intervalParts = m.interval.split(':');
    const hours = parseInt(intervalParts[0], 10);
    const minutes = parseInt(intervalParts[1], 10);
    if (isNaN(hours) || isNaN(minutes)) {
      console.warn('Ignorando lembrete com partes de intervalo inválidas:', m);
      return;
    }
    const intervalMs = (hours * 60 + minutes) * 60 * 1000;

    const now = new Date();
    while (start < now) start.setTime(start.getTime() + intervalMs);

    const delay = start.getTime() - now.getTime();
    if (delay <= 0) {
      console.warn('Delay calculado não é positivo para:', m);
      return;
    }
    timers.push(setTimeout(() => triggerAlarm(m), delay));

    (m.remind || []).forEach(mins => {
      const remindDelay = delay - mins * 60 * 1000;
      if (remindDelay > 0) timers.push(setTimeout(() => triggerReminder(m, mins), remindDelay));
    });
  });
}

function triggerReminder(med, mins) {
  reminderOverlay.style.display = 'flex';
  document.getElementById('reminderText').textContent = `Faltam ${mins} minutos para tomar ${med.name}`;
  speak(`Lembrete: em ${mins} minutos será hora de tomar ${med.name}`);
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
}

function triggerAlarm(med) {
  overlay.style.display = 'flex';
  overlayText.textContent = `Está na hora de tomar ${med.name}`;
  overlayImg.src = med.photo || 'icons/icon-512.png';
  speak(`Está na hora de tomar ${med.name}. Dose: ${med.quantity}`);
  if ('vibrate' in navigator) navigator.vibrate([400, 200, 400, 200, 400]);

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SHOW_NOTIFICATION',
      title: 'Hora do remédio 💊',
      body: `Está na hora de tomar ${med.name} (${med.quantity})`,
      icon: med.photo || 'icons/icon-192.png'
    });
  }
}

// === OVERLAY BOTÕES ===
document.getElementById('takenBtn').onclick = () => {
  overlay.style.display = 'none';
  speak('Ótimo! Continue cuidando bem da sua saúde.');
};
document.getElementById('postpone30').onclick = () => postpone(30);
document.getElementById('postpone60').onclick = () => postpone(60);
function postpone(mins) {
  overlay.style.display = 'none';
  speak(`Alarme adiado por ${mins} minutos.`);
}
document.getElementById('reminderOkBtn').onclick = () => reminderOverlay.style.display = 'none';
