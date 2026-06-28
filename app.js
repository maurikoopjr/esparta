// ============================================================
//  ESPARTA GYM — APLICAÇÃO COMPLETA v2.0
//  Backend: Supabase (PostgreSQL + Storage + Auth)
// ============================================================

const SUPABASE_URL      = 'https://hjcueeiahhxrsdkknoew.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ou0R3Sgs6d_brkdzgOs02Q_DrrJ0WQ5';

const sb = window.SupabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Gerador robusto de UUID v4 (bypassa limitações de conexões locais/inseguras)
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ============================================================
//  ESTADO GLOBAL
// ============================================================
let currentUser    = null;
let currentGym     = null;
let isOnline       = navigator.onLine;
let selectedDiaAluno = 'segunda';

// Caches locais
let cacheWorkouts    = [];
let cacheAssessments = [];
let cacheExercises   = [];
let cacheStudents    = [];
let cacheAllUsers    = [];

// Estado da Ficha do Aluno
let fichaStudent       = null;   // objeto do aluno aberto na ficha
let fichaWorkouts      = [];     // treinos do aluno na ficha
let fichaAssessments   = [];     // avaliações do aluno na ficha

// Estado do Montador de Treino
let activeStudentIdWorkout = null;
let modalWorkoutExercises  = [];
let activeWorkoutId        = null;

// Estado da Avaliação
let activeStudentIdAssessment = null;

// ============================================================
//  INICIALIZAÇÃO
// ============================================================
function initApp() {
  setupNetworkListeners();
  setupAuthListeners();
  setupViewNavigation();
  checkCachedSession();
  updateLoginBranding();
  setupLogoUploadPreview();
  setupVideoUploadPreview();
  setupExercisePicker();
  setupFichaListeners();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ============================================================
//  TOAST / SNACKBAR
// ============================================================
function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    info:    'fa-circle-info',
    warning: 'fa-triangle-exclamation'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// ============================================================
//  REDE
// ============================================================
function setupNetworkListeners() {
  const banner = document.getElementById('conn-banner');
  window.addEventListener('online',  () => { isOnline = true;  if(banner) banner.classList.remove('active'); runSync(); });
  window.addEventListener('offline', () => { isOnline = false; if(banner) banner.classList.add('active'); });
  if (!isOnline && banner) banner.classList.add('active');
}

// ============================================================
//  BRANDING (logo e nome da academia na tela de login)
// ============================================================
function updateLoginBranding() {
  const subtitle      = document.getElementById('login-subtitle');
  const logoCustom    = document.getElementById('login-logo-container');
  const logoDefault   = document.getElementById('login-default-logo');

  const cached = localStorage.getItem('esparta_gym');
  if (cached) {
    const gym = JSON.parse(cached);
    // Atualiza subtítulo com nome da academia
    if (subtitle) subtitle.innerText = (gym.nome || 'ESPARTA').toUpperCase();

    if (gym.logo_url) {
      // Academia tem logo customizada → mostra ela, esconde a padrão
      logoCustom.innerHTML = `<img src="${gym.logo_url}" alt="Logo da academia">`;
      logoCustom.style.display = 'flex';
      logoDefault.style.display  = 'none';
    } else {
      // Sem logo customizada → mostra a logo padrão Esparta
      logoCustom.style.display  = 'none';
      logoDefault.style.display = 'block';
      if (subtitle) subtitle.innerText = 'SISTEMA DE TREINO INTELIGENTE';
    }
  } else {
    // Sem dados de academia → logo padrão
    if (logoCustom)  logoCustom.style.display  = 'none';
    if (logoDefault) logoDefault.style.display = 'block';
    if (subtitle)    subtitle.innerText = 'SISTEMA DE TREINO INTELIGENTE';
  }
}

// ============================================================
//  AUTENTICAÇÃO
// ============================================================
function setupAuthListeners() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', handleLogin);
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');

  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> ENTRANDO...';
  btn.disabled = true;

  try {
    if (isOnline) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      if (data.user) {
        const { data: profile, error: pErr } = await sb
          .from('usuarios')
          .select('*')
          .eq('id', data.user.id)
          .maybeSingle();

        if (pErr) throw pErr;
        if (!profile) throw new Error('Perfil não encontrado. Contate o administrador.');

        currentUser = profile;
        localStorage.setItem('esparta_user', JSON.stringify(currentUser));

        // Busca a academia do usuário
        if (profile.academia_id) {
          const { data: gym } = await sb
            .from('academias')
            .select('*')
            .eq('id', profile.academia_id)
            .maybeSingle();
          if (gym) {
            currentGym = gym;
            localStorage.setItem('esparta_gym', JSON.stringify(gym));
            updateLoginBranding();
          }
        }

        navigateUser(currentUser);
        syncDownData();
      }
    } else {
      // Login Offline
      const users = JSON.parse(localStorage.getItem('esparta_cache_users') || '[]');
      const match = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (match) {
        currentUser = match;
        localStorage.setItem('esparta_user', JSON.stringify(match));
        navigateUser(currentUser);
      } else {
        throw new Error('Você está offline e este e-mail não foi encontrado no cache local.');
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> ENTRAR NO COMBATE';
    btn.disabled = false;
  }
}

function navigateUser(user) {
  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));

  if (user.tipo === 'master') {
    document.getElementById('master-view').classList.add('active');
    initMasterView();
  } else if (user.tipo === 'instrutor') {
    document.getElementById('instrutor-view').classList.add('active');
    initInstrutorView();
  } else {
    document.getElementById('aluno-view').classList.add('active');
    initAlunoView();
  }
}

async function logout() {
  try {
    await sb.auth.signOut();
  } catch (_) {}
  localStorage.removeItem('esparta_user');
  localStorage.removeItem('esparta_gym');
  currentUser = currentGym = null;
  cacheWorkouts = cacheAssessments = cacheExercises = cacheStudents = cacheAllUsers = [];

  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
  document.getElementById('ficha-aluno-view').classList.remove('active');
  document.getElementById('login-view').classList.add('active');
  updateLoginBranding();
}

function checkCachedSession() {
  const u = localStorage.getItem('esparta_user');
  const g = localStorage.getItem('esparta_gym');
  if (u) {
    currentUser = JSON.parse(u);
    if (g) currentGym = JSON.parse(g);
    navigateUser(currentUser);
    if (isOnline) syncDownData();
  }
}

// ============================================================
//  TOGGLE SENHA
// ============================================================
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.querySelector('i').className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    btn.querySelector('i').className = 'fa-solid fa-eye';
  }
}

// ============================================================
//  NAVEGAÇÃO
// ============================================================
function setupViewNavigation() {
  // Tabs aluno
  document.getElementById('btn-tab-treino').addEventListener('click',    () => switchAlunoTab('treino'));
  document.getElementById('btn-tab-avaliacao').addEventListener('click', () => switchAlunoTab('avaliacao'));

  // Tabs master
  document.getElementById('btn-master-alunos').addEventListener('click',    () => switchMasterTab('alunos'));
  document.getElementById('btn-master-exercicios').addEventListener('click', () => switchMasterTab('exercicios'));
  document.getElementById('btn-master-usuarios').addEventListener('click',  () => switchMasterTab('usuarios'));
  document.getElementById('btn-master-config').addEventListener('click',    () => switchMasterTab('config'));

  // Seletor de dias (aluno)
  document.querySelectorAll('#aluno-day-selector .day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#aluno-day-selector .day-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDiaAluno = btn.dataset.dia;
      renderAlunoWorkouts();
    });
  });

  // Sync manual
  document.getElementById('aluno-sync-btn').addEventListener('click', forceManualSync);
  document.getElementById('instrutor-sync-btn').addEventListener('click', forceManualSync);
  document.getElementById('master-sync-btn').addEventListener('click', forceManualSync);
}

function switchAlunoTab(tab) {
  document.getElementById('btn-tab-treino').classList.toggle('active', tab === 'treino');
  document.getElementById('btn-tab-avaliacao').classList.toggle('active', tab === 'avaliacao');
  document.getElementById('aluno-treino-subview').style.display    = tab === 'treino' ? 'flex' : 'none';
  document.getElementById('aluno-avaliacao-subview').style.display = tab === 'avaliacao' ? 'block' : 'none';

  if (tab === 'treino') renderAlunoWorkouts();
  else renderAlunoAssessments();
}

function switchMasterTab(tab) {
  ['alunos','exercicios','usuarios','config'].forEach(t => {
    document.getElementById(`btn-master-${t}`).classList.toggle('active', t === tab);
    const el = document.getElementById(`master-${t}-subview`);
    el.style.display = t === tab ? 'flex' : 'none';
  });
}

async function forceManualSync() {
  const btn = this instanceof HTMLElement ? this : null;
  if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i>'; btn.disabled = true; }
  try {
    if (isOnline) {
      await runSync();
      await syncDownData();
      showToast('Dados sincronizados!', 'success');
    } else {
      showToast('Sem conexão. Tente novamente mais tarde.', 'warning');
    }
  } catch (e) {
    showToast('Erro ao sincronizar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-rotate"></i>'; btn.disabled = false; }
  }
}

