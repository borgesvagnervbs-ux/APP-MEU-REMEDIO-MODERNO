// ===== INDEXEDDB =====
const DB_NAME = 'LembretesDB';
const STORE_NAME = 'meds';
let db = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('Service Worker registrado.'))
    .catch(err => console.error('Erro ao registrar o SW:', err));
}


function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = event => reject("Erro ao abrir o banco de dados.");
    request.onsuccess = event => {
      db = event.target.result;
      resolve(db);
    };
    request.onupgradeneeded = event => {
      db = event.target.result;
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
  });
}

async function saveMedIDB(med) {
  const conn = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = conn.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(med);
    request.onsuccess = () => resolve();
    request.onerror = event => reject(event.target.error);
  });
}

async function loadMedsIDB() {
  const conn = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = conn.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
  });
}

async function deleteMedIDB(id) {
  const conn = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = conn.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = event => reject(event.target.error);
  });
}

// ===== VARIÁVEIS GLOBAIS =====
const STORAGE_KEY_USER = 'username';
const STORAGE_KEY_ONBOARDING = 'onboarding_complete';
let meds = [];
let lastImage = null;
let lastTriggered = {};
let activeAlarmLoop = null;
let activeReminderLoop = null;
let currentActiveMed = null;
let currentSlide = 0;
let currentWizardSlide = 0;

// ===== RECONHECIMENTO DE VOZ =====
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = false;
  recognition.interimResults = false;
}

function voiceInput(inputId) {
  if (!recognition) {
    alert('Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge.');
    return;
  }

  const inputElement = document.getElementById(inputId);
  
  recognition.onstart = () => {
    console.log('🎤 Reconhecimento de voz iniciado...');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    inputElement.value = transcript;
    console.log('✅ Reconhecido:', transcript);
  };

  recognition.onerror = (event) => {
    console.error('❌ Erro no reconhecimento de voz:', event.error);
    alert('Erro ao reconhecer a voz. Tente novamente.');
  };

  recognition.onend = () => {
    console.log('🎤 Reconhecimento de voz finalizado.');
  };

  recognition.start();
}

// ===== SPEECH SYNTHESIS =====
function speak(text) {
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    speechSynthesis.speak(utterance);
  }
}

// ===== ONBOARDING =====
function nextSlide() {
  const slides = document.querySelectorAll('.onboarding .slide');
  if (currentSlide < slides.length - 1) {
    slides[currentSlide].classList.remove('active');
    currentSlide++;
    slides[currentSlide].classList.add('active');
    
    speakSlideContent(currentSlide);
  }
}

function prevSlide() {
  const slides = document.querySelectorAll('.onboarding .slide');
  if (currentSlide > 0) {
    slides[currentSlide].classList.remove('active');
    currentSlide--;
    slides[currentSlide].classList.add('active');
    
    speakSlideContent(currentSlide);
  }
}

function speakSlideContent(slideIndex) {
  const messages = [
    'Bem-vindo ao Lembrete de Medicamentos. Vamos configurar seus lembretes.',
    'Como você quer ser chamado? Digite seu nome ou use o botão de voz.',
    'Leia os termos de consentimento. Você pode ouvir clicando no botão ou aceitar clicando em aceito.',
    'Precisamos de algumas permissões para o aplicativo funcionar corretamente.'
  ];
  
  if (messages[slideIndex]) {
    speak(messages[slideIndex]);
  }
}

function saveUsername() {
  const username = document.getElementById('usernameSlide').value.trim();
  if (!username) {
    alert('Por favor, digite seu nome.');
    speak('Por favor, digite seu nome.');
    return;
  }
  
  localStorage.setItem(STORAGE_KEY_USER, username);
  nextSlide();
}

function speakTerms() {
  const termsText = `Termo de Uso e Privacidade. 
    Este aplicativo armazena informações sobre seus medicamentos localmente no seu dispositivo. 
    Ao usar este app, você concorda em: 
    Permitir notificações e alertas sonoros, 
    Armazenar dados de medicamentos no dispositivo, 
    Permitir acesso ao microfone para comandos de voz, 
    Permitir acesso à câmera para fotos dos medicamentos. 
    Importante: Este app é apenas um lembrete. Consulte sempre seu médico sobre medicações.`;
  
  speak(termsText);
}

