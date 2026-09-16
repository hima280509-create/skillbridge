// ==========================================
// SkillBridge – dashboard.js
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  
  const user = getCurrentUser();
  if (!user) { logout(); return; }

  // Set greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const welcomeEl = document.getElementById('welcomeTitle');
  if (welcomeEl) welcomeEl.textContent = `${greeting}, ${user.name?.split(' ')[0] || 'Student'}! 👋`;

  // Set sidebar user info
  const initials = getInitials(user.name);
  const sidebarAvatar = document.getElementById('sidebarAvatar');
  const topbarAvatar = document.getElementById('topbarAvatar');
  const sidebarName = document.getElementById('sidebarName');
  const sidebarBranch = document.getElementById('sidebarBranch');

  if (sidebarAvatar) sidebarAvatar.textContent = initials;
  if (topbarAvatar) topbarAvatar.textContent = initials;
  if (sidebarName) sidebarName.textContent = user.name;
  if (sidebarBranch) sidebarBranch.textContent = `${user.branch || 'N/A'} • ${user.academicYear || ''}`;

  // Load profile data from server
  showLoader();
  try {
    const profileData = await apiFetch('/users/profile');
    if (profileData?.success) {
      const u = profileData.user;
      updateLocalUser(u);
      renderDashboard(u);
    } else {
      renderDashboard(user);
    }
  } catch (e) {
    renderDashboard(user);
  }
  hideLoader();
});

function renderDashboard(user) {
  const skills = user.skills || [];
  const analysis = user.aiAnalysis || {};
  
  // Show AI banner if no analysis
  const banner = document.getElementById('aiBanner');
  if (banner && (!analysis.resumeScore)) {
    banner.style.display = 'block';
  }

  // Update stats
  const resumeScore = analysis.resumeScore || 0;
  const skillMatch = analysis.skillMatchPercentage || 0;

  const statResume = document.getElementById('statResumeScore');
  const statMatch = document.getElementById('statSkillMatch');
  const statSkills = document.getElementById('statSkills');
  const statOpps = document.getElementById('statOpps');

  if (statResume) animateCounter(statResume, resumeScore);
  if (statMatch) {
    setTimeout(() => { if (statMatch) statMatch.textContent = skillMatch + '%'; }, 1000);
  }
  if (statSkills) animateCounter(statSkills, skills.length);
  if (statOpps) animateCounter(statOpps, 24); // placeholder

  // Update top career stat
  const statCareer = document.getElementById('statCareer');
  if (statCareer && analysis.recommendedCareers?.length) {
    statCareer.innerHTML = `<i class="fas fa-star"></i> ${analysis.recommendedCareers[0]}`;
  }

  // Animate resume circle
  const circle = document.getElementById('resumeCircle');
  animateCircle(circle, resumeScore);
  const scoreLabel = document.getElementById('resumeScoreLabel');
  if (scoreLabel) animateCounter(scoreLabel, resumeScore);

  // Score breakdown bars
  const skillScore = Math.min(Math.round(skills.length * 3), 25) + 30;
  const projectScore = Math.min((user.projects?.length || 0) * 8, 20);
  const certScore = Math.min((user.certifications?.length || 0) * 5, 15);
  const expScore = Math.min((user.experience?.length || 0) * 5, 10);

  setTimeout(() => {
    setBar('barSkills', 'valSkills', Math.round((skillScore / 55) * 100));
    setBar('barProjects', 'valProjects', Math.round((projectScore / 20) * 100));
    setBar('barCerts', 'valCerts', Math.round((certScore / 15) * 100));
    setBar('barExp', 'valExp', Math.round((expScore / 10) * 100));
  }, 300);

  // Render skill cloud
  renderSkillCloud(skills, analysis.missingSkills || []);

  // Render career recommendations
  renderCareerRecs(analysis);

  // Render roadmap
  renderRoadmapPreview(analysis);

  // Load and render opportunities
  loadOpportunities(skills);
}