// ============================================================
//  SINCRONIZAÇÃO OFFLINE → ONLINE
// ============================================================
async function syncDownData() {
  if (!isOnline || !currentUser) return;
  const gymId = currentUser.academia_id;

  try {
    // Atualiza academia
    if (gymId) {
      const { data: gym } = await sb.from('academias').select('*').eq('id', gymId).maybeSingle();
      if (gym) {
        currentGym = gym;
        localStorage.setItem('esparta_gym', JSON.stringify(gym));
        updateLoginBranding();
        updateGymNameInHeaders(gym.nome, gym.logo_url);

      }
    }

    // Exercícios da academia
    const { data: exs } = await sb
      .from('exercicios_biblioteca')
      .select('*')
      .or(`academia_id.eq.${gymId},academia_id.is.null`)
      .order('nome');
    if (exs) {
      cacheExercises = exs;
      localStorage.setItem('esparta_cache_exercises', JSON.stringify(exs));
    }

    if (currentUser.tipo === 'aluno') {
      // Treinos do aluno
      const { data: ws } = await sb
        .from('treinos')
        .select('*, treino_exercicios(*, exercicios_biblioteca(*))')
        .eq('aluno_id', currentUser.id);
      if (ws) {
        cacheWorkouts = ws;
        localStorage.setItem('esparta_cache_workouts', JSON.stringify(ws));
        renderAlunoWorkouts();
      }

      // Avaliações do aluno
      const { data: as } = await sb
        .from('avaliacoes')
        .select('*')
        .eq('aluno_id', currentUser.id)
        .order('data', { ascending: false });
      if (as) {
        cacheAssessments = as;
        localStorage.setItem('esparta_cache_assessments', JSON.stringify(as));
      }
    } else {
      // Alunos da academia
      const { data: students } = await sb
        .from('usuarios')
        .select('*')
        .eq('academia_id', gymId)
        .eq('tipo', 'aluno')
        .order('nome');
      if (students) {
        cacheStudents = students;
        localStorage.setItem('esparta_cache_students', JSON.stringify(students));
        if (currentUser.tipo === 'instrutor') renderStudentList();
        if (currentUser.tipo === 'master') renderMasterStudentList();
      }

      if (currentUser.tipo === 'master') {
        const { data: allUsers } = await sb
          .from('usuarios')
          .select('*')
          .eq('academia_id', gymId)
          .order('nome');
        if (allUsers) {
          cacheAllUsers = allUsers;
          localStorage.setItem('esparta_cache_all_users', JSON.stringify(allUsers));
          renderMasterUsersList();
          renderMasterExerciseList();
        }
      }
    }
  } catch (err) {
    console.error('Erro no syncDown:', err);
  }
}

function updateGymNameInHeaders(nome, logoUrl) {
  // Atualiza textos
  ['aluno-gym-name','instrutor-gym-name','master-gym-name-display'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = nome || 'ESPARTA GYM';
  });

  // Atualiza mini-logos nos headers
  const roles = ['aluno', 'instrutor', 'master'];
  roles.forEach(role => {
    const logoEl = document.getElementById(`${role}-gym-logo`);
    if (logoEl) {
      if (logoUrl) {
        logoEl.innerHTML = `<img src="${logoUrl}" alt="Logo">`;
      } else {
        logoEl.innerHTML = `<span id="${role}-gym-inicial">${(nome || 'E').charAt(0).toUpperCase()}</span>`;
      }
    }
  });
}


// Fila de Sync offline → online
async function runSync() {
  if (!isOnline) return;
  const queue = JSON.parse(localStorage.getItem('esparta_sync_queue') || '[]');
  if (!queue.length) return;
  const failed = [];

  for (const item of queue) {
    try {
      if (item.tableName === 'workouts') {
        if (item.action === 'DELETE') {
          await sb.from('treinos').delete().eq('id', item.recordId);
        } else {
          await sb.from('treinos').upsert({ id: item.data.id, aluno_id: item.data.aluno_id, instrutor_id: item.data.instrutor_id, dias_semana: item.data.dias_semana, nome: item.data.nome || 'Treino' });
          await sb.from('treino_exercicios').delete().eq('treino_id', item.data.id);
          if (item.data.exercicios?.length > 0) {
            await sb.from('treino_exercicios').insert(item.data.exercicios.map(e => ({ treino_id: item.data.id, exercicio_id: e.exercicio_id, series: e.series, repeticoes: e.repeticoes, carga: e.carga || null, ordem: e.ordem })));
          }
        }
      } else if (item.tableName === 'assessments') {
        await sb.from('avaliacoes').upsert(item.data);
      } else if (item.tableName === 'exercises') {
        await sb.from('exercicios_biblioteca').upsert(item.data);
      } else if (item.tableName === 'gyms') {
        await sb.from('academias').update({ nome: item.data.nome, logo_url: item.data.logo_url }).eq('id', item.recordId);
      } else if (item.tableName === 'users') {
        await sb.from('usuarios').upsert(item.data);
      }
    } catch (e) {
      console.error('Sync falhou para item:', item, e);
      failed.push(item);
    }
  }
  localStorage.setItem('esparta_sync_queue', JSON.stringify(failed));
}

function enqueueSync(tableName, action, recordId, data) {
  const queue = JSON.parse(localStorage.getItem('esparta_sync_queue') || '[]');
  queue.push({ id: Date.now(), tableName, action, recordId, data });
  localStorage.setItem('esparta_sync_queue', JSON.stringify(queue));
}

// ============================================================
//  PLAYER DE VÍDEO EMBUTIDO
// ============================================================
function openVideoModal(videoUrl, nome = '', descricao = '') {
  const container = document.getElementById('video-player-container');
  const titleEl   = document.getElementById('video-modal-title');
  const descEl    = document.getElementById('video-modal-desc');
  const linkContainer = document.getElementById('video-modal-external-link-container');
  const linkEl        = document.getElementById('video-modal-external-link');

  titleEl.innerText = nome;
  descEl.innerText  = descricao;
  container.innerHTML = '';

  if (linkContainer && linkEl) {
    if (videoUrl) {
      linkEl.href = videoUrl;
      const isYoutube = videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be');
      linkEl.innerHTML = isYoutube
        ? '<i class="fa-brands fa-youtube"></i> Abrir no YouTube'
        : '<i class="fa-solid fa-up-right-from-square"></i> Abrir link do vídeo';
      linkContainer.style.display = 'block';
    } else {
      linkContainer.style.display = 'none';
    }
  }

  if (!videoUrl) {
    container.innerHTML = `
      <div class="video-no-url">
        <i class="fa-solid fa-video-slash"></i>
        <p>Nenhum vídeo cadastrado para este exercício.</p>
      </div>`;
  } else if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
    // Extrai ID do YouTube de forma extremamente robusta
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = videoUrl.match(regExp);
    const videoId = (match && match[2].length === 11) ? match[2] : videoUrl.split('/').pop();

    container.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  } else if (videoUrl.includes('vimeo.com')) {
    const vid = videoUrl.split('/').pop();
    container.innerHTML = `<iframe src="https://player.vimeo.com/video/${vid}?autoplay=1" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
  } else {
    // Arquivo de vídeo direto (MP4 do Storage)
    container.innerHTML = `<video src="${videoUrl}" controls autoplay playsinline style="width:100%;height:100%;"></video>`;
  }

  document.getElementById('modal-video').classList.add('active');
}

function closeVideoModal() {
  document.getElementById('modal-video').classList.remove('active');
  // Para o vídeo ao fechar
  const container = document.getElementById('video-player-container');
  container.innerHTML = '';
  const linkContainer = document.getElementById('video-modal-external-link-container');
  if (linkContainer) linkContainer.style.display = 'none';
}

// Fechar vídeo ao clicar no backdrop
document.getElementById('modal-video').addEventListener('click', function(e) {
  if (e.target === this) closeVideoModal();
});

// ============================================================
//  TELA DO ALUNO
// ============================================================
function initAlunoView() {
  if (currentGym) updateGymNameInHeaders(currentGym.nome, currentGym.logo_url);

  const nome = currentUser.nome || 'Guerreiro';
  document.getElementById('aluno-welcome-title').innerText = `Olá, ${nome.split(' ')[0]}`;
  document.getElementById('aluno-avatar').innerText = nome.charAt(0).toUpperCase();

  // Seleciona o dia atual
  const dias = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
  selectedDiaAluno = dias[new Date().getDay()];
  document.querySelectorAll('#aluno-day-selector .day-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.dia === selectedDiaAluno);
  });

  cacheWorkouts    = JSON.parse(localStorage.getItem('esparta_cache_workouts')    || '[]');
  cacheAssessments = JSON.parse(localStorage.getItem('esparta_cache_assessments') || '[]');
  renderAlunoWorkouts();
}

function renderAlunoWorkouts() {
  const container = document.getElementById('aluno-workout-list');
  const progressBar = document.getElementById('aluno-progress-bar-container');
  container.innerHTML = '';

  // Adiciona marcador de treino (ponto amarelo) nos botões de dia do aluno
  const activeDays = new Set();
  cacheWorkouts.forEach(w => {
    (w.dias_semana || []).forEach(d => activeDays.add(d.toLowerCase()));
  });
  document.querySelectorAll('#aluno-day-selector .day-btn').forEach(btn => {
    const dia = btn.dataset.dia.toLowerCase();
    btn.classList.toggle('has-workout', activeDays.has(dia));
  });

  const treinosDoDia = cacheWorkouts.filter(w =>
    (w.dias_semana || []).map(d => d.toLowerCase()).includes(selectedDiaAluno.toLowerCase())
  );

  if (treinosDoDia.length === 0) {
    progressBar.style.display = 'none';
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-mug-hot"></i>
        <h4>Nenhum treino para hoje</h4>
        <p>Dia de descanso também faz parte da evolução! 💪</p>
      </div>`;
    return;
  }

  const treino    = treinosDoDia[0];
  const exercicios = (treino.treino_exercicios || treino.exercicios || []).sort((a,b) => a.ordem - b.ordem);

  // Progresso
  progressBar.style.display = 'block';
  const done = exercicios.filter(e => e._done).length;
  document.getElementById('aluno-progress-text').innerText = `${done} de ${exercicios.length} exercícios`;
  document.getElementById('aluno-progress-pct').innerText  = `${Math.round((done/exercicios.length)*100)}%`;
  document.getElementById('aluno-progress-fill').style.width = `${(done/exercicios.length)*100}%`;

  exercicios.forEach((item, idx) => {
    const lib  = item.exercicios_biblioteca || cacheExercises.find(e => e.id === item.exercicio_id) || {};
    const nome = lib.nome || item.nome || 'Exercício';
    const desc = lib.descricao || item.descricao || '';
    const url  = lib.video_url || item.video_url || '';
    const isDone = !!item._done;

    const card = document.createElement('div');
    card.className = `exercise-card${isDone ? ' done' : ''}`;
    card.id = `ex-card-${idx}`;

    card.innerHTML = `
      <div class="exercise-order">${isDone ? '<i class="fa-solid fa-check"></i>' : idx + 1}</div>
      <div class="exercise-info">
        <h4>${nome}</h4>
        ${desc ? `<p>${desc}</p>` : ''}
        <div class="exercise-chips">
          <div class="chip"><i class="fa-solid fa-layer-group"></i> ${item.series}x</div>
          <div class="chip"><i class="fa-solid fa-repeat"></i> ${item.repeticoes}</div>
          ${item.carga ? `<div class="chip"><i class="fa-solid fa-weight-hanging"></i> ${item.carga}</div>` : ''}
        </div>
      </div>
      <div class="exercise-card-actions">
        ${url ? `<button class="video-btn" onclick="openVideoModal('${url}', '${nome.replace(/'/g,"\\'")}', '${desc.replace(/'/g,"\\'")}')">
          <i class="fa-solid fa-circle-play"></i>
        </button>` : ''}
        <button class="check-btn ${isDone ? 'checked' : ''}" onclick="toggleExerciseDone(${idx})" title="Marcar como feito">
          <i class="fa-solid ${isDone ? 'fa-check' : 'fa-circle-check'}"></i>
        </button>
      </div>`;

    container.appendChild(card);
  });
}

