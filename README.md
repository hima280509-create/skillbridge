# SkillBridge – AI Career & Opportunity Navigator

> **Premium AI-powered career guidance platform** for engineering & diploma students.  
> Analyzes resumes, maps skill gaps, and recommends personalized jobs, internships, placements, competitions, and free certifications.

---

## 🚀 Quick Start

### 1. Start the Backend Server

> **Use CMD (not PowerShell)** — PowerShell may block script execution.

```cmd
cd "C:\Users\phima\OneDrive\Desktop\IBM BOB\SkillBridge\backend"
node server.js
```

Server starts at: **http://localhost:5000**

### 2. Seed the Database

Open the Admin Panel in your browser:
```
http://localhost:5000/admin.html
```

Datasets are already stored in Firebase Firestore and are read directly by the application.

### 3. Open the App

```
http://localhost:5000
```

---

## 🔑 Demo Login

| Email | Password |
|-------|----------|
| `demo@skillbridge.ai` | `demo123` |

---

## 📁 Project Structure

```
SkillBridge/
├── backend/
│   ├── config.env              ← Server-only API keys and configuration
│   ├── server.js               ← Express server entry point
│   ├── package.json
│   ├── models/
│   │   ├── User.js             ← Full user schema
│   │   └── Opportunity.js      ← Job/Internship/Career etc. schemas
│   ├── routes/
│   │   ├── auth.js             ← /api/auth (register, login, me)
│   │   ├── users.js            ← /api/users (profile CRUD, stats)
│   │   ├── resume.js           ← /api/resume (PDF upload + parse)
│   │   ├── analysis.js         ← /api/analysis (local AI engine)
│   │   ├── opportunities.js    ← /api/opportunities (all types)
│   │   ├── ai.js               ← /api/ai (Gemini routes)
│   │   ├── email.js            ← /api/email (Resend transactional email)
│   │   └── notifications.js    ← /api/notifications (FCM push)
│   ├── services/
│   │   ├── geminiAiService.js  ← Gemini resume analysis, guidance, and roadmap
│   │   ├── geminiService.js    ← Gemini opportunity rec, skill gap, interview Q
│   │   ├── pdfService.js       ← PDF text extraction + skill detection
│   │   ├── emailService.js     ← All Resend email templates
│   │   └── firebaseService.js  ← FCM push notifications
│   ├── middleware/
│   │   └── auth.js             ← JWT authentication middleware
│
└── frontend/
    ├── index.html              ← Landing page
    ├── auth.html               ← Login + Register (unified)
    ├── dashboard2.html         ← Main AI dashboard
    ├── upload.html             ← Resume upload + manual profile form
    ├── resume-analysis.html    ← AI resume analysis results
    ├── opportunities2.html     ← 5-tab opportunity explorer
    ├── career-analysis.html    ← Career match + skill gap analysis
    ├── roadmap2.html           ← 6-week personalized learning roadmap
    ├── deadlines.html          ← Calendar + deadline tracker
    ├── notifications.html      ← Notification center
    ├── profile2.html           ← User profile (5 tabs)
    ├── settings.html           ← Theme, privacy, security settings
    ├── admin.html              ← Admin panel (DB seed + API test)
    ├── firebase-messaging-sw.js ← FCM service worker
    ├── assets/
    │   └── logo.png            ← ⚠️ PLACE YOUR LOGO HERE
    ├── css/
    │   ├── app.css             ← Main SaaS dashboard CSS system
    │   ├── chat.css            ← AI chat widget styles
    │   ├── landing.css         ← Landing page CSS
    │   └── main.css            ← Global utilities
    └── js/
        ├── app.js              ← Core: auth, sidebar, AI analysis, notifications
        ├── chat.js             ← Floating AI chat widget
        ├── landing.js          ← Landing page animations
        ├── firebase-init.js    ← FCM frontend integration
        └── dashboard.js        ← (Legacy)
```

---

## ⚙️ Configuration (config.env)

Located at `backend/config.env` — **never commit this file**.

```env
PORT=5000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_jwt_secret

# AI Services
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash

# Email (Resend)
RESEND_API_KEY=re_...          ← Get from: https://resend.com/api-keys

# Firebase FCM
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...      ← From Firebase service account JSON
FIREBASE_PRIVATE_KEY="..."     ← From Firebase service account JSON
```

---

## 🌐 API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create new account |
| POST | `/api/auth/login` | Login, returns JWT token |
| GET | `/api/auth/me` | Get current user (auth required) |