function setBar(barId, valId, pct) {
  const bar = document.getElementById(barId);
  const val = document.getElementById(valId);
  if (bar) bar.style.width = pct + '%';
  if (val) val.textContent = pct + '%';
}

function renderSkillCloud(skills, missingSkills) {
  const cloud = document.getElementById('skillCloud');
  if (!cloud) return;

  if (skills.length === 0) {
    cloud.innerHTML = '<span style="font-size:13px;color:var(--text-muted)">No skills added yet. <a href="profile.html" style="color:var(--primary);font-weight:600">Add skills →</a></span>';
    return;
  }

  cloud.innerHTML = skills.map(skill =>
    `<span class="skill-pill have">${skill}</span>`
  ).join('');

  // Missing skills
  const missingEl = document.getElementById('missingSkills');
  if (missingEl && missingSkills.length > 0) {
    missingEl.innerHTML = missingSkills.slice(0, 6).map(skill =>
      `<span class="missing-tag">${skill}</span>`
    ).join('');
  } else if (missingEl) {
    missingEl.innerHTML = '<span style="font-size:13px;color:var(--text-muted)">Run AI analysis to see missing skills</span>';
  }
}

function renderCareerRecs(analysis) {
  const container = document.getElementById('careerRecs');
  if (!container) return;

  const careers = analysis.recommendedCareers || [];
  const topCareers = analysis.topCareers || [];

  if (careers.length === 0) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted)"><p style="font-size:13px">Run AI analysis to get career recommendations</p></div>';
    return;
  }

  const careerIcons = {
    'Software Engineer': 'fas fa-code',
    'Full Stack Developer': 'fas fa-layer-group',
    'Data Scientist': 'fas fa-chart-line',
    'AI/ML Engineer': 'fas fa-brain',
    'Frontend Developer': 'fas fa-palette',
    'Backend Developer': 'fas fa-server',
    'DevOps Engineer': 'fas fa-cogs',
    'Cybersecurity Analyst': 'fas fa-shield-alt',
    'Mobile App Developer': 'fas fa-mobile-alt',
    'Cloud Architect': 'fas fa-cloud',
    'default': 'fas fa-briefcase'
  };

  const colors = ['blue', 'purple', 'green'];

  container.innerHTML = careers.slice(0, 3).map((career, i) => {
    const tc = topCareers[i] || {};
    const score = tc.score || 0;
    const icon = careerIcons[career] || careerIcons['default'];
    const color = colors[i];
    return `
      <div class="stat-card" style="flex-direction:column;align-items:flex-start;gap:12px">
        <div style="display:flex;align-items:center;gap:10px;width:100%">
          <div class="stat-icon ${color}"><i class="${icon}"></i></div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700;color:var(--text)">${career}</div>
            <div style="font-size:11px;color:var(--text-muted)">${i === 0 ? '🥇 Best Match' : i === 1 ? '🥈 Second Match' : '🥉 Third Match'}</div>
          </div>
          <span style="font-size:13px;font-weight:700;color:var(--success)">${score}%</span>
        </div>
        <div style="width:100%;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${score}%;background:linear-gradient(90deg,var(--primary),var(--purple));border-radius:3px;transition:width 1s ease"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRoadmapPreview(analysis) {
  const container = document.getElementById('roadmapPhases');
  if (!container) return;

  const career = analysis.recommendedCareers?.[0] || 'Software Engineer';
  const phases = [
    { title: 'Foundation Skills', skills: ['Python', 'Data Structures', 'Git'], icon: '1', status: 'done' },
    { title: 'Core Development', skills: ['React', 'Node.js', 'SQL'], icon: '2', status: 'active-phase' },
    { title: 'Advanced Topics', skills: ['Docker', 'AWS', 'System Design'], icon: '3', status: '' },
    { title: 'Job Preparation', skills: ['LeetCode', 'Portfolio', 'Mock Interviews'], icon: '4', status: '' }
  ];

  container.innerHTML = `<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">Target: <strong style="color:var(--primary)">${career}</strong></p>` +
    phases.map(p => `
      <div class="roadmap-phase">
        <div class="phase-icon ${p.status}">${p.status === 'done' ? '✓' : p.icon}</div>
        <div class="phase-content">
          <div class="phase-title">${p.title}</div>
          <div class="phase-skills">
            ${p.skills.map(s => `<span class="phase-skill">${s}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');
}

async function loadOpportunities(userSkills) {
  const container = document.getElementById('oppList');
  if (!container) return;

  try {
    const data = await apiFetch('/opportunities/recommendations');
    if (!data?.success) {
      renderSampleOpportunities(container);
      return;
    }
    
    const { jobs = [], internships = [] } = data.recommendations;
    const combined = [...jobs.slice(0, 3), ...internships.slice(0, 2)];

    if (combined.length === 0) {
      renderSampleOpportunities(container);
      return;
    }

    container.innerHTML = combined.map(opp => {
      const abbr = opp.company?.slice(0, 2).toUpperCase() || '??';
      const typeLabel = opp.type === 'job' ? 'Job' : 'Internship';
      const color = opp.type === 'job' ? 'blue-bg' : 'purple-bg';
      return `
        <div class="dash-opp-item">
          <div class="dash-opp-logo ${color}">${abbr}</div>
          <div class="dash-opp-info">
            <div class="dash-opp-title">${opp.title}</div>
            <div class="dash-opp-sub">${opp.company} • ${typeLabel}</div>
          </div>
          <div class="dash-opp-score">${opp.matchScore}%</div>
        </div>
      `;
    }).join('');

    // Update opportunities count
    const statOpps = document.getElementById('statOpps');
    if (statOpps) animateCounter(statOpps, combined.length + 19);

  } catch (e) {
    renderSampleOpportunities(container);
  }
}

function renderSampleOpportunities(container) {
  const samples = [
    { abbr: 'TI', title: 'Junior Python Developer', company: 'TechCorp India', type: 'Job', score: 85, color: 'blue-bg' },
    { abbr: 'G', title: 'Web Development Intern', company: 'Google', type: 'Internship', score: 78, color: 'purple-bg' },
    { abbr: 'ZO', title: 'Software Developer', company: 'Zoho', type: 'Placement', score: 72, color: 'green-bg' },
    { abbr: 'IBM', title: 'ML Research Intern', company: 'IBM Research', type: 'Internship', score: 68, color: 'orange-bg' },
  ];
  container.innerHTML = samples.map(s => `
    <div class="dash-opp-item">
      <div class="dash-opp-logo ${s.color}">${s.abbr}</div>
      <div class="dash-opp-info">
        <div class="dash-opp-title">${s.title}</div>
        <div class="dash-opp-sub">${s.company} • ${s.type}</div>
      </div>
      <div class="dash-opp-score">${s.score}%</div>
    </div>
  `).join('');
}

async function runAnalysis() {
  const user = getCurrentUser();
  if (!user?.skills?.length) {
    showToast('Please add skills first before running analysis.', 'error');
    window.location.href = 'profile.html';
    return;
  }

  showLoader();
  showToast('Running AI Analysis...', 'info');

  try {
    const data = await apiFetch('/analysis/run', { method: 'POST' });
    hideLoader();
    if (data?.success) {
      updateLocalUser({ aiAnalysis: data.analysis });
      showToast('AI Analysis complete!', 'success');
      // Re-render dashboard with new analysis
      renderDashboard({ ...getCurrentUser(), aiAnalysis: data.analysis });
      // Hide banner
      const banner = document.getElementById('aiBanner');
      if (banner) banner.style.display = 'none';
    } else {
      showToast(data?.message || 'Analysis could not be completed.', 'error');
    }
  } catch (e) {
    hideLoader();
    showToast('Analysis is temporarily unavailable. Please try again.', 'error');
  }
}