function toggleExerciseDone(idx) {
  if (!cacheWorkouts.length) return;
  const dias = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
  const treino = cacheWorkouts.find(w =>
    (w.dias_semana || []).map(d => d.toLowerCase()).includes(selectedDiaAluno.toLowerCase())
  );
  if (!treino) return;

  const exs = (treino.treino_exercicios || treino.exercicios || []).sort((a,b) => a.ordem - b.ordem);
  if (!exs[idx]) return;
  exs[idx]._done = !exs[idx]._done;

  renderAlunoWorkouts();
}

function renderAlunoAssessments() {
  const container = document.getElementById('aluno-assessments-list');
  container.innerHTML = '';

  if (!cacheAssessments.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-file-invoice"></i>
        <h4>Nenhuma avaliação</h4>
        <p>Solicite uma avaliação física ao seu instrutor.</p>
      </div>`;
    return;
  }

  cacheAssessments.forEach(item => {
    const m = item.medidas || {};
    const card = document.createElement('div');
    card.className = 'assessment-card';
    const dateFormatted = item.data ? new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR') : 'Data desconhecida';
    card.innerHTML = `
      <div class="assessment-header" onclick="toggleDetails('ass-det-${item.id}')">
        <h4><i class="fa-solid fa-calendar-check"></i> Avaliação de ${dateFormatted}</h4>
        <i class="fa-solid fa-chevron-down"></i>
      </div>
      <div class="assessment-details" id="ass-det-${item.id}">
        <div class="measures-grid">
          ${m.peso    ? `<div class="measure-tile"><span>PESO</span><strong>${m.peso} kg</strong></div>` : ''}
          ${m.altura  ? `<div class="measure-tile"><span>ALTURA</span><strong>${m.altura} m</strong></div>` : ''}
          ${m.gordura ? `<div class="measure-tile"><span>% GORDURA</span><strong>${m.gordura}%</strong></div>` : ''}
          ${m.peito   ? `<div class="measure-tile"><span>TÓRAX</span><strong>${m.peito} cm</strong></div>` : ''}
          ${m.braco_esquerdo  ? `<div class="measure-tile"><span>B. ESQ</span><strong>${m.braco_esquerdo} cm</strong></div>` : ''}
          ${m.braco_direito   ? `<div class="measure-tile"><span>B. DIR</span><strong>${m.braco_direito} cm</strong></div>` : ''}
          ${m.cintura  ? `<div class="measure-tile"><span>CINTURA</span><strong>${m.cintura} cm</strong></div>` : ''}
          ${m.quadril  ? `<div class="measure-tile"><span>QUADRIL</span><strong>${m.quadril} cm</strong></div>` : ''}
          ${m.coxa_esquerda ? `<div class="measure-tile"><span>C. ESQ</span><strong>${m.coxa_esquerda} cm</strong></div>` : ''}
          ${m.coxa_direita  ? `<div class="measure-tile"><span>C. DIR</span><strong>${m.coxa_direita} cm</strong></div>` : ''}
        </div>
        ${item.observacoes ? `<div class="obs-box"><h5>OBSERVAÇÕES DO INSTRUTOR</h5><p>${item.observacoes}</p></div>` : ''}
      </div>`;
    container.appendChild(card);
  });
}

function toggleDetails(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('active');
}

// ============================================================
//  TELA DO INSTRUTOR
// ============================================================
function initInstrutorView() {
  if (currentGym) updateGymNameInHeaders(currentGym.nome, currentGym.logo_url);
  cacheStudents = JSON.parse(localStorage.getItem('esparta_cache_students') || '[]');
  renderStudentList();

  const search = document.getElementById('student-search');
  if (!search._bound) {
    search.addEventListener('input', e => renderStudentList(e.target.value.trim()));
    search._bound = true;
  }
}

function renderStudentList(query = '') {
  const container = document.getElementById('student-list-container');
  container.innerHTML = '';

  const filtered = cacheStudents.filter(s =>
    s.nome.toLowerCase().includes(query.toLowerCase()) ||
    s.email.toLowerCase().includes(query.toLowerCase())
  );

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-user-xmark"></i><h4>Nenhum aluno encontrado</h4></div>`;
    return;
  }

  filtered.forEach(s => {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML = `
      <div class="user-card-left">
        <div class="avatar">${s.nome.charAt(0).toUpperCase()}</div>
        <div class="user-card-info">
          <h4>${s.nome}</h4>
          <p>${s.email}</p>
        </div>
      </div>
      <div style="display:flex; gap:6px; flex-shrink:0;">
        <button class="btn-primary" style="padding:8px 12px; font-size:12px;" onclick="openFichaAluno(${JSON.stringify(s).replace(/"/g,'&quot;')})">
          <i class="fa-solid fa-clipboard-list"></i> Ficha
        </button>
      </div>`;
    container.appendChild(card);
  });
}

// ============================================================
//  TELA DO MASTER
// ============================================================
function initMasterView() {
  if (currentGym) {
    updateGymNameInHeaders(currentGym.nome, currentGym.logo_url);
    const nameInput = document.getElementById('gym-name-input');
    if (nameInput) nameInput.value = currentGym.nome;
    if (currentGym.logo_url) {
      document.getElementById('gym-logo-preview-box').innerHTML = `<img src="${currentGym.logo_url}" alt="Logo">`;
    }
  }

  cacheStudents  = JSON.parse(localStorage.getItem('esparta_cache_students')   || '[]');
  cacheAllUsers  = JSON.parse(localStorage.getItem('esparta_cache_all_users')  || '[]');
  cacheExercises = JSON.parse(localStorage.getItem('esparta_cache_exercises')  || '[]');

  renderMasterStudentList();
  renderMasterExerciseList();
  renderMasterUsersList();

  // Buscas (com guard para não duplicar listeners)
  const mSearch = document.getElementById('master-student-search');
  if (!mSearch._bound) {
    mSearch.addEventListener('input', e => renderMasterStudentList(e.target.value.trim()));
    mSearch._bound = true;
  }
  const eSearch = document.getElementById('exercise-search');
  if (!eSearch._bound) {
    eSearch.addEventListener('input', e => renderMasterExerciseList(e.target.value.trim()));
    eSearch._bound = true;
  }
  const uSearch = document.getElementById('users-search');
  if (!uSearch._bound) {
    uSearch.addEventListener('input', e => renderMasterUsersList(e.target.value.trim()));
    uSearch._bound = true;
  }

  // FABs
  const addEx = document.getElementById('add-exercise-fab');
  if (!addEx._bound) {
    addEx.addEventListener('click', () => {
      document.getElementById('exercise-form').reset();
      document.getElementById('exercise-modal-title').innerText = 'Novo Exercício';
      document.getElementById('logo-upload-label') && (document.getElementById('video-upload-label').innerText = 'Clique para selecionar um vídeo');
      openModal('modal-exercise');
    });
    addEx._bound = true;
  }

  const addUser = document.getElementById('add-user-fab');
  if (!addUser._bound) {
    addUser.addEventListener('click', () => {
      document.getElementById('user-form').reset();
      openModal('modal-user');
    });
    addUser._bound = true;
  }

  const addStudent = document.getElementById('add-student-fab');
  if (!addStudent._bound) {
    addStudent.addEventListener('click', () => {
      document.getElementById('aluno-form').reset();
      openModal('modal-aluno');
    });
    addStudent._bound = true;
  }

  // Form: configurações academia
  const gymForm = document.getElementById('gym-settings-form');
  if (!gymForm._bound) {
    gymForm.addEventListener('submit', handleSaveGymSettings);
    gymForm._bound = true;
  }

  // Form: exercício
  const exForm = document.getElementById('exercise-form');
  if (!exForm._bound) {
    exForm.addEventListener('submit', handleSaveExercise);
    exForm._bound = true;
  }

  // Form: colaborador
  const userForm = document.getElementById('user-form');
  if (!userForm._bound) {
    userForm.addEventListener('submit', handleSaveUser);
    userForm._bound = true;
  }

  // Form: aluno
  const alunoForm = document.getElementById('aluno-form');
  if (!alunoForm._bound) {
    alunoForm.addEventListener('submit', handleSaveAluno);
    alunoForm._bound = true;
  }

  // Form: treino
  const workoutForm = document.getElementById('workout-form');
  if (!workoutForm._bound) {
    workoutForm.addEventListener('submit', handleSaveWorkout);
    workoutForm._bound = true;
  }

  // Form: avaliação
  const assForm = document.getElementById('assessment-form');
  if (!assForm._bound) {
    assForm.addEventListener('submit', handleSaveAssessment);
    assForm._bound = true;
  }

  // Form: editar aluno
  const editAlunoForm = document.getElementById('edit-aluno-form');
  if (!editAlunoForm._bound) {
    editAlunoForm.addEventListener('submit', handleEditStudent);
    editAlunoForm._bound = true;
  }

  // Form: editar colaborador
  const editUserForm = document.getElementById('edit-user-form');
  if (!editUserForm._bound) {
    editUserForm.addEventListener('submit', handleEditUser);
    editUserForm._bound = true;
  }
}

