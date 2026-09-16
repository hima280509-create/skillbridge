/**
 * SkillBridge – Email Service (Resend)
 * Handles: OTP emails, Deadline Reminders, Interview Notifications,
 *          Password Reset, Welcome emails, Job Alerts
 */

const { Resend } = require('resend');

let _resend = null;
function getClient() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set in environment');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const FROM = process.env.RESEND_FROM_EMAIL || 'SkillBridge <noreply@skillbridge.ai>';
const REPLY_TO = process.env.RESEND_REPLY_TO || 'support@skillbridge.ai';

// ─── Shared HTML wrapper ──────────────────────────────────────────────────────
function htmlWrapper(content, preheader = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width"/>
<title>SkillBridge</title>
<style>
  body{margin:0;padding:0;background:#F8FAFC;font-family:'Segoe UI',Arial,sans-serif;color:#1E293B}
  .wrapper{max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .header{background:linear-gradient(135deg,#2563EB,#7C3AED);padding:28px 32px;text-align:center}
  .header h1{color:#fff;font-size:22px;font-weight:800;margin:0}
  .header p{color:rgba(255,255,255,0.75);font-size:13px;margin:4px 0 0}
  .body{padding:32px}
  .otp-box{background:linear-gradient(135deg,rgba(37,99,235,0.08),rgba(124,58,237,0.08));border:2px dashed rgba(37,99,235,0.3);border-radius:12px;padding:20px;text-align:center;margin:20px 0}
  .otp-code{font-size:36px;font-weight:900;letter-spacing:8px;color:#2563EB}
  .btn{display:inline-block;padding:13px 32px;background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;margin:16px 0}
  .card{background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:12px 0;border-left:4px solid #2563EB}
  .tag{display:inline-block;padding:3px 10px;background:rgba(37,99,235,0.1);color:#2563EB;border-radius:20px;font-size:12px;font-weight:600;margin:2px}
  .footer{background:#F1F5F9;padding:20px 32px;text-align:center;font-size:12px;color:#64748B}
  .footer a{color:#2563EB}
  .divider{height:1px;background:#E2E8F0;margin:20px 0}
  h2{font-size:20px;font-weight:700;margin:0 0 8px}
  p{font-size:14px;line-height:1.6;color:#475569;margin:8px 0}
  .highlight{color:#2563EB;font-weight:700}
  .warning{background:#FFF7ED;border-left:4px solid #F59E0B;border-radius:0 8px 8px 0;padding:12px 16px;margin:12px 0}
</style>
</head>
<body>
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;color:#F8FAFC">${preheader}</div>` : ''}
<div class="wrapper">
  <div class="header">
    <h1>SkillBridge</h1>
    <p>AI Career &amp; Opportunity Navigator</p>
  </div>
  <div class="body">
    ${content}
  </div>
  <div class="footer">
    <p>© 2026 SkillBridge · <a href="#">Privacy Policy</a> · <a href="#">Unsubscribe</a></p>
    <p>AI Career &amp; Opportunity Navigator for Engineering Students</p>
  </div>
</div>
</body>
</html>`;
}

// ─── 1. OTP Email ─────────────────────────────────────────────────────────────
async function sendOTP(to, { name, otp, purpose = 'verification', expiresInMinutes = 10 }) {
  const content = `
    <h2>Hello, ${name}! 👋</h2>
    <p>Your SkillBridge <strong>${purpose}</strong> OTP is:</p>
    <div class="otp-box">
      <div class="otp-code">${otp}</div>
      <p style="color:#64748B;font-size:13px;margin-top:8px">Valid for <strong>${expiresInMinutes} minutes</strong></p>
    </div>
    <div class="warning">
      <p style="margin:0;font-size:13px">⚠️ <strong>Never share this OTP.</strong> SkillBridge will never ask for your OTP via phone or email.</p>
    </div>
    <p>If you did not request this, please ignore this email or contact support.</p>`;

  return await getClient().emails.send({
    from: FROM,
    reply_to: REPLY_TO,
    to,
    subject: `[SkillBridge] Your OTP: ${otp}`,
    html: htmlWrapper(content, `Your OTP is ${otp}`),
  });
}

// ─── 2. Welcome Email ─────────────────────────────────────────────────────────
async function sendWelcomeEmail(to, { name, branch, careerGoal }) {
  const content = `
    <h2>Welcome to SkillBridge, ${name}! 🚀</h2>
    <p>You're all set to start your AI-powered career journey. Here's what you can do next:</p>
    <div class="card"><strong>📄 Upload Your Resume</strong><p style="margin:4px 0">Get an AI-powered ATS score and personalized suggestions.</p></div>
    <div class="card"><strong>🧠 Run AI Analysis</strong><p style="margin:4px 0">Discover your skill gaps and get career recommendations.</p></div>
    <div class="card"><strong>💼 Browse Opportunities</strong><p style="margin:4px 0">See jobs, internships, and certifications matched to your profile.</p></div>
    <div class="card"><strong>🗺️ Get Your Roadmap</strong><p style="margin:4px 0">Follow a personalized 6-week learning plan for ${careerGoal || 'your career goal'}.</p></div>
    <div style="text-align:center;margin-top:24px">
      <a href="http://localhost:5000/dashboard2.html" class="btn">Go to Dashboard →</a>
    </div>`;

  return await getClient().emails.send({
    from: FROM,
    reply_to: REPLY_TO,
    to,
    subject: `Welcome to SkillBridge, ${name}! 🎉`,
    html: htmlWrapper(content, `Start your AI career journey`),
  });
}

// ─── 3. Deadline Reminder ─────────────────────────────────────────────────────
async function sendDeadlineReminder(to, { name, deadlines }) {
  const deadlineCards = deadlines.map(d => `
    <div class="card" style="border-left-color:${d.daysLeft <= 3 ? '#EF4444' : d.daysLeft <= 7 ? '#F59E0B' : '#22C55E'}">
      <strong>${d.title}</strong> <span class="tag">${d.type}</span>
      <p style="margin:4px 0">📍 ${d.company} &nbsp;|&nbsp; ⏰ Deadline: <span class="highlight">${d.deadline}</span></p>
      <p style="margin:4px 0;color:${d.daysLeft <= 3 ? '#EF4444' : '#F59E0B'}"><strong>${d.daysLeft} day${d.daysLeft !== 1 ? 's' : ''} remaining</strong></p>
    </div>`).join('');

  const content = `
    <h2>⏰ Deadline Reminder, ${name}!</h2>
    <p>Don't miss these upcoming opportunities. Apply before the deadlines!</p>
    ${deadlineCards}
    <div style="text-align:center;margin-top:20px">
      <a href="http://localhost:5000/deadlines.html" class="btn">View All Deadlines →</a>
    </div>`;

  return await getClient().emails.send({
    from: FROM,
    reply_to: REPLY_TO,
    to,
    subject: `⏰ ${deadlines.length} Deadline${deadlines.length > 1 ? 's' : ''} Coming Up – SkillBridge`,
    html: htmlWrapper(content, `${deadlines[0]?.title} deadline approaching`),
  });
}

// ─── 4. Interview Notification ────────────────────────────────────────────────
async function sendInterviewNotification(to, { name, company, role, date, time, mode, meetLink }) {
  const content = `
    <h2>🎯 Interview Scheduled, ${name}!</h2>
    <p>Congratulations! You have an upcoming interview. Here are the details:</p>
    <div class="card" style="border-left-color:#7C3AED">
      <p style="margin:4px 0"><strong>🏢 Company:</strong> ${company}</p>
      <p style="margin:4px 0"><strong>💼 Role:</strong> ${role}</p>
      <p style="margin:4px 0"><strong>📅 Date:</strong> ${date}</p>
      <p style="margin:4px 0"><strong>🕐 Time:</strong> ${time}</p>
      <p style="margin:4px 0"><strong>📍 Mode:</strong> ${mode}</p>
      ${meetLink ? `<p style="margin:4px 0"><strong>🔗 Link:</strong> <a href="${meetLink}">${meetLink}</a></p>` : ''}
    </div>
    <div class="card" style="background:rgba(34,197,94,0.06);border-left-color:#22C55E">
      <strong>💡 Quick Prep Tips</strong>
      <p>• Research ${company}'s products and recent news</p>
      <p>• Review DSA fundamentals if it's a coding round</p>
      <p>• Prepare 2-3 STAR-method project stories</p>
      <p>• Test your internet connection 15 min before</p>
    </div>
    <div style="text-align:center;margin-top:20px">
      <a href="http://localhost:5000/dashboard2.html" class="btn">View Dashboard →</a>
    </div>`;

  return await getClient().emails.send({
    from: FROM,
    reply_to: REPLY_TO,
    to,
    subject: `🎯 Interview at ${company} – ${date} | SkillBridge`,
    html: htmlWrapper(content, `Interview at ${company} on ${date}`),
  });
}

// ─── 5. Password Reset ────────────────────────────────────────────────────────
async function sendPasswordReset(to, { name, resetLink, expiresInMinutes = 30 }) {
  const content = `
    <h2>Reset Your Password 🔐</h2>
    <p>Hi ${name}, we received a request to reset your SkillBridge password.</p>
    <div style="text-align:center;margin:24px 0">
      <a href="${resetLink}" class="btn">Reset Password →</a>
    </div>
    <div class="warning">
      <p style="margin:0;font-size:13px">⏰ This link expires in <strong>${expiresInMinutes} minutes</strong>. If you didn't request this, ignore this email.</p>
    </div>`;

  return await getClient().emails.send({
    from: FROM,
    reply_to: REPLY_TO,
    to,
    subject: `Reset Your SkillBridge Password`,
    html: htmlWrapper(content),
  });
}

// ─── 6. Job/Opportunity Alert ─────────────────────────────────────────────────
async function sendJobAlert(to, { name, opportunities }) {
  const cards = opportunities.slice(0, 3).map(o => `
    <div class="card">
      <strong>${o.title}</strong> – ${o.company}
      <span class="tag" style="background:rgba(34,197,94,0.1);color:#22C55E">${o.matchScore}% Match</span>
      <p style="margin:4px 0">📍 ${o.location} &nbsp;|&nbsp; 💰 ${o.salary}</p>
      <p style="margin:4px 0">⏰ Deadline: ${o.deadline}</p>
    </div>`).join('');

  const content = `
    <h2>🔔 New Opportunities Matched For You, ${name}!</h2>
    <p>Our AI found ${opportunities.length} new opportunities matching your profile:</p>
    ${cards}
    <div style="text-align:center;margin-top:20px">
      <a href="http://localhost:5000/opportunities2.html" class="btn">View All Opportunities →</a>
    </div>`;

  return await getClient().emails.send({
    from: FROM,
    reply_to: REPLY_TO,
    to,
    subject: `🔔 ${opportunities.length} New Opportunities Found – SkillBridge`,
    html: htmlWrapper(content, `${opportunities[0]?.title} at ${opportunities[0]?.company}`),
  });
}

module.exports = {
  sendOTP,
  sendWelcomeEmail,
  sendDeadlineReminder,
  sendInterviewNotification,
  sendPasswordReset,
  sendJobAlert,
};