### AI Analysis
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/analyze-resume` | Gemini resume analysis |
| POST | `/api/ai/career-guidance` | Career path recommendations |
| POST | `/api/ai/roadmap` | Generate 6-week learning roadmap |
| POST | `/api/ai/chat` | AI career chat (Gemini) |
| POST | `/api/ai/skill-gap` | Detailed skill gap analysis |
| POST | `/api/ai/full-analysis` | Complete AI analysis (all services) |

### Opportunities
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/opportunities/jobs` | All jobs (with `?skills=python,react`) |
| GET | `/api/opportunities/internships` | All internships |
| GET | `/api/opportunities/placements` | Placement drives |
| GET | `/api/opportunities/competitions` | Coding competitions |
| GET | `/api/opportunities/certifications` | Free certifications |
| GET | `/api/opportunities/recommend` | AI-matched opportunities |

### Profile
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/profile` | Get user profile |
| PUT | `/api/users/profile` | Update profile |
| GET | `/api/users/dashboard-stats` | Dashboard analytics |

### Datasets
| Method | Endpoint | Description |
|--------|----------|-------------|

---

## 🤖 AI Features

### Resume Analysis (Google Gemini)
- Extracts: Name, Email, Skills, Projects, Certifications, Experience
- Generates: ATS Resume Score (0-100), Strengths, Improvement suggestions

### Career Guidance (Gemini)
- Analyzes skills vs career goals
- Recommends top 3 matching career paths
- Generates personalized learning roadmap

### Opportunity Matching (Gemini 1.5 Flash)
- Skill-to-requirement matching algorithm
- Explainable AI "Why this match?" reasoning
- Deadline-aware recommendations

### Skill Gap Analysis (Gemini)
- Compares current skills vs career requirements
- Prioritized list of skills to learn
- Maps certifications to missing skills

### Local AI Engine (No API key needed)
- Built-in `runLocalAIAnalysis()` in `app.js`
- Works offline using localStorage
- 13 career paths with skill mappings

---

## 🎨 Design System

| Token | Value |
|-------|-------|
| Primary Blue | `#2563EB` |
| Primary Purple | `#7C3AED` |
| Background | `#F8FAFC` |
| Text | `#1E293B` |
| Success | `#22C55E` |
| Warning | `#F59E0B` |
| Danger | `#EF4444` |
| Border Radius | `20px` (xl), `14px` (base) |

---

## 🔧 Troubleshooting

### MongoDB won't connect
- Disconnect **Cloudflare WARP VPN** — it blocks MongoDB SRV DNS
- Use mobile hotspot instead
- App works in **demo mode** without MongoDB (localStorage only)

### PowerShell execution error
```
Use CMD instead:
  Win+R → cmd → Enter
  cd "C:\...\SkillBridge\backend"
  node server.js
```

### Logo not showing
Save your logo image to:
```
SkillBridge/frontend/assets/logo.png
```

### Gemini API key invalid
Get a valid key from: https://aistudio.google.com/app/apikey  
Format: `AIzaSy...` (39 characters)

### Firebase push notifications not working
1. Go to Firebase Console → Project Settings → Service Accounts
2. Click "Generate new private key" → download JSON
3. Copy `client_email` and `private_key` into `config.env`
4. Get VAPID key: Project Settings → Cloud Messaging → Web Push certificates

---

## 📊 Database Collections

After seeding, MongoDB will have these collections in the `skillbridge` database:

| Collection | Records | Source |
|------------|---------|--------|
| `skills` | Firestore | Existing reference collection |
| `careers` | Firestore | Existing reference collection |
| `jobs` | Firestore | Existing reference collection |
| `internships` | Firestore | Existing reference collection |
| `placements` | Firestore | Existing reference collection |
| `competitions` | Firestore | Existing reference collection |
| `freeCertificates` | Firestore | Existing reference collection |
| `users` | — | Created on registration |

---

## 🚀 Production Deployment

### Deploy Backend (Railway / Render)
1. Push code to GitHub
2. Connect Railway/Render to repo
3. Set environment variables from `config.env`
4. Deploy — get your API URL

### Deploy Frontend (Vercel / Netlify)
1. Change `API` constant in `frontend/js/app.js` from `http://localhost:5000/api` to your production API URL
2. Deploy frontend folder to Vercel/Netlify

### MongoDB Atlas (Production)
Your Atlas cluster is already configured:
```
mongodb+srv://himi28052009_db_user:SkillBridge@cluster0.w3skj77.mongodb.net/skillbridge
```

---

## 📞 Support

- **Email**: support@skillbridge.ai
- **GitHub Issues**: Open an issue for bugs
- **Demo**: http://localhost:5000

---

## 📄 License

MIT License — © 2026 SkillBridge. All rights reserved.

---

*Built with Node.js, Express, Firebase Firestore, and Gemini AI*