// --- Render: Lista de alunos (Master) ---
function renderMasterStudentList(query = '') {
  const container = document.getElementById('master-student-list-container');
  container.innerHTML = '';

  const filtered = cacheStudents.filter(s =>
    s.nome.toLowerCase().includes(query.toLowerCase()) ||
    s.email.toLowerCase().includes(query.toLowerCase())
  );

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-users-slash"></i><h4>Nenhum aluno cadastrado</h4><p>Use o botão + para cadastrar um aluno.</p></div>`;
    return;
  }

  filtered.forEach(s => {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML = `
      <div class="user-card-left">
        <div class="avatar">${s.nome.charAt(0).toUpperCase()}</div>
        <div class="user-card-info">
          <h4>${s.nome}</h4>
          <p>${s.email}</p>
          ${s.telefone ? `<small><i class="fa-solid fa-phone" style="font-size:10px;"></i> ${s.telefone}</small>` : ''}
        </div>
      </div>
      <button class="btn-primary" style="padding:9px 14px; font-size:12px; flex-shrink:0;"
        onclick="openFichaAluno(${JSON.stringify(s).replace(/"/g,'&quot;')})">
        <i class="fa-solid fa-clipboard-list"></i> Ficha
      </button>`;
    container.appendChild(card);
  });
}

// --- Render: Biblioteca de exercícios ---
function renderMasterExerciseList(query = '') {
  const container = document.getElementById('master-exercise-list');
  container.innerHTML = '';

  const filtered = cacheExercises.filter(e =>
    e.nome.toLowerCase().includes(query.toLowerCase()) ||
    (e.grupo_muscular || '').toLowerCase().includes(query.toLowerCase())
  );

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-dumbbell"></i><h4>Nenhum exercício cadastrado</h4><p>Use o botão + para adicionar exercícios.</p></div>`;
    return;
  }

  filtered.forEach(ex => {
    const card = document.createElement('div');
    card.className = 'exercise-lib-card';
    card.innerHTML = `
      <div class="exercise-lib-icon"><i class="fa-solid fa-dumbbell"></i></div>
      <div class="exercise-lib-info">
        <h4>${ex.nome}</h4>
        <p>${ex.descricao || 'Sem descrição.'}</p>
      </div>
      <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
        ${ex.grupo_muscular ? `<span class="exercise-lib-badge" style="margin:0;">${ex.grupo_muscular}</span>` : ''}
        ${ex.video_url ? `
          <button class="video-btn" onclick="openVideoModal('${ex.video_url}', '${ex.nome.replace(/'/g,"\\'")}', '${(ex.descricao||'').replace(/'/g,"\\'")}')" style="margin:0;">
            <i class="fa-solid fa-circle-play"></i>
          </button>` : ''}
        <button class="video-btn" style="background:rgba(255,255,255,0.08); border:1px solid var(--border-subtle); color:var(--text-white); margin:0;" onclick="openEditExerciseModal(${JSON.stringify(ex).replace(/"/g,'&quot;')})" title="Editar exercício">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
      </div>`;
    container.appendChild(card);
  });
}

// --- Render: Lista de usuários (Equipe) ---
function renderMasterUsersList(query = '') {
  const container = document.getElementById('master-users-list');
  container.innerHTML = '';

  const filtered = cacheAllUsers
    .filter(u => u.tipo !== 'aluno') // Só equipe aqui
    .filter(u =>
      u.nome.toLowerCase().includes(query.toLowerCase()) ||
      u.email.toLowerCase().includes(query.toLowerCase())
    );

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-user-shield"></i><h4>Nenhum colaborador cadastrado</h4></div>`;
    return;
  }

  filtered.forEach(u => {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.innerHTML = `
      <div class="user-card-left">
        <div class="avatar" style="${u.tipo === 'instrutor' ? 'background:rgba(10,132,255,0.15);border-color:rgba(10,132,255,0.4);color:#0A84FF;' : ''}">
          <i class="fa-solid ${u.tipo === 'master' ? 'fa-crown' : 'fa-user-tie'}"></i>
        </div>
        <div class="user-card-info">
          <h4>${u.nome}</h4>
          <p>${u.email}</p>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
        <span class="user-badge ${u.tipo}">${u.tipo.toUpperCase()}</span>
        <button class="btn-primary" style="padding:8px 12px; font-size:12px; background:var(--card-dark); border:1px solid var(--border-subtle); color:var(--text-white);" onclick="openEditUserModal(${JSON.stringify(u).replace(/"/g,'&quot;')})">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
      </div>`;
    container.appendChild(card);
  });
}

// ============================================================
//  FICHA DO ALUNO — TELA DESLIZANTE
// ============================================================
function setupFichaListeners() {
  document.getElementById('btn-ficha-treino').addEventListener('click', () => switchFichaTab('treino'));
  document.getElementById('btn-ficha-avaliacao').addEventListener('click', () => switchFichaTab('avaliacao'));

  document.getElementById('btn-add-workout-ficha').addEventListener('click', () => {
    if (!fichaStudent) return;
    openWorkoutModal(fichaStudent, null); // null = novo treino
  });

  document.getElementById('btn-add-assessment-ficha').addEventListener('click', () => {
    if (!fichaStudent) return;
    openAssessmentModal(fichaStudent.id, fichaStudent.nome);
  });
}

function openFichaAluno(student) {
  fichaStudent = typeof student === 'string' ? JSON.parse(student) : student;

  document.getElementById('ficha-aluno-nome').innerText  = fichaStudent.nome.toUpperCase();
  document.getElementById('ficha-aluno-email').innerText = fichaStudent.email;

  // Reseta tabs
  switchFichaTab('treino');

  // Mostra a ficha (animação CSS)
  const ficha = document.getElementById('ficha-aluno-view');
  ficha.style.display = 'flex';
  requestAnimationFrame(() => ficha.classList.add('active'));

  loadFichaWorkouts(fichaStudent.id);
}

function closeFichaAluno() {
  const ficha = document.getElementById('ficha-aluno-view');
  ficha.classList.remove('active');
  setTimeout(() => { ficha.style.display = 'none'; fichaStudent = null; }, 300);
}

function switchFichaTab(tab) {
  document.getElementById('btn-ficha-treino').classList.toggle('active',    tab === 'treino');
  document.getElementById('btn-ficha-avaliacao').classList.toggle('active', tab === 'avaliacao');
  document.getElementById('ficha-treino-subview').style.display    = tab === 'treino' ? 'block' : 'none';
  document.getElementById('ficha-avaliacao-subview').style.display = tab === 'avaliacao' ? 'block' : 'none';

  if (tab === 'avaliacao' && fichaStudent) loadFichaAssessments(fichaStudent.id);
}