function acceptTerms() {
  speak('Termos aceitos. Vamos configurar as permissões.');
  nextSlide();
}

async function requestPermissions() {
  speak('Solicitando permissões.');
  
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  
  localStorage.setItem(STORAGE_KEY_ONBOARDING, 'true');
  
  speak('Configuração concluída. Bem-vindo ao seu aplicativo de lembretes.');
  
  document.getElementById('onboarding').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  
  loadMainApp();
}

// ===== INICIALIZAÇÃO =====
window.addEventListener('DOMContentLoaded', async () => {
  const onboardingComplete = localStorage.getItem(STORAGE_KEY_ONBOARDING);
  
  if (onboardingComplete) {
    document.getElementById('onboarding').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    loadMainApp();
  } else {
    speakSlideContent(0);
  }
  
  try {
    meds = await loadMedsIDB();
    renderList();
    console.log(`✅ ${meds.length} lembretes carregados do IndexedDB.`);
  } catch (err) {
    console.error('Erro ao carregar lembretes do IDB:', err);
  }
  
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(persisted => {
      if (persisted) console.log("Armazenamento persistente concedido.");
    });
  }
});

function loadMainApp() {
  const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
  document.getElementById('userGreeting').textContent = `Olá, ${username}!`;
  speak(`Olá, ${username}! Bem-vindo de volta.`);
}

// ===== WIZARD ADICIONAR MEDICAMENTO =====
function startAddMed() {
  document.getElementById('addMedWizard').style.display = 'block';
  currentWizardSlide = 0;
  updateWizardProgress();
  
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  const pad = n => n.toString().padStart(2, '0');
  document.getElementById('medStartTime').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  document.getElementById('medInterval').value = '00:30';
  
  speak('Vamos adicionar um novo medicamento. Qual o nome do medicamento?');
}

function cancelAddMed() {
  document.getElementById('addMedWizard').style.display = 'none';
  clearWizardFields();
}

function nextWizard() {
  const slides = document.querySelectorAll('.wizard-slide');
  
  if (currentWizardSlide === 0 && !document.getElementById('medName').value.trim()) {
    alert('Digite o nome do medicamento.');
    speak('Digite o nome do medicamento.');
    return;
  }
  if (currentWizardSlide === 1 && !document.getElementById('medQuantity').value.trim()) {
    alert('Digite a quantidade ou dose.');
    speak('Digite a quantidade ou dose.');
    return;
  }
  
  if (currentWizardSlide < slides.length - 1) {
    slides[currentWizardSlide].classList.remove('active');
    currentWizardSlide++;
    slides[currentWizardSlide].classList.add('active');
    updateWizardProgress();
    speakWizardContent(currentWizardSlide);
  }
}

function prevWizard() {
  const slides = document.querySelectorAll('.wizard-slide');
  if (currentWizardSlide > 0) {
    slides[currentWizardSlide].classList.remove('active');
    currentWizardSlide--;
    slides[currentWizardSlide].classList.add('active');
    updateWizardProgress();
    speakWizardContent(currentWizardSlide);
  }
}

function updateWizardProgress() {
  const progress = ((currentWizardSlide + 1) / 6) * 100;
  document.getElementById('progressFill').style.width = progress + '%';
  document.getElementById('progressText').textContent = `${currentWizardSlide + 1} de 6`;
}

function speakWizardContent(slideIndex) {
  const messages = [
    'Qual o nome do medicamento?',
    'Qual a dose ou quantidade?',
    'Quando você deve começar a tomar?',
    'De quanto em quanto tempo você deve tomar?',
    'Deseja receber lembretes antecipados?',
    'Você pode tirar uma foto do medicamento para facilitar a identificação.'
  ];
  
  if (messages[slideIndex]) {
    speak(messages[slideIndex]);
  }
}

