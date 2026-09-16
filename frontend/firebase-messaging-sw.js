// SkillBridge – Firebase Cloud Messaging Service Worker
// This file MUST be at the root of your web app (frontend/)
// It handles background push notifications

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase config is safe here since this is a public service worker
// API keys for Firebase web are meant to be public (they are restricted by domain)
firebase.initializeApp({
  apiKey: "AIzaSyCJQSUj2OLlJCrzm9Hig7_gRM4RSY2aYE8",
  authDomain: "skillbridge-3d262.firebaseapp.com",
  projectId: "skillbridge-3d262",
  storageBucket: "skillbridge-3d262.firebasestorage.app",
  messagingSenderId: "876203724499",
  appId: "1:876203724499:web:b1469fc2fabf4566cdce26",
  measurementId: "G-4W3DYDZ5WC"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[SkillBridge SW] Background message:', payload);

  const { title, body } = payload.notification || {};
  const data = payload.data || {};

  const notifOptions = {
    body: body || 'You have a new update from SkillBridge',
    icon: '/assets/logo.png',
    badge: '/assets/badge.png',
    data: { link: data.link || 'http://localhost:5000/dashboard2.html', ...data },
    actions: [
      { action: 'view', title: 'View Details' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    vibrate: [100, 50, 100],
    requireInteraction: data.type === 'deadline_reminder',
  };

  self.registration.showNotification(title || 'SkillBridge', notifOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || 'http://localhost:5000/dashboard2.html';

  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('localhost:5000') && 'focus' in client) {
            client.navigate(link);
            return client.focus();
          }
        }
        return clients.openWindow(link);
      })
    );
  }
});