async function loadFichaWorkouts(studentId) {
  const container = document.getElementById('ficha-workout-list');
  container.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="margin-top:8px;opacity:0.6;"></div>';

  try {
    let workouts = [];
    if (isOnline) {
      const { data } = await sb
        .from('treinos')
        .select('*, treino_exercicios(*, exercicios_biblioteca(*))')
        .eq('aluno_id', studentId)
        .order('created_at');
      workouts = data || [];
    } else {
      workouts = (JSON.parse(localStorage.getItem('esparta_cache_workouts') || '[]'))
        .filter(w => w.aluno_id === studentId);
    }
    fichaWorkouts = workouts;
    renderFichaWorkouts();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h4>Erro ao carregar treinos</h4><p>${err.message}</p></div>`;
  }
}

function renderFichaWorkouts() {
  const container = document.getElementById('ficha-workout-list');
  container.innerHTML = '';

  if (!fichaWorkouts.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-dumbbell"></i><h4>Nenhum treino cadastrado</h4><p>Clique em "Novo Treino" para criar o primeiro treino deste aluno.</p></div>`;
    return;
  }

  fichaWorkouts.forEach(treino => {
    const exs = (treino.treino_exercicios || treino.exercicios || []).sort((a,b) => a.ordem - b.ordem);
    const card = document.createElement('div');
    card.className = 'ficha-workout-card';

    const daysHtml = (treino.dias_semana || []).map(d =>
      `<span class="day-chip">${d.toUpperCase().substring(0,3)}</span>`
    ).join('');

    const exsHtml = exs.slice(0,5).map((item, idx) => {
      const lib = item.exercicios_biblioteca || cacheExercises.find(e => e.id === item.exercicio_id) || {};
      const nome = lib.nome || item.nome || 'Exercício';
      return `
        <div class="ficha-exercise-row">
          <div class="ex-num">${idx+1}</div>
          <div class="ex-name">${nome}</div>
          <div class="ex-params">${item.series}x${item.repeticoes}${item.carga ? ' · '+item.carga : ''}</div>
        </div>`;
    }).join('');

    const moreCount = exs.length > 5 ? exs.length - 5 : 0;

    card.innerHTML = `
      <div class="ficha-workout-card-header">
        <div>
          <h4>${treino.nome || 'Treino'}</h4>
          <div class="day-chips" style="margin-top:6px;">${daysHtml}</div>
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button class="btn-icon" title="Editar treino"
            onclick="openWorkoutModal(fichaStudent, ${JSON.stringify(treino).replace(/"/g,'&quot;')})">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-icon danger" title="Excluir treino" onclick="deleteWorkout('${treino.id}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
      <div class="ficha-workout-exercises">
        ${exsHtml}
        ${moreCount > 0 ? `<div style="font-size:12px; color:var(--text-grey); padding:4px 0;">+ ${moreCount} exercícios...</div>` : ''}
      </div>`;

    container.appendChild(card);
  });
}

async function loadFichaAssessments(studentId) {
  const container = document.getElementById('ficha-assessment-list');
  container.innerHTML = '<div class="skeleton"></div>';

  try {
    let assessments = [];
    if (isOnline) {
      const { data } = await sb
        .from('avaliacoes')
        .select('*')
        .eq('aluno_id', studentId)
        .order('data', { ascending: false });
      assessments = data || [];
    }
    fichaAssessments = assessments;
    renderFichaAssessments();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h4>Erro ao carregar avaliações</h4></div>`;
  }
}

function renderFichaAssessments() {
  const container = document.getElementById('ficha-assessment-list');
  container.innerHTML = '';

  if (!fichaAssessments.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-file-invoice"></i><h4>Nenhuma avaliação</h4><p>Clique em "Nova Avaliação" para registrar a primeira avaliação deste aluno.</p></div>`;
    return;
  }

  fichaAssessments.forEach(item => {
    const m = item.medidas || {};
    const dateFormatted = item.data ? new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR') : '';
    const card = document.createElement('div');
    card.className = 'assessment-card';
    card.innerHTML = `
      <div class="assessment-header" onclick="toggleDetails('fa-det-${item.id}')">
        <h4><i class="fa-solid fa-calendar-check"></i> ${dateFormatted}</h4>
        <i class="fa-solid fa-chevron-down"></i>
      </div>
      <div class="assessment-details" id="fa-det-${item.id}">
        <div class="measures-grid">
          ${m.peso    ? `<div class="measure-tile"><span>PESO</span><strong>${m.peso} kg</strong></div>` : ''}
          ${m.altura  ? `<div class="measure-tile"><span>ALTURA</span><strong>${m.altura} m</strong></div>` : ''}
          ${m.gordura ? `<div class="measure-tile"><span>% GORDURA</span><strong>${m.gordura}%</strong></div>` : ''}
          ${m.peito   ? `<div class="measure-tile"><span>TÓRAX</span><strong>${m.peito} cm</strong></div>` : ''}
        </div>
        ${item.observacoes ? `<div class="obs-box"><h5>OBSERVAÇÕES</h5><p>${item.observacoes}</p></div>` : ''}
      </div>`;
    container.appendChild(card);
  });
}

async function deleteWorkout(workoutId) {
  if (!confirm('Tem certeza que deseja excluir este treino?')) return;
  fichaWorkouts = fichaWorkouts.filter(w => w.id !== workoutId);
  renderFichaWorkouts();
  if (isOnline) {
    await sb.from('treinos').delete().eq('id', workoutId);
  } else {
    enqueueSync('workouts', 'DELETE', workoutId, null);
  }
  showToast('Treino excluído.', 'info');
}

// ============================================================
//  MONTADOR DE TREINO — MODAL
// ============================================================
function setupExercisePicker() {
  const searchInput = document.getElementById('exercise-picker-search');
  const results     = document.getElementById('exercise-picker-results');

  searchInput.addEventListener('focus', () => {
    renderPickerResults(searchInput.value);
    results.classList.add('open');
  });

  searchInput.addEventListener('input', () => {
    renderPickerResults(searchInput.value);
    results.classList.add('open');
  });

  // Fecha ao clicar fora
  document.addEventListener('click', e => {
    if (!e.target.closest('.exercise-picker')) {
      results.classList.remove('open');
    }
  });
}

function renderPickerResults(query = '') {
  const results = document.getElementById('exercise-picker-results');
  results.innerHTML = '';

  const filtered = cacheExercises.filter(e =>
    e.nome.toLowerCase().includes(query.toLowerCase()) ||
    (e.grupo_muscular || '').toLowerCase().includes(query.toLowerCase())
  ).slice(0, 20);

  if (!filtered.length) {
    results.innerHTML = '<div class="picker-item" style="color:var(--text-grey);">Nenhum exercício encontrado.</div>';
    return;
  }

  filtered.forEach(ex => {
    const item = document.createElement('div');
    item.className = 'picker-item';
    item.innerHTML = `
      <span>${ex.nome}</span>
      ${ex.grupo_muscular ? `<span class="picker-group">${ex.grupo_muscular}</span>` : ''}`;
    item.addEventListener('click', () => {
      addExerciseToList(ex);
      document.getElementById('exercise-picker-search').value = '';
      document.getElementById('exercise-picker-results').classList.remove('open');
    });
    results.appendChild(item);
  });
}

function addExerciseToList(ex) {
  modalWorkoutExercises.push({
    exercicio_id: ex.id,
    nome: ex.nome,
    grupo_muscular: ex.grupo_muscular || '',
    series: 3,
    repeticoes: '12',
    carga: '',
    ordem: modalWorkoutExercises.length
  });
  renderWorkoutEditorExercises();
}

function renderWorkoutEditorExercises() {
  const container = document.getElementById('workout-exercise-list-editor');
  container.innerHTML = '';

  if (!modalWorkoutExercises.length) {
    container.innerHTML = `<p style="color:var(--text-dim); font-size:13px; text-align:center; padding:16px 0;">Busque e adicione exercícios acima.</p>`;
    return;
  }

  modalWorkoutExercises.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'workout-ex-row';
    row.innerHTML = `
      <div class="ex-name-label" title="${item.nome}">${item.nome}</div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
        <input class="workout-ex-input" type="number" min="1" max="20" value="${item.series}"
          onchange="updateWExParam(${idx},'series',this.value)" title="Séries">
        <span class="workout-ex-label">SÉR</span>
      </div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
        <input class="workout-ex-input wide" type="text" value="${item.repeticoes}"
          onchange="updateWExParam(${idx},'repeticoes',this.value)" placeholder="12" title="Repetições">
        <span class="workout-ex-label">REP</span>
      </div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
        <input class="workout-ex-input wide" type="text" value="${item.carga || ''}"
          onchange="updateWExParam(${idx},'carga',this.value)" placeholder="80kg" title="Carga">
        <span class="workout-ex-label">CARGA</span>
      </div>
      <button type="button" class="btn-icon danger" onclick="removeWEx(${idx})" title="Remover">
        <i class="fa-solid fa-xmark"></i>
      </button>`;
    container.appendChild(row);
  });
}

function updateWExParam(idx, key, value) {
  if (key === 'series') modalWorkoutExercises[idx][key] = parseInt(value) || 1;
  else modalWorkoutExercises[idx][key] = value;
}

function removeWEx(idx) {
  modalWorkoutExercises.splice(idx, 1);
  modalWorkoutExercises.forEach((e, i) => e.ordem = i);
  renderWorkoutEditorExercises();
}

