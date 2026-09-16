// =============================================
// SkillBridge – App Core JS v3.0
// NOTE: All score calculations use SBCalc (calculationService.js)
// This file must be loaded AFTER calculationService.js
// =============================================
const API = 'https://skillbridge-kmly.onrender.com/api';

// ---- Auth ----
const getToken = () => localStorage.getItem('sb_token');
const getUser = () => { try { return JSON.parse(localStorage.getItem('sb_user') || 'null'); } catch { return null; } };
const getCurrentUser = getUser; // alias used by some pages
const setUser = u => { localStorage.setItem('sb_user', JSON.stringify(u)); return u; };
const updateUser = u => setUser({ ...getUser(), ...u });
const updateLocalUser = updateUser; // alias
let firebaseInitializer;

function ensureFirebaseAuth() {
  // If Firebase is already initialized, return immediately
  if (window.SkillBridgeFirebaseReady && typeof window.getSkillBridgeFirebaseIdToken === 'function') {
    return window.SkillBridgeFirebaseReady;
  }
  
  // If we're already loading Firebase, return that promise
  if (firebaseInitializer) {
    return firebaseInitializer;
  }
  
  // Load Firebase initialization script
  firebaseInitializer = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'js/firebase-init.js';
    script.onload = async () => {
      try {
        // Wait for the Firebase ready promise to resolve
        if (window.SkillBridgeFirebaseReady) {
          await window.SkillBridgeFirebaseReady;
          // Verify the token helper is now a function
          if (typeof window.getSkillBridgeFirebaseIdToken !== 'function') {
            reject(new Error('[Firebase] Token helper not defined after initialization.'));
          } else {
            resolve();
          }
        } else {
          reject(new Error('[Firebase] Initialization promise not found.'));
        }
      } catch (err) {
        reject(err);
      }
    };
    script.onerror = () => reject(new Error('[Firebase] Failed to load initialization script.'));
    document.head.appendChild(script);
  });
  
  return firebaseInitializer;
}

async function authHeaders(forceRefresh = false) {
  await ensureFirebaseAuth();
  if (typeof window.getSkillBridgeFirebaseIdToken !== 'function') {
    throw new Error('[Firebase] Token helper not available. Authentication initialization failed.');
  }
  const idToken = await window.getSkillBridgeFirebaseIdToken(forceRefresh);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` };
}

async function apiFetch(endpoint, opts = {}) {
  let headers = await authHeaders();
  let r = await fetch(API + endpoint, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (r.status === 401) {
    headers = await authHeaders(true);
    r = await fetch(API + endpoint, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  }
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) {
    localStorage.removeItem('sb_token');
    localStorage.removeItem('sb_user');
    const authError = new Error('Your login session expired. Please sign in again.');
    authError.code = body.code || null;
    authError.backendError = body.error || null;
    throw authError;
  }
  if (!r.ok) {
    const requestError = new Error(body.message || `Request failed (${r.status})`);
    requestError.code = body.code || null;
    requestError.backendError = body.error || null;
    throw requestError;
  }
  return body;
}

function requireAuth() {
  if (!getToken()) { window.location.href = 'auth.html'; return false; }
  return true;
}

async function logout() {
  try {
    await ensureFirebaseAuth();
    const firebase = window.SkillBridgeFirebaseAuth;
    if (firebase?.auth?.currentUser) await firebase.signOut(firebase.auth);
  } catch (err) {
    console.error('[logout]', err);
  } finally {
    localStorage.clear();
    window.location.href = 'auth.html';
  }
}

// ---- Utilities ----
const getInitials = name => name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';
const formatDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : 'N/A';
const daysUntil = d => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function showToast(msg, type = 'info', duration = 3500) {
  let t = document.getElementById('appToast');
  if (!t) { t = document.createElement('div'); t.id = 'appToast'; t.className = 'toast'; document.body.appendChild(t); }
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
  t.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${msg}`;
  t.className = `toast ${type}`;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function showLoader() { const l = document.getElementById('appLoader'); if (l) l.classList.add('active'); }
function hideLoader() { const l = document.getElementById('appLoader'); if (l) l.classList.remove('active'); }

// ---- Animate counter ----
function animateCount(el, target, suffix = '', duration = 1000) {
  if (!el) return;
  let start = 0, step = target / (duration / 16);
  const t = setInterval(() => {
    start = Math.min(start + step, target);
    el.textContent = Math.floor(start) + suffix;
    if (start >= target) clearInterval(t);
  }, 16);
}

// ---- SVG Ring Progress ----
function buildRing(container, pct, size = 100, stroke = 8, color = 'url(#ringGrad)') {
  const r = (size / 2) - stroke / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (clamp(pct, 0, 100) / 100) * circ;
  const gradId = 'ringGrad_' + Math.random().toString(36).slice(2);
  container.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#2563EB"/>
          <stop offset="100%" stop-color="#7C3AED"/>
        </linearGradient>
      </defs>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="${stroke}"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="url(#${gradId})" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
        style="transition:stroke-dashoffset 1.5s ease" id="ring_${gradId}"/>
    </svg>`;
  setTimeout(() => {
    const arc = container.querySelector(`#ring_${gradId}`);
    if (arc) arc.style.strokeDashoffset = offset;
  }, 100);
}

