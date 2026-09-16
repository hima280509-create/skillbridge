// =============================================
// SkillBridge – AI Chat Widget v1.0
// Floating chat bubble on all dashboard pages
// =============================================

(function () {
  const API = 'http://localhost:5000/api';
  let isOpen = false;
  let messages = [];
  let sessionId = 'chat_' + Date.now();

  // ── Quick-reply suggestions per context ────────────────────────────────────
  const QUICK_REPLIES = [
    "What skills should I learn?",
    "Suggest internships for me",
    "How do I improve my resume?",
    "What is my best career match?",
    "Show me free certifications",
  ];

  // ── Inject HTML ─────────────────────────────────────────────────────────────
  function injectChat() {
    const html = `
      <div id="aiChatBubble" title="Ask AI Career Coach">
        <div class="chat-bubble-ring"></div>
        <i class="fas fa-robot"></i>
        <span class="chat-notif-dot" id="chatNotifDot"></span>
      </div>

      <div id="aiChatPanel" class="chat-panel">
        <!-- Header -->
        <div class="chat-header">
          <div class="chat-header-info">
            <div class="chat-ai-icon"><i class="fas fa-robot"></i></div>
            <div>
              <div class="chat-title">SkillBridge AI</div>
              <div class="chat-status"><span class="chat-dot"></span> Always online</div>
            </div>
          </div>
          <button class="chat-close-btn" id="chatCloseBtn" title="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Body -->
        <div class="chat-body" id="chatBody">
          <div class="chat-welcome">
            <div class="chat-welcome-icon">🤖</div>
            <div class="chat-welcome-title">Hi! I'm your AI Career Coach</div>
            <div class="chat-welcome-sub">Ask me anything about your career, skills, jobs, or learning path.</div>
          </div>

          <div class="chat-quick-replies" id="chatQuickReplies">
            ${QUICK_REPLIES.map(q => `<button class="chat-qr-btn" onclick="sendQuickReply('${q}')">${q}</button>`).join('')}
          </div>

          <div id="chatMessages"></div>
        </div>

        <!-- Input -->
        <div class="chat-footer">
          <div class="chat-input-row">
            <input type="text" id="chatInput" placeholder="Ask about your career..." autocomplete="off"/>
            <button id="chatSendBtn" onclick="sendChatMsg()">
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
          <div class="chat-powered">Powered by Gemini AI • SkillBridge</div>
        </div>
      </div>`;

    const wrapper = document.createElement('div');
    wrapper.id = 'aiChatWrapper';
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);

    // Bind events
    document.getElementById('aiChatBubble').addEventListener('click', toggleChat);
    document.getElementById('chatCloseBtn').addEventListener('click', closeChat);
    document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMsg(); });

    // Show notif dot after 3s
    setTimeout(() => {
      const dot = document.getElementById('chatNotifDot');
      if (dot) { dot.style.display = 'block'; }
    }, 3000);
  }

  // ── Toggle ───────────────────────────────────────────────────────────────────
  function toggleChat() {
    isOpen ? closeChat() : openChat();
  }

  function openChat() {
    isOpen = true;
    document.getElementById('aiChatPanel').classList.add('open');
    document.getElementById('chatNotifDot').style.display = 'none';
    document.getElementById('chatInput').focus();
  }

  function closeChat() {
    isOpen = false;
    document.getElementById('aiChatPanel').classList.remove('open');
  }

  // ── Send ──────────────────────────────────────────────────────────────────────
  window.sendQuickReply = function (text) {
    document.getElementById('chatInput').value = text;
    document.getElementById('chatQuickReplies').style.display = 'none';
    sendChatMsg();
  };

  window.sendChatMsg = async function () {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    appendMsg('user', msg);
    appendTyping();

    try {
      await ensureFirebaseAuth();
      const idToken = await window.getSkillBridgeFirebaseIdToken();
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` };

      const res = await fetch(API + '/ai/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: msg,
          history: messages.slice(-10),
          sessionId,
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) console.error('[CHAT API]', res.status, data);
      removeTyping();

      if (res.ok && data.success && data.reply) {
        appendMsg('bot', data.reply);
      } else {
        appendMsg('bot', 'Sorry, I couldn\'t access your SkillBridge data right now. Please try again in a moment.');
      }
    } catch {
      removeTyping();
      appendMsg('bot', 'SkillBridge AI is temporarily unable to access your personalized data. Please try again in a moment.');
    }
  };

  // ── DOM helpers ───────────────────────────────────────────────────────────────
  function appendMsg(role, text) {
    const body = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg-' + role;
    const content = String(text || '');
    messages.push({ role: role === 'bot' ? 'assistant' : 'user', content });
    const escaped = content.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
    div.innerHTML = `<div class="chat-bubble">${escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</div>`;
    body.appendChild(div);
    document.getElementById('chatBody').scrollTop = 99999;
  }

  function appendTyping() {
    const body = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.id = 'chatTyping';
    div.className = 'chat-msg chat-msg-bot';
    div.innerHTML = `<div class="chat-bubble chat-typing"><span></span><span></span><span></span></div>`;
    body.appendChild(div);
    document.getElementById('chatBody').scrollTop = 99999;
  }

  function removeTyping() {
    document.getElementById('chatTyping')?.remove();
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectChat);
  } else {
    injectChat();
  }
})();