function previewPhoto() {
  const file = document.getElementById('medPhoto').files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = e => {
      lastImage = e.target.result;
      document.getElementById('photoPreview').innerHTML = `<img src="${lastImage}" alt="Prévia" />`;
    };
    reader.readAsDataURL(file);
  }
}

async function saveMedication() {
  const name = document.getElementById('medName').value.trim();
  const qty = document.getElementById('medQuantity').value.trim();
  const startTime = document.getElementById('medStartTime').value;
  const intervalTime = document.getElementById('medInterval').value;
  const remind = [];
  
  if (document.getElementById('remind5Wizard').checked) remind.push(5);
  if (document.getElementById('remind3Wizard').checked) remind.push(3);
  if (document.getElementById('remind1Wizard').checked) remind.push(1);

  if (!name || !qty || !startTime || !intervalTime) {
    alert('Preencha todos os campos obrigatórios.');
    return;
  }

  try {
    const [hours, minutes] = intervalTime.split(':').map(Number);
    const intervalMinutes = hours * 60 + minutes;
    const id = Math.random().toString(36).substring(2, 9) + Date.now();

    const med = {
      id,
      name,
      qty,
      startTime: new Date(startTime).getTime(),
      intervalMinutes,
      img: lastImage,
      remind,
      history: []
    };

    await saveMedIDB(med);
    meds.push(med);
    renderList();
    
    speak(`Lembrete de ${name} salvo com sucesso!`);
    alert('💾 Lembrete salvo com sucesso!');
    
    document.getElementById('addMedWizard').style.display = 'none';
    clearWizardFields();
  } catch (err) {
    console.error('Erro ao salvar:', err);
    alert('Erro ao salvar o lembrete.');
  }
}

function clearWizardFields() {
  document.getElementById('medName').value = '';
  document.getElementById('medQuantity').value = '';
  document.getElementById('medPhoto').value = '';
  document.getElementById('photoPreview').innerHTML = '<span class="photo-placeholder">📷</span>';
  document.getElementById('remind5Wizard').checked = false;
  document.getElementById('remind3Wizard').checked = false;
  document.getElementById('remind1Wizard').checked = false;
  lastImage = null;
  
  const slides = document.querySelectorAll('.wizard-slide');
  slides.forEach((slide, index) => {
    slide.classList.toggle('active', index === 0);
  });
  currentWizardSlide = 0;
  updateWizardProgress();
}