// Abre o modal de treino: student = objeto aluno, treino = objeto treino existente ou null
async function openWorkoutModal(student, treino = null) {
  if (typeof student === 'string') student = JSON.parse(student);
  activeStudentIdWorkout = student.id;
  activeWorkoutId = treino ? treino.id : null;
  modalWorkoutExercises = [];

  document.getElementById('workout-modal-title').innerText = `TREINO — ${student.nome.toUpperCase()}`;
  document.getElementById('workout-nome').value = treino ? (treino.nome || '') : '';

  // Monta toggles de dia
  const container = document.getElementById('workout-days-checkboxes');
  container.innerHTML = '';
  const dias = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
  const diasSalvos = treino ? (treino.dias_semana || []) : [];

  dias.forEach(dia => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-toggle' + (diasSalvos.includes(dia) ? ' active' : '');
    btn.textContent = dia.substring(0,3).toUpperCase();
    btn.dataset.dia = dia;
    btn.addEventListener('click', () => btn.classList.toggle('active'));
    container.appendChild(btn);
  });

  // Preenche exercícios existentes
  if (treino) {
    const exs = (treino.treino_exercicios || treino.exercicios || []).sort((a,b) => a.ordem - b.ordem);
    exs.forEach(item => {
      const lib = item.exercicios_biblioteca || cacheExercises.find(e => e.id === item.exercicio_id) || {};
      modalWorkoutExercises.push({
        exercicio_id: item.exercicio_id,
        nome: lib.nome || item.nome || 'Exercício',
        grupo_muscular: lib.grupo_muscular || '',
        series: item.series || 3,
        repeticoes: item.repeticoes || '12',
        carga: item.carga || '',
        ordem: item.ordem || 0
      });
    });
  }

  // Limpa picker
  document.getElementById('exercise-picker-search').value = '';
  document.getElementById('exercise-picker-results').classList.remove('open');
  renderPickerResults('');
  renderWorkoutEditorExercises();

  openModal('modal-workout');
}

async function handleSaveWorkout(e) {
  e.preventDefault();

  const nome = document.getElementById('workout-nome').value.trim() || 'Treino';
  const dias = Array.from(document.querySelectorAll('#workout-days-checkboxes .day-toggle.active'))
    .map(b => b.dataset.dia);

  if (!dias.length) {
    showToast('Selecione pelo menos um dia da semana.', 'warning');
    return;
  }
  if (!modalWorkoutExercises.length) {
    showToast('Adicione pelo menos um exercício ao treino.', 'warning');
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> SALVANDO...';
  btn.disabled = true;

  try {
    let workoutId = activeWorkoutId;

    if (isOnline) {
      if (workoutId) {
        // Atualiza treino existente
        const { error } = await sb.from('treinos')
          .update({ nome, dias_semana: dias })
          .eq('id', workoutId);
        if (error) throw error;
      } else {
        // Novo treino — deixa o Supabase gerar o UUID
        const { data: novo, error } = await sb.from('treinos')
          .insert({ nome, aluno_id: activeStudentIdWorkout, instrutor_id: currentUser.id, dias_semana: dias })
          .select()
          .maybeSingle();
        if (error) throw error;
        workoutId = novo.id;
      }

      // Apaga exercícios antigos e reinsere
      await sb.from('treino_exercicios').delete().eq('treino_id', workoutId);

      if (modalWorkoutExercises.length) {
        const { error: exErr } = await sb.from('treino_exercicios').insert(
          modalWorkoutExercises.map((ex, idx) => ({
            treino_id:    workoutId,
            exercicio_id: ex.exercicio_id,
            series:       parseInt(ex.series) || 3,
            repeticoes:   ex.repeticoes || '12',
            carga:        ex.carga || null,
            ordem:        idx
          }))
        );
        if (exErr) throw exErr;
      }
    } else {
      // Offline — gera UUID local e enfileira
      workoutId = workoutId || generateUUID();
      enqueueSync('workouts', 'UPSERT', workoutId, {
        id: workoutId, nome,
        aluno_id: activeStudentIdWorkout,
        instrutor_id: currentUser.id,
        dias_semana: dias,
        exercicios: modalWorkoutExercises
      });
    }

    closeModal('modal-workout');
    showToast('Treino salvo com sucesso! 💪', 'success');

    // Recarrega a ficha do aluno
    if (fichaStudent && fichaStudent.id === activeStudentIdWorkout) {
      await loadFichaWorkouts(fichaStudent.id);
    }
  } catch (err) {
    showToast('Erro ao salvar treino: ' + err.message, 'error');
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> SALVAR TREINO';
    btn.disabled = false;
  }
}


// ============================================================
//  AVALIAÇÃO FÍSICA
// ============================================================
function openAssessmentModal(studentId, studentName) {
  activeStudentIdAssessment = studentId;
  document.getElementById('assessment-modal-title').innerText = `AVALIAÇÃO — ${(studentName || '').toUpperCase()}`;
  document.getElementById('assessment-form').reset();
  openModal('modal-assessment');
}

async function handleSaveAssessment(e) {
  e.preventDefault();

  const btn = e.target.querySelector('button[type="submit"]');
  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> SALVANDO...';
  btn.disabled = true;

  const medidas = {
    peso:           document.getElementById('ass-peso').value    || null,
    altura:         document.getElementById('ass-altura').value  || null,
    gordura:        document.getElementById('ass-gordura').value || null,
    peito:          document.getElementById('ass-peito').value   || null,
    braco_esquerdo: document.getElementById('ass-b-esq').value   || null,
    braco_direito:  document.getElementById('ass-b-dir').value   || null,
    cintura:        document.getElementById('ass-cintura').value || null,
    quadril:        document.getElementById('ass-quadril').value || null,
    coxa_esquerda:  document.getElementById('ass-c-esq').value   || null,
    coxa_direita:   document.getElementById('ass-c-dir').value   || null,
  };

  const obj = {
    id: generateUUID(),
    aluno_id: activeStudentIdAssessment,
    instrutor_id: currentUser.id,
    observacoes: document.getElementById('ass-obs').value.trim() || null,
    medidas,
    data: new Date().toISOString().substring(0, 10)
  };

  try {
    if (isOnline) {
      await sb.from('avaliacoes').insert(obj);
    } else {
      enqueueSync('assessments', 'UPSERT', obj.id, obj);
    }
    closeModal('modal-assessment');
    showToast('Avaliação salva!', 'success');

    // Recarrega avaliações na ficha se estiver aberta
    if (fichaStudent && fichaStudent.id === activeStudentIdAssessment) {
      await loadFichaAssessments(fichaStudent.id);
    }
  } catch (err) {
    showToast('Erro ao salvar avaliação: ' + err.message, 'error');
  } finally {
    btn.innerHTML = 'SALVAR AVALIAÇÃO';
    btn.disabled = false;
  }
}

// ============================================================
//  EXERCÍCIOS — BIBLIOTECA
// ============================================================
function setupVideoUploadPreview() {
  const fileInput = document.getElementById('ex-video-file');
  const zone      = document.getElementById('video-upload-zone');
  const label     = document.getElementById('video-upload-label');

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      const f = fileInput.files[0];
      const mb = (f.size / 1024 / 1024).toFixed(1);
      label.innerText = `📹 ${f.name} (${mb} MB)`;
      zone.style.borderColor = 'var(--primary-yellow)';
    } else {
      label.innerText = 'Clique para selecionar um vídeo';
      zone.style.borderColor = '';
    }
  });
}

async function handleSaveExercise(e) {
  e.preventDefault();

  const nome       = document.getElementById('ex-name').value.trim();
  const grupo      = document.getElementById('ex-group').value;
  const descricao  = document.getElementById('ex-desc').value.trim();
  let videoUrl     = document.getElementById('ex-video').value.trim();
  const fileInput  = document.getElementById('ex-video-file');
  const progressEl = document.getElementById('video-upload-progress');
  const fillEl     = document.getElementById('video-progress-fill');
  const textEl     = document.getElementById('video-progress-text');

  const btn = e.target.querySelector('button[type="submit"]');
  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> SALVANDO...';
  btn.disabled = true;

  // Upload de vídeo para Supabase Storage
  if (fileInput.files.length && isOnline) {
    try {
      const file = fileInput.files[0];
      if (file.size > 100 * 1024 * 1024) throw new Error('Vídeo muito grande. Máximo 100MB.');

      progressEl.style.display = 'block';
      fillEl.style.width = '20%';
      textEl.innerText = 'Enviando vídeo...';

      const fileName = `${currentUser.academia_id}/${Date.now()}_${file.name.replace(/\s/g,'_')}`;
      const { data, error } = await sb.storage.from('exercicios').upload(fileName, file, { upsert: true });
      if (error) throw error;

      fillEl.style.width = '90%';
      const { data: pub } = sb.storage.from('exercicios').getPublicUrl(fileName);
      videoUrl = pub.publicUrl;

      fillEl.style.width = '100%';
      textEl.innerText = 'Upload concluído!';
      setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
    } catch (err) {
      showToast('Erro no upload do vídeo: ' + err.message, 'error');
      progressEl.style.display = 'none';
    }
  }

  const exObj = {
    nome,
    grupo_muscular: grupo || null,
    descricao: descricao || null,
    video_url: videoUrl || null,
    academia_id: currentUser.academia_id
  };

  try {
    if (activeEditExerciseId) {
      // Editar exercício existente
      exObj.id = activeEditExerciseId;
      if (isOnline) {
        const { error } = await sb.from('exercicios_biblioteca').update(exObj).eq('id', activeEditExerciseId);
        if (error) throw error;
      } else {
        enqueueSync('exercises', 'UPSERT', activeEditExerciseId, exObj);
      }

      // Atualiza cache local
      const idx = cacheExercises.findIndex(e => e.id === activeEditExerciseId);
      if (idx !== -1) {
        cacheExercises[idx] = exObj;
      }
      showToast('Exercício atualizado com sucesso! 💪', 'success');
    } else {
      // Criar novo exercício
      const exId = generateUUID();
      exObj.id = exId;
      if (isOnline) {
        const { error } = await sb.from('exercicios_biblioteca').insert(exObj);
        if (error) throw error;
      } else {
        enqueueSync('exercises', 'UPSERT', exId, exObj);
      }
      cacheExercises.push(exObj);
      showToast('Exercício salvo com sucesso! 💪', 'success');
    }

    localStorage.setItem('esparta_cache_exercises', JSON.stringify(cacheExercises));
    renderMasterExerciseList();
    closeModal('modal-exercise');
    document.getElementById('exercise-form').reset();
  } catch (err) {
    showToast('Erro ao salvar exercício: ' + err.message, 'error');
  } finally {
    btn.innerHTML = 'SALVAR EXERCÍCIO';
    btn.disabled = false;
  }
}

