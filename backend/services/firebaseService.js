/**
 * SkillBridge – Firebase FCM Notification Service
 * Handles: Deadline reminders, Interview alerts, Job notifications,
 *          Course reminders, Progress updates, System announcements
 */

const { cert } = require('firebase-admin/app');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getStorage } = require('firebase-admin/storage');

let _app = null;

function getApp() {
  if (_app) return _app;

  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error('Firebase environment variables not configured');
  }

  // Only initialise once
  const apps = getApps();
  if (apps.length > 0) {
    _app = apps[0];
    return _app;
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  const credential = privateKey && process.env.FIREBASE_CLIENT_EMAIL
    ? cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      })
    : undefined;

  _app = initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });

  return _app;
}

const app = getApp();
const auth = getAuth(app);
const firestore = getFirestore(app);
const messaging = getMessaging(app);
const storage = getStorage(app);

// ─── Notification types ───────────────────────────────────────────────────────
const NOTIFICATION_TYPES = {
  DEADLINE_REMINDER: 'deadline_reminder',
  INTERVIEW_SCHEDULE: 'interview_schedule',
  JOB_ALERT: 'job_alert',
  COURSE_COMPLETION: 'course_completion',
  LEARNING_PROGRESS: 'learning_progress',
  SYSTEM_ANNOUNCEMENT: 'system_announcement',
  OPPORTUNITY_MATCH: 'opportunity_match',
};

// ─── Icon mapping per type ────────────────────────────────────────────────────
const TYPE_ICONS = {
  [NOTIFICATION_TYPES.DEADLINE_REMINDER]: '/assets/icons/clock.png',
  [NOTIFICATION_TYPES.INTERVIEW_SCHEDULE]: '/assets/icons/interview.png',
  [NOTIFICATION_TYPES.JOB_ALERT]: '/assets/icons/job.png',
  [NOTIFICATION_TYPES.COURSE_COMPLETION]: '/assets/icons/cert.png',
  [NOTIFICATION_TYPES.LEARNING_PROGRESS]: '/assets/icons/book.png',
  [NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT]: '/assets/icons/bell.png',
  [NOTIFICATION_TYPES.OPPORTUNITY_MATCH]: '/assets/icons/match.png',
};

