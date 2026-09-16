// ==========================================
// SkillBridge – main.js (Global utilities)
// ==========================================

const API_BASE = 'http://localhost:5000/api';

// Get auth token
function getToken() {
  return localStorage.getItem('sb_token');
}

// Get current user
function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('sb_user') || 'null');
  } catch { return null; }
}

// Auth headers
let firebaseInitializer;

async function authHeaders(forceRefresh = false) {
  if (!window.getSkillBridgeFirebaseIdToken) {
    if (!firebaseInitializer) {
      firebaseInitializer = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'js/firebase-init.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    await firebaseInitializer;
  }
  const idToken = await window.getSkillBridgeFirebaseIdToken(forceRefresh);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` };
}

// API fetch wrapper
async function apiFetch(endpoint, options = {}) {
  let headers = await authHeaders();
  let res = await fetch(API_BASE + endpoint, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (res.status === 401) {
    headers = await authHeaders(true);
    res = await fetch(API_BASE + endpoint, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Your login session expired. Please sign in again.');
  if (!res.ok) throw new Error(body.message || `Request failed (${res.status})`);
  return body;
}

// Show toast notification
function showToast(msg, type = 'info') {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// Show/hide loader
function showLoader() {
  const el = document.getElementById('loader');
  if (el) el.classList.add('active');
}
function hideLoader() {
  const el = document.getElementById('loader');
  if (el) el.classList.remove('active');
}

// Check auth and redirect
function requireAuth() {
  if (!getToken()) {
    window.location.href = 'auth.html';
    return false;
  }
  return true;
}

// Logout
async function logout() {
  try {
    await authHeaders();
    const firebase = window.SkillBridgeFirebaseAuth;
    if (firebase?.auth?.currentUser) await firebase.signOut(firebase.auth);
  } catch (err) {
    console.error('[logout]', err);
  } finally {
    localStorage.removeItem('sb_token');
    localStorage.removeItem('sb_user');
    window.location.href = 'index.html';
  }
}

// Update user in local storage
function updateLocalUser(updates) {
  const user = getCurrentUser() || {};
  const updated = { ...user, ...updates };
  localStorage.setItem('sb_user', JSON.stringify(updated));
  return updated;
}

// Format date
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Days until deadline
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Get user initials
function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// Animate counter
function animateCounter(el, target, duration = 1000) {
  if (!el) return;
  let start = 0;
  const step = target / (duration / 16);
  const timer = setInterval(() => {
    start += step;
    if (start >= target) {
      el.textContent = target;
      clearInterval(timer);
    } else {
      el.textContent = Math.floor(start);
    }
  }, 16);
}

// Animate circle progress
function animateCircle(circleEl, score, total = 100) {
  if (!circleEl) return;
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / total) * circumference;
  setTimeout(() => {
    circleEl.style.strokeDashoffset = offset;
    circleEl.style.transition = 'stroke-dashoffset 1.5s ease';
  }, 100);
}

// Skill color by level
function skillColor(skill, userSkills) {
  const lower = userSkills.map(s => s.toLowerCase());
  return lower.includes(skill.toLowerCase()) ? 'have' : 'missing';
}

// Domain colors
const domainColors = {
  'Software Development': 'blue-bg',
  'Web Development': 'purple-bg',
  'AI/ML': 'orange-bg',
  'Data Science': 'green-bg',
  'Mobile Development': 'blue-bg',
  'DevOps': 'purple-bg',
  'Security': 'red-bg',
  'default': 'blue-bg'
};

function getDomainColor(domain) {
  return domainColors[domain] || domainColors['default'];
}

// Add intersection observer for animations
document.addEventListener('DOMContentLoaded', () => {
  // Animate cards on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const delay = entry.target.dataset.delay || 0;
        setTimeout(() => entry.target.classList.add('visible'), parseInt(delay));
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.card-animate').forEach(el => observer.observe(el));
});