let activeEditExerciseId = null;

function openEditExerciseModal(ex) {
  if (typeof ex === 'string') ex = JSON.parse(ex);
  activeEditExerciseId = ex.id;

  document.getElementById('exercise-modal-title').innerText = 'Editar Exercício';
  document.getElementById('ex-name').value = ex.nome || '';
  document.getElementById('ex-group').value = ex.grupo_muscular || '';
  document.getElementById('ex-desc').value = ex.descricao || '';
  document.getElementById('ex-video').value = ex.video_url || '';
  document.getElementById('ex-video-file').value = '';
  document.getElementById('video-upload-label').innerText = ex.video_url ? '📹 Vídeo já cadastrado' : 'Clique para selecionar um vídeo';
  document.getElementById('video-upload-progress').style.display = 'none';

  // Mostra o botão de excluir
  document.getElementById('delete-exercise-btn').style.display = 'block';

  openModal('modal-exercise');
}

async function confirmDeleteExercise() {
  if (!activeEditExerciseId) return;
  const name = document.getElementById('ex-name').value;
  if (!confirm(`ATENÇÃO:\nTem certeza que deseja excluir permanentemente o exercício "${name}"?\nEle será removido da biblioteca (exercícios já vinculados a treinos de alunos continuarão nos treinos, mas não aparecerão mais na biblioteca).`)) {
    return;
  }

  const btn = document.getElementById('delete-exercise-btn');
  btn.disabled = true;

  try {
    if (isOnline) {
      const { error } = await sb.from('exercicios_biblioteca').delete().eq('id', activeEditExerciseId);
      if (error) throw error;
    } else {
      enqueueSync('exercises', 'DELETE', activeEditExerciseId, null);
    }

    // Remove do cache
    cacheExercises = cacheExercises.filter(e => e.id !== activeEditExerciseId);
    localStorage.setItem('esparta_cache_exercises', JSON.stringify(cacheExercises));

    renderMasterExerciseList();
    closeModal('modal-exercise');
    showToast('Exercício excluído com sucesso! 🗑️', 'info');
  } catch (err) {
    showToast('Erro ao excluir exercício: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
//  CADASTRO DE ALUNO (signUp padrão — sem Admin API)
// ============================================================
async function handleSaveAluno(e) {
  e.preventDefault();
  const nome      = document.getElementById('aluno-name').value.trim();
  const email     = document.getElementById('aluno-email').value.trim();
  const phone     = document.getElementById('aluno-phone').value.trim();
  const birthdate = document.getElementById('aluno-birthdate').value;
  const password  = document.getElementById('aluno-password').value;

  const btn = document.getElementById('cadastrar-aluno-btn');
  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> CADASTRANDO...';
  btn.disabled = true;

  try {
    if (!isOnline) throw new Error('É necessário estar online para cadastrar um aluno.');

    if (password && password.length >= 6) {
      // Usa signUp padrão — funciona com chave anon, não precisa de Admin API
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { nome, tipo: 'aluno', academia_id: currentUser.academia_id }
        }
      });
      if (error) throw error;

      // Aguarda o trigger criar o perfil, depois atualiza campos extras
      await new Promise(r => setTimeout(r, 900));
      if (data.user) {
        await sb.from('usuarios').update({
          telefone: phone || null,
          data_nascimento: birthdate || null
        }).eq('id', data.user.id);
      }

      const userObj = {
        id: data?.user?.id || ('usr_' + Date.now()),
        nome, email,
        telefone: phone || null,
        data_nascimento: birthdate || null,
        tipo: 'aluno',
        academia_id: currentUser.academia_id
      };
      cacheStudents.push(userObj);
      cacheAllUsers.push(userObj);
      localStorage.setItem('esparta_cache_students', JSON.stringify(cacheStudents));
      renderMasterStudentList();
      closeModal('modal-aluno');
      showToast(`✅ Aluno ${nome} cadastrado! Senha: ${password}`, 'success', 6000);
    } else {
      // Sem senha — só insere o perfil, aluno cria conta depois via "esqueci minha senha"
      const tempId = generateUUID();
      const userObj = {
        id: tempId,
        nome, email,
        telefone: phone || null,
        data_nascimento: birthdate || null,
        tipo: 'aluno',
        academia_id: currentUser.academia_id
      };
      const { error } = await sb.from('usuarios').insert(userObj);
      if (error && !error.message.includes('duplicate')) throw error;

      cacheStudents.push(userObj);
      cacheAllUsers.push(userObj);
      localStorage.setItem('esparta_cache_students', JSON.stringify(cacheStudents));
      renderMasterStudentList();
      closeModal('modal-aluno');
      showToast(`Aluno ${nome} adicionado! Peça para ele criar a conta com o e-mail informado.`, 'info', 7000);
    }

  } catch (err) {
    showToast('Erro ao cadastrar aluno: ' + err.message, 'error');
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> CADASTRAR';
    btn.disabled = false;
  }
}

// ============================================================
//  EDIÇÃO DE CADASTRO DO ALUNO
// ============================================================
function openEditStudentModal() {
  if (!fichaStudent) return;
  document.getElementById('edit-aluno-id').value = fichaStudent.id;
  document.getElementById('edit-aluno-name').value = fichaStudent.nome || '';
  document.getElementById('edit-aluno-email').value = fichaStudent.email || '';
  document.getElementById('edit-aluno-phone').value = fichaStudent.telefone || '';
  document.getElementById('edit-aluno-birthdate').value = fichaStudent.data_nascimento || '';
  document.getElementById('edit-aluno-password').value = '';
  openModal('modal-edit-aluno');
}

async function handleEditStudent(e) {
  e.preventDefault();
  const id        = document.getElementById('edit-aluno-id').value;
  const nome      = document.getElementById('edit-aluno-name').value.trim();
  const email     = document.getElementById('edit-aluno-email').value.trim();
  const phone     = document.getElementById('edit-aluno-phone').value.trim();
  const birthdate = document.getElementById('edit-aluno-birthdate').value;
  const password  = document.getElementById('edit-aluno-password').value;

  const btn = document.getElementById('edit-aluno-btn');
  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> SALVANDO...';
  btn.disabled = true;

  try {
    if (!isOnline) throw new Error('É necessário estar online para editar os dados do aluno.');

    // Executa a RPC segura para atualizar dados no usuarios e no auth.users
    const { error } = await sb.rpc('admin_update_user', {
      target_user_id: id,
      new_nome: nome,
      new_email: email,
      new_phone: phone || null,
      new_birthdate: birthdate || null,
      new_password: password || null,
      new_tipo: 'aluno'
    });

    if (error) throw error;

    // Atualiza cache local de alunos
    const idx = cacheStudents.findIndex(s => s.id === id);
    if (idx !== -1) {
      cacheStudents[idx].nome = nome;
      cacheStudents[idx].email = email;
      cacheStudents[idx].telefone = phone || null;
      cacheStudents[idx].data_nascimento = birthdate || null;
      localStorage.setItem('esparta_cache_students', JSON.stringify(cacheStudents));
    }

    // Atualiza cache local de equipe
    const idxAll = cacheAllUsers.findIndex(u => u.id === id);
    if (idxAll !== -1) {
      cacheAllUsers[idxAll].nome = nome;
      cacheAllUsers[idxAll].email = email;
      cacheAllUsers[idxAll].telefone = phone || null;
      cacheAllUsers[idxAll].data_nascimento = birthdate || null;
      localStorage.setItem('esparta_cache_all_users', JSON.stringify(cacheAllUsers));
    }

    // Se o aluno editado for o que está aberto na Ficha, atualiza a tela
    if (fichaStudent && fichaStudent.id === id) {
      fichaStudent.nome = nome;
      fichaStudent.email = email;
      fichaStudent.telefone = phone || null;
      fichaStudent.data_nascimento = birthdate || null;
      document.getElementById('ficha-aluno-nome').innerText = nome.toUpperCase();
      document.getElementById('ficha-aluno-email').innerText = email;
    }

    renderMasterStudentList();
    closeModal('modal-edit-aluno');
    showToast('Cadastro do aluno atualizado com sucesso! 💪', 'success');
  } catch (err) {
    showToast('Erro ao atualizar cadastro: ' + err.message, 'error');
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> SALVAR ALTERAÇÕES';
    btn.disabled = false;
  }
}