// ─── Helper: send a single FCM message ───────────────────────────────────────
async function sendMessage(token, { title, body, type, data = {}, imageUrl }) {
  getApp(); // ensure initialised
  const message = {
    token,
    notification: { title, body, ...(imageUrl ? { imageUrl } : {}) },
    data: {
      type: type || NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
      timestamp: new Date().toISOString(),
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    },
    webpush: {
      notification: {
        title,
        body,
        icon: TYPE_ICONS[type] || '/assets/logo.png',
        badge: '/assets/badge.png',
        vibrate: [100, 50, 100],
        requireInteraction: type === NOTIFICATION_TYPES.DEADLINE_REMINDER,
        actions: [
          { action: 'view', title: 'View Details' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
      },
      fcmOptions: { link: data.link || 'http://localhost:5000/dashboard2.html' },
    },
    android: {
      priority: 'high',
      notification: { channelId: 'skillbridge_alerts', icon: 'ic_notification', color: '#2563EB' },
    },
    apns: {
      payload: { aps: { badge: 1, sound: 'default' } },
    },
  };

  return await messaging.send(message);
}

// ─── Helper: send to multiple tokens ─────────────────────────────────────────
async function sendMulticast(tokens, payload) {
  if (!tokens || tokens.length === 0) return { successCount: 0, failureCount: 0 };
  getApp();

  const { title, body, type, data = {}, imageUrl } = payload;
  const message = {
    tokens,
    notification: { title, body, ...(imageUrl ? { imageUrl } : {}) },
    data: {
      type: type || NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
      timestamp: new Date().toISOString(),
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    },
    webpush: {
      notification: {
        title, body,
        icon: TYPE_ICONS[type] || '/assets/logo.png',
        badge: '/assets/badge.png',
      },
      fcmOptions: { link: data.link || 'http://localhost:5000/dashboard2.html' },
    },
  };

  const response = await messaging.sendEachForMulticast(message);
  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    responses: response.responses.map((r, i) => ({
      token: tokens[i],
      success: r.success,
      error: r.error?.message,
    })),
  };
}

// ─── 1. Deadline Reminder ─────────────────────────────────────────────────────
/**
 * @param {string} fcmToken – user's FCM registration token
 * @param {object} deadline – { title, company, daysLeft, deadlineDate }
 */
async function sendDeadlineReminderNotification(fcmToken, deadline) {
  const { title, company, daysLeft, deadlineDate } = deadline;
  const urgency = daysLeft <= 1 ? '🚨 URGENT' : daysLeft <= 3 ? '⚠️' : '⏰';

  return await sendMessage(fcmToken, {
    title: `${urgency} Deadline: ${title}`,
    body: `${company} application closes ${daysLeft === 0 ? 'TODAY' : `in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`}. Apply now!`,
    type: NOTIFICATION_TYPES.DEADLINE_REMINDER,
    data: { title, company, daysLeft: String(daysLeft), deadlineDate, link: 'http://localhost:5000/deadlines.html' },
  });
}

// ─── 2. Interview Schedule ────────────────────────────────────────────────────
async function sendInterviewScheduleNotification(fcmToken, interview) {
  const { company, role, date, time, mode } = interview;
  return await sendMessage(fcmToken, {
    title: `🎯 Interview: ${company}`,
    body: `${role} | ${date} at ${time} (${mode}) — Good luck! 💪`,
    type: NOTIFICATION_TYPES.INTERVIEW_SCHEDULE,
    data: { ...interview, link: 'http://localhost:5000/dashboard2.html' },
  });
}

// ─── 3. Job Alert ─────────────────────────────────────────────────────────────
async function sendJobAlertNotification(fcmToken, job) {
  const { title, company, matchScore, location } = job;
  return await sendMessage(fcmToken, {
    title: `💼 ${matchScore}% Match: ${title}`,
    body: `${company} · ${location} — This opportunity matches your profile!`,
    type: NOTIFICATION_TYPES.JOB_ALERT,
    data: { ...job, link: 'http://localhost:5000/opportunities2.html' },
  });
}

// ─── 4. Course Completion ─────────────────────────────────────────────────────
async function sendCourseCompletionNotification(fcmToken, course) {
  const { courseName, provider } = course;
  return await sendMessage(fcmToken, {
    title: `🎓 Course Completed!`,
    body: `Congrats! You completed "${courseName}" by ${provider}. Add it to your profile!`,
    type: NOTIFICATION_TYPES.COURSE_COMPLETION,
    data: { ...course, link: 'http://localhost:5000/profile2.html' },
  });
}

// ─── 5. Learning Progress ─────────────────────────────────────────────────────
async function sendLearningProgressNotification(fcmToken, progress) {
  const { completedTopics, totalTopics, weekNumber, careerGoal } = progress;
  const pct = Math.round((completedTopics / totalTopics) * 100);
  return await sendMessage(fcmToken, {
    title: `📚 Week ${weekNumber} Progress: ${pct}%`,
    body: `${completedTopics}/${totalTopics} topics done for ${careerGoal}. Keep going! 🚀`,
    type: NOTIFICATION_TYPES.LEARNING_PROGRESS,
    data: { ...progress, link: 'http://localhost:5000/roadmap2.html' },
  });
}

// ─── 6. System Announcement ───────────────────────────────────────────────────
async function sendSystemAnnouncement(tokens, announcement) {
  const { title, body, link } = announcement;
  return await sendMulticast(tokens, {
    title,
    body,
    type: NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
    data: { link: link || 'http://localhost:5000' },
  });
}

// ─── 7. Opportunity Match ─────────────────────────────────────────────────────
async function sendOpportunityMatchNotification(fcmToken, opportunity) {
  const { title, company, matchScore, type: oppType } = opportunity;
  return await sendMessage(fcmToken, {
    title: `✨ New ${oppType} Match Found!`,
    body: `"${title}" at ${company} — ${matchScore}% match with your profile`,
    type: NOTIFICATION_TYPES.OPPORTUNITY_MATCH,
    data: { ...opportunity, link: 'http://localhost:5000/opportunities2.html' },
  });
}

// ─── Validate FCM token ───────────────────────────────────────────────────────
async function validateToken(token) {
  try {
    getApp();
    // dry-run message to validate token
    await messaging.send({ token, data: { ping: 'true' } }, true);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = {
  app,
  auth,
  firestore,
  storage,
  NOTIFICATION_TYPES,
  sendDeadlineReminderNotification,
  sendInterviewScheduleNotification,
  sendJobAlertNotification,
  sendCourseCompletionNotification,
  sendLearningProgressNotification,
  sendSystemAnnouncement,
  sendOpportunityMatchNotification,
  sendMulticast,
  validateToken,
};
