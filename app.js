// === CuidaBem - Lembrete de Medicamentos Humanizado (versão final corrigida) ===

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

// === FOTO ===
const photoInput = document.getElementById('photo');
const imgPreview = document.getElementById('imgPreview');
photoInput.onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    imgPreview.innerHTML = `<img src="${evt.target.result}">`;
    currentMed.photo = evt.target.result;
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

// === SALVAR E AGENDAR (corrigido) ===
document.getElementById('saveBtn').onclick = () => {
  try {
    const startInput = document.getElementById('startTime').value;
    const intervalInput = document.getElementById('intervalTime').value;

    if (!currentMed.name || !currentMed.quantity || !startInput || !intervalInput) {
      alert('Por favor, preencha todas as etapas antes de salvar.');
      return;
    }

    currentMed.start = new Date(startInput).toISOString();
    currentMed.interval = intervalInput;
    if (!Array.isArray(currentMed.remind)) currentMed.remind = [];

    meds.push(currentMed);
    localStorage.setItem('meds', JSON.stringify(meds));

    renderList();
    scheduleAllMeds();

    showView('list');
    speak('Lembrete salvo com sucesso!');
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
    localStorage.setItem('meds', JSON.stringify(meds));
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
    const intervalParts = m.interval.split(':');
    const intervalMs = (+intervalParts[0] * 60 + +intervalParts[1]) * 60 * 1000;

    const now = new Date();
    while (start < now) start.setTime(start.getTime() + intervalMs);

    const delay = start.getTime() - now.getTime();
    timers.push(setTimeout(() => triggerAlarm(m), delay));

    (m.remind || []).forEach(mins => {
      const remindDelay = delay - mins * 60 * 1000;
      if (remindDelay > 0)
        timers.push(setTimeout(() => triggerReminder(m, mins), remindDelay));
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