async function confirmDeleteAluno() {
  const id = document.getElementById('edit-aluno-id').value;
  const name = document.getElementById('edit-aluno-name').value;
  if (!confirm(`ATENÇÃO:\nTem certeza que deseja excluir permanentemente o aluno "${name}"?\nTodos os treinos e avaliações físicas dele serão apagados e a conta dele será deletada.`)) {
    return;
  }

  const btn = document.getElementById('edit-aluno-btn');
  btn.disabled = true;

  try {
    if (!isOnline) throw new Error('É necessário estar online para excluir um aluno.');

    // Chama RPC para exclusão completa
    const { error } = await sb.rpc('admin_delete_user', { target_user_id: id });
    if (error) throw error;

    // Remove dos caches locais
    cacheStudents = cacheStudents.filter(s => s.id !== id);
    cacheAllUsers = cacheAllUsers.filter(u => u.id !== id);
    localStorage.setItem('esparta_cache_students', JSON.stringify(cacheStudents));
    localStorage.setItem('esparta_cache_all_users', JSON.stringify(cacheAllUsers));

    // Fecha a ficha se ela for deste aluno
    if (fichaStudent && fichaStudent.id === id) {
      closeFichaAluno();
    }

    renderMasterStudentList();
    closeModal('modal-edit-aluno');
    showToast('Aluno excluído com sucesso! 🗑️', 'info');
  } catch (err) {
    showToast('Erro ao excluir aluno: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
//  EDIÇÃO E EXCLUSÃO DE MEMBROS DA EQUIPE
// ============================================================
let activeEditUserId = null;

function openEditUserModal(user) {
  if (typeof user === 'string') user = JSON.parse(user);
  activeEditUserId = user.id;
  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-user-name').value = user.nome || '';
  document.getElementById('edit-user-email').value = user.email || '';
  document.getElementById('edit-user-password').value = '';
  document.getElementById('edit-user-role').value = user.tipo || 'instrutor';
  openModal('modal-edit-user');
}

async function handleEditUser(e) {
  e.preventDefault();
  const id        = document.getElementById('edit-user-id').value;
  const nome      = document.getElementById('edit-user-name').value.trim();
  const email     = document.getElementById('edit-user-email').value.trim();
  const password  = document.getElementById('edit-user-password').value;
  const tipo      = document.getElementById('edit-user-role').value;

  const btn = document.getElementById('edit-user-btn');
  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> SALVANDO...';
  btn.disabled = true;

  try {
    if (!isOnline) throw new Error('É necessário estar online para alterar dados da equipe.');

    // Chama a mesma RPC informando o tipo correto do colaborador
    const { error } = await sb.rpc('admin_update_user', {
      target_user_id: id,
      new_nome: nome,
      new_email: email,
      new_phone: null,
      new_birthdate: null,
      new_password: password || null,
      new_tipo: tipo
    });

    if (error) throw error;

    // Atualiza cache local da equipe
    const idxAll = cacheAllUsers.findIndex(u => u.id === id);
    if (idxAll !== -1) {
      cacheAllUsers[idxAll].nome = nome;
      cacheAllUsers[idxAll].email = email;
      cacheAllUsers[idxAll].tipo = tipo;
      localStorage.setItem('esparta_cache_all_users', JSON.stringify(cacheAllUsers));
    }

    // Se por acaso estiver no cache de estudantes, atualiza/remove
    const idxSt = cacheStudents.findIndex(s => s.id === id);
    if (idxSt !== -1) {
      if (tipo === 'aluno') {
        cacheStudents[idxSt].nome = nome;
        cacheStudents[idxSt].email = email;
      } else {
        // Virou equipe, remove de estudantes
        cacheStudents.splice(idxSt, 1);
      }
      localStorage.setItem('esparta_cache_students', JSON.stringify(cacheStudents));
      renderMasterStudentList();
    }

    renderMasterUsersList();
    closeModal('modal-edit-user');
    showToast('Colaborador atualizado com sucesso! 💪', 'success');
  } catch (err) {
    showToast('Erro ao atualizar colaborador: ' + err.message, 'error');
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> SALVAR';
    btn.disabled = false;
  }
}

async function confirmDeleteUser() {
  const id = document.getElementById('edit-user-id').value;
  const name = document.getElementById('edit-user-name').value;
  if (!confirm(`ATENÇÃO:\nTem certeza que deseja excluir permanentemente o colaborador "${name}"?\nEle perderá acesso ao painel de administração.`)) {
    return;
  }

  const btn = document.getElementById('edit-user-btn');
  btn.disabled = true;

  try {
    if (!isOnline) throw new Error('É necessário estar online para excluir um colaborador.');

    // Chama a mesma RPC de exclusão
    const { error } = await sb.rpc('admin_delete_user', { target_user_id: id });
    if (error) throw error;

    // Remove dos caches locais
    cacheAllUsers = cacheAllUsers.filter(u => u.id !== id);
    localStorage.setItem('esparta_cache_all_users', JSON.stringify(cacheAllUsers));

    renderMasterUsersList();
    closeModal('modal-edit-user');
    showToast('Colaborador removido da equipe! 🗑️', 'info');
  } catch (err) {
    showToast('Erro ao excluir colaborador: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
//  CADASTRO DE COLABORADOR (INSTRUTOR / MASTER)
// ============================================================
async function handleSaveUser(e) {
  e.preventDefault();
  const nome     = document.getElementById('user-name').value.trim();
  const email    = document.getElementById('user-email').value.trim();
  const password = document.getElementById('user-password').value;
  const tipo     = document.getElementById('user-role').value;

  const btn = document.getElementById('cadastrar-user-btn');
  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> CADASTRANDO...';
  btn.disabled = true;

  try {
    if (!isOnline) throw new Error('É necessário estar online para cadastrar um colaborador.');

    // Cria o colaborador no Auth com o tipo correto
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { nome, tipo, academia_id: currentUser.academia_id }
      }
    });
    if (error) throw error;

    const userObj = {
      id: data?.user?.id || ('usr_' + Date.now()),
      nome, email,
      tipo,
      academia_id: currentUser.academia_id
    };

    cacheAllUsers.push(userObj);
    localStorage.setItem('esparta_cache_all_users', JSON.stringify(cacheAllUsers));
    renderMasterUsersList();
    closeModal('modal-user');

    showToast(`✅ ${tipo.toUpperCase()} ${nome} cadastrado com sucesso!`, 'success', 6000);
  } catch (err) {
    showToast('Erro ao cadastrar colaborador: ' + err.message, 'error');
  } finally {
    btn.innerHTML = 'CADASTRAR';
    btn.disabled = false;
  }
}

// ============================================================
//  CONFIGURAÇÕES DA ACADEMIA (NOME + LOGO)
// ============================================================
function setupLogoUploadPreview() {
  const fileInput = document.getElementById('gym-logo-file');
  const zone      = document.getElementById('logo-upload-zone');
  const label     = document.getElementById('logo-upload-label');
  const preview   = document.getElementById('gym-logo-preview-box');

  if (!fileInput) return;

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      const f = fileInput.files[0];
      label.innerText = `✅ ${f.name}`;
      zone.style.borderColor = 'var(--success-green)';

      // Preview local
      const reader = new FileReader();
      reader.onload = evt => {
        preview.innerHTML = `<img src="${evt.target.result}" alt="Preview">`;
      };
      reader.readAsDataURL(f);
    }
  });
}

async function handleSaveGymSettings(e) {
  e.preventDefault();
  const nome      = document.getElementById('gym-name-input').value.trim();
  const fileInput = document.getElementById('gym-logo-file');
  const btn       = document.getElementById('save-settings-btn');
  const progressEl = document.getElementById('logo-upload-progress');
  const fillEl    = document.getElementById('logo-progress-fill');
  const textEl    = document.getElementById('logo-progress-text');

  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> SALVANDO...';
  btn.disabled = true;

  let logoUrl = currentGym?.logo_url || null;

  try {
    if (fileInput.files.length && isOnline) {
      const file = fileInput.files[0];
      progressEl.style.display = 'block';
      fillEl.style.width = '20%';
      textEl.innerText = 'Enviando logotipo...';

      // Usa bucket dedicado de logos com caminho por academia (isolamento multi-tenant)
      const gymId   = currentGym?.id || currentUser.academia_id;
      const ext     = file.name.split('.').pop().toLowerCase();
      const path    = `${gymId}/logo.${ext}`;

      const { error } = await sb.storage.from('logos-academias').upload(path, file, {
        upsert: true,
        cacheControl: '3600'
      });
      if (error) throw error;

      fillEl.style.width = '90%';
      const { data: pub } = sb.storage.from('logos-academias').getPublicUrl(path);
      // Adiciona timestamp para forçar refresh no browser
      logoUrl = pub.publicUrl + `?t=${Date.now()}`;

      fillEl.style.width = '100%';
      textEl.innerText = 'Upload concluído!';
      setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
    }

    if (currentGym) {
      currentGym.nome     = nome;
      currentGym.logo_url = logoUrl;
    }
    localStorage.setItem('esparta_gym', JSON.stringify(currentGym));
    updateLoginBranding();
    updateGymNameInHeaders(nome, logoUrl);

    if (isOnline) {
      const { error } = await sb.from('academias')
        .update({ nome, logo_url: logoUrl })
        .eq('id', currentGym.id);
      if (error) throw error;
    } else {
      enqueueSync('gyms', 'UPDATE', currentGym.id, currentGym);
    }

    showToast('Configurações da academia salvas!', 'success');
  } catch (err) {
    showToast('Erro ao salvar configurações: ' + err.message, 'error');
    progressEl.style.display = 'none';
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> SALVAR CONFIGURAÇÕES';
    btn.disabled = false;
  }
}

// ============================================================
//  MODAIS UTILITÁRIOS
// ============================================================
function openModal(id)  { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

// Fecha modal ao clicar no backdrop
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', function(e) {
    if (e.target === this) {
      // Não fecha o modal de vídeo (tem closeVideoModal)
      if (this.id !== 'modal-video') {
        this.classList.remove('active');
      }
    }
  });
});