// ===== RENDERIZAR LISTA =====
function renderList() {
  const medList = document.getElementById('medList');
  const emptyState = document.getElementById('emptyState');
  
  if (meds.length === 0) {
    medList.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  medList.innerHTML = meds.map(med => {
    const { nextTime } = getNextAlarmTime(med);
    const nextDate = new Date(nextTime);
    const nextStr = nextDate.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    let historyHTML = '';
    if (med.history && med.history.length > 0) {
      const sortedHistory = [...med.history].sort((a, b) => b - a);
      const recentHistory = sortedHistory.slice(0, 5);
      
      historyHTML = `
        <div class="med-history">
          <div class="med-history-header">
            <div class="med-history-title">
              📊 Histórico de Tomadas
            </div>
            <div class="med-history-count">${med.history.length}</div>
          </div>
          <div class="med-history-list">
            ${recentHistory.map(timestamp => {
              const date = new Date(timestamp);
              const dateStr = date.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              });
              return `
                <div class="med-history-item">
                  <span class="med-history-icon">✅</span>
                  <span class="med-history-time">${dateStr}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else {
      historyHTML = `
        <div class="med-history">
          <div class="med-history-header">
            <div class="med-history-title">
              📊 Histórico de Tomadas
            </div>
            <div class="med-history-count">0</div>
          </div>
          <div class="med-history-empty">
            Nenhuma tomada registrada ainda
          </div>
        </div>
      `;
    }

    return `
      <div class="med-card">
        <div class="med-card-header">
          <div class="med-image">
            ${med.img ? `<img src="${med.img}" alt="${med.name}" />` : '💊'}
          </div>
          <div class="med-info">
            <div class="med-name">${med.name}</div>
            <div class="med-dose">${med.qty}</div>
            <div class="med-next">📅 Próximo: ${nextStr}</div>
          </div>
        </div>
        ${historyHTML}
        <button class="btn-delete" onclick="deleteMed('${med.id}')">🗑️ Excluir</button>
      </div>
    `;
  }).join('');
}

async function deleteMed(id) {
  if (confirm('Excluir este lembrete?')) {
    await deleteMedIDB(id);
    meds = meds.filter(m => m.id !== id);
    delete lastTriggered[id];
    renderList();
    speak('Lembrete excluído.');
    alert('🗑️ Lembrete excluído com sucesso!');
  }
}

// ===== CONFIGURAÇÕES =====
function showSettings() {
  document.getElementById('settingsPanel').classList.add('active');
}

function closeSettings() {
  document.getElementById('settingsPanel').classList.remove('active');
}

function testAlarm() {
  if (meds.length) {
    const med = meds[0];
    startAlarmLoop(med, Date.now());
    closeSettings();
  } else {
    alert('Cadastre um lembrete para testar o alarme.');
    speak('Cadastre um lembrete para testar o alarme.');
  }
}

async function clearAllData() {
  if (confirm('ATENÇÃO: Isso excluirá TODOS os seus lembretes e dados. Tem certeza?')) {
    try {
      const conn = await openDB();
      const transaction = conn.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();

      meds = [];
      lastTriggered = {};
      stopAlarmLoop();
      stopReminderLoop();
      renderList();

      alert('🔥 Todos os lembretes foram excluídos!');
      speak('Todos os lembretes foram excluídos.');
      closeSettings();
    } catch (e) {
      console.error('Erro ao limpar o IDB:', e);
      alert('Erro ao limpar os lembretes.');
    }
  }
}

// ===== LÓGICA DE ALARME =====
function getNextAlarmTime(med) {
  const now = Date.now();
  const startTime = med.startTime;
  const intervalMs = med.intervalMinutes * 60 * 1000;
  
  if (intervalMs === 0 || med.intervalMinutes === 0) {
    return { nextTime: startTime, isFirst: true };
  }
  
  if (!med.history || med.history.length === 0) {
    if (startTime < now - (10 * 60 * 1000)) {
      const timeElapsed = now - startTime;
      const intervalsPassed = Math.floor(timeElapsed / intervalMs);
      const nextTime = startTime + (intervalsPassed + 1) * intervalMs;
      return { nextTime, isFirst: false };
    } else {
      return { nextTime: startTime, isFirst: true };
    }
  }
  
  const lastTakenTime = med.history[med.history.length - 1];
  const nextTime = lastTakenTime + intervalMs;
  
  if (nextTime < now - (10 * 60 * 1000)) {
    const timeElapsed = now - lastTakenTime;
    const intervalsPassed = Math.floor(timeElapsed / intervalMs);
    return { nextTime: lastTakenTime + (intervalsPassed + 1) * intervalMs, isFirst: false };
  }

  return { nextTime, isFirst: false };
}

function checkAlarms() {
  const now = Date.now();
  
  if (activeAlarmLoop !== null || activeReminderLoop !== null) {
    return;
  }
  
  meds.forEach(med => {
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
    
    if (med.remind && med.remind.length > 0) {
      med.remind.forEach(min => {
        const reminderTime = nextTime - (min * 60000);
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
  });
}

function startAlarmLoop(med, nextTime) {
  if (activeAlarmLoop) clearInterval(activeAlarmLoop);
  currentActiveMed = med;

  const repeatAlarm = () => {
    const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
    const text = `${username}, hora de tomar ${med.qty} de ${med.name}.`;
    
    document.getElementById('overlayText').innerText = text;
    document.getElementById('overlayImg').src = med.img || '';
    document.getElementById('overlay').style.display = 'flex';
    
    sendNotification('🚨 ALARME DE MEDICAMENTO', text, { medId: med.id });
    speak(text);
    if ('vibrate' in navigator) {
      navigator.vibrate([1000, 500, 1000]);
    }
  };
  
  repeatAlarm();
  activeAlarmLoop = setInterval(repeatAlarm, 10000);
}

function startReminderLoop(med, min, nextTime, reminderKey) {
  if (activeReminderLoop) clearInterval(activeReminderLoop);

  const repeatReminder = () => {
    const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
    const text = `${username}, faltam ${min} minutos para tomar ${med.qty} de ${med.name}.`;
    
    document.getElementById('reminderText').innerText = text;
    document.getElementById('reminderImg').src = med.img || '';
    document.getElementById('reminderOverlay').style.display = 'flex';
    
    sendNotification('⏰ Lembrete de Medicamento', text);
    speak(text);
    if ('vibrate' in navigator) {
      navigator.vibrate([500, 200, 500]);
    }
    
    if (nextTime < Date.now() + 60000) {
      stopReminderLoop();
    }
  };
  
  repeatReminder();
  activeReminderLoop = setInterval(repeatReminder, 10000);
}

function stopAlarmLoop() {
  if (activeAlarmLoop) clearInterval(activeAlarmLoop);
  activeAlarmLoop = null;
  currentActiveMed = null;
  document.getElementById('overlay').style.display = 'none';
  if ('vibrate' in navigator) {
    navigator.vibrate(0);
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
}

function stopReminderLoop() {
  if (activeReminderLoop) clearInterval(activeReminderLoop);
  activeReminderLoop = null;
  document.getElementById('reminderOverlay').style.display = 'none';
  if ('vibrate' in navigator) {
    navigator.vibrate(0);
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
}

// ===== AÇÕES DO USUÁRIO =====
document.getElementById('takenBtn').addEventListener('click', async () => {
  if (currentActiveMed) {
    const med = meds.find(m => m.id === currentActiveMed.id);
    if (med) {
      const now = Date.now();
      
      // Inicializa o array history se não existir
      if (!med.history) {
        med.history = [];
      }
      
      // Adiciona o timestamp atual ao histórico
      med.history.push(now);
      
      // Salva a atualização no IndexedDB
      await saveMedIDB(med);
      
      // Para o alarme e limpa o estado
      stopAlarmLoop();
      stopReminderLoop();
      
      // Limpa o estado do alarme para permitir o próximo
      delete lastTriggered[med.id];
      
      // Atualiza a lista para mostrar o histórico atualizado
      renderList();
      
      const dateStr = new Date(now).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      speak('Medicamento registrado como tomado.');
      console.log(`✅ ${med.name} registrado como tomado às ${dateStr}`);
    }
  }
});

document.getElementById('postpone30').addEventListener('click', () => handlePostpone(30));
document.getElementById('postpone60').addEventListener('click', () => handlePostpone(60));

async function handlePostpone(minutes) {
  if (currentActiveMed) {
    const med = currentActiveMed;
    const postponeMs = minutes * 60 * 1000;
    
    const { nextTime } = getNextAlarmTime(med);
    const newNextTime = nextTime + postponeMs;
    
    stopAlarmLoop();
    stopReminderLoop();
    
    lastTriggered[med.id] = newNextTime - 1;
    
    speak(`Lembrete adiado por ${minutes} minutos.`);
    console.log(`⏰ Lembrete de ${med.name} adiado por ${minutes} minutos.`);
    
    setTimeout(() => checkAlarms(), 1000);
  }
}

document.getElementById('reminderOkBtn').addEventListener('click', () => {
  stopReminderLoop();
});

function sendNotification(title, body, data) {
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: body,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">💊</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">💊</text></svg>',
        vibrate: [200, 100, 200],
        requireInteraction: true,
        data: data || {}
      });
    } catch (e) {
      console.error('Erro ao enviar notificação:', e);
    }
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        sendNotification(title, body, data);
      }
    });
  }
}

// Checa alarmes a cada 10 segundos
setInterval(checkAlarms, 10000);

// Executa a primeira checagem imediatamente
checkAlarms();