// ---- Progress bar animate ----
function animateBar(el, pct, delay = 0) {
  if (!el) return;
  setTimeout(() => { el.style.width = clamp(pct, 0, 100) + '%'; }, delay + 100);
}

// ---- Sidebar init ----
function initSidebar(activeId) {
  const user = getUser();
  const initials = getInitials(user?.name);

  // Topbar avatar
  document.querySelectorAll('.topbar-avatar, .sidebar-avatar-badge').forEach(el => {
    el.textContent = initials;
  });

  // User name in topbar/sidebar
  document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = user?.name || 'Student');
  document.querySelectorAll('[data-user-branch]').forEach(el => el.textContent = `${user?.branch || 'N/A'} • ${user?.academicYear || ''}`);

  // Active nav
  if (activeId) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
      if (item.id === activeId) item.classList.add('active');
    });
  }

  // Welcome
  const wEl = document.getElementById('welcomeName');
  if (wEl) wEl.textContent = user?.name?.split(' ')[0] || 'Student';

  // Theme
  const theme = localStorage.getItem('sb_theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);

  // Mobile sidebar toggle
  const toggleBtn = document.getElementById('mobileSidebarBtn');
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => { sidebar.classList.toggle('open'); overlay?.classList.toggle('active'); });
    overlay?.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); });
  }

  // Notification bell
  const bell = document.getElementById('notifBtn');
  if (bell) {
    bell.addEventListener('click', () => { window.location.href = 'notifications.html'; });
  }

  // Notification count
  const notifCount = getNotifications().filter(n => !n.read).length;
  document.querySelectorAll('.nav-badge-notif').forEach(el => el.textContent = notifCount || '');
  if (notifCount === 0) document.querySelectorAll('.notif-badge').forEach(el => el.style.display = 'none');
}

// ---- Notifications Store ----
function getNotifications() {
  const stored = localStorage.getItem('sb_notifications');
  if (stored) return JSON.parse(stored);
  return [];
}

function renderNotifDropdown() {
  const dd = document.getElementById('notifDropdown');
  if (!dd) return;
  const notifs = getNotifications();
  dd.innerHTML = `
    <div class="notif-header">
      <h4>Notifications</h4>
      <span class="notif-clear" onclick="markAllRead()">Mark all read</span>
    </div>
    <div style="max-height:320px;overflow-y:auto">
      ${notifs.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markRead(${n.id})">
          <div class="notif-icon" style="background:${n.iconBg}; color:${n.iconColor}"><i class="fas ${n.icon}"></i></div>
          <div class="notif-info">
            <div class="notif-title">${n.title}</div>
            <div style="font-size:11px;color:var(--text-muted)">${n.desc}</div>
            <div class="notif-time">${n.time}</div>
          </div>
          ${!n.read ? '<div class="notif-dot"></div>' : ''}
        </div>`).join('')}
    </div>`;
}

function markRead(id) {
  const notifs = getNotifications();
  const n = notifs.find(n => n.id === id);
  if (n) { n.read = true; localStorage.setItem('sb_notifications', JSON.stringify(notifs)); renderNotifDropdown(); }
}

function markAllRead() {
  const notifs = getNotifications();
  notifs.forEach(n => n.read = true);
  localStorage.setItem('sb_notifications', JSON.stringify(notifs));
  document.querySelectorAll('.notif-badge').forEach(el => el.style.display = 'none');
  renderNotifDropdown();
}

// ---- AI Analysis Engine ----
// Delegates to SBCalc.runLocalAnalysis (calculationService.js)
// runLocalAIAnalysis is aliased in calculationService.js for backwards compat.
// This stub ensures any direct call still works.
function runLocalAIAnalysis(user) {
  if (typeof SBCalc !== 'undefined') return SBCalc.runLocalAnalysis(user);
  // Fallback (should not be reached if calculationService.js is loaded)
  return { resumeScore: 0, skillMatch: 0, profileCompletion: 0, profilePct: 0, missingSkills: [], recommendedCareers: [], topCareers: [], strengths: [], improvements: [] };
}

// ---- Theme ----
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('sb_theme', t);
}

// ---- Scroll animations ----
document.addEventListener('DOMContentLoaded', () => {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('fade-in'); obs.unobserve(e.target); } });
  }, { threshold: 0.1 });
  document.querySelectorAll('.animate-on-scroll').forEach(el => obs.observe(el));
});
