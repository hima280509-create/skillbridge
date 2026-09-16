/**
 * SkillBridge – Frontend Firebase FCM Integration
 * Include this script in pages that need push notifications.
 * Uses ES module CDN – safe for browser.
 * API keys for Firebase Client SDK are public by design (secured by Firebase rules + domain restriction).
 */

// Define stub to prevent "not a function" errors while loading
window.getSkillBridgeFirebaseIdToken = async function() {
  await window.SkillBridgeFirebaseReady;
  if (typeof window.getSkillBridgeFirebaseIdToken !== 'function') {
    throw new Error('[Firebase] Token helper not initialized.');
  }
  // This will be replaced by the real implementation below
  throw new Error('[Firebase] Token helper called before Firebase initialized.');
};

// Dynamically load Firebase SDK
window.SkillBridgeFirebaseReady = (async function initFirebaseMessaging() {
  try {
    // Load Firebase dynamically (CDN ESM)
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut, deleteUser } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const { getMessaging, getToken, onMessage } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js');

    const firebaseConfig = {
     apiKey: "AIzaSyCJQSUj2OLlJCrzm9Hig7_gRM4RSY2aYE8",
     authDomain: "skillbridge-3d262.firebaseapp.com",
     projectId: "skillbridge-3d262",
     storageBucket: "skillbridge-3d262.firebasestorage.app",
     messagingSenderId: "876203724499",
     appId: "1:876203724499:web:b1469fc2fabf4566cdce26",
     measurementId: "G-4W3DYDZ5WC"
    };  

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    window.SkillBridgeFirebaseAuth = { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut, deleteUser };
    
    // Wait for auth state to be known before considering Firebase ready
    const authStatePromise = new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        unsubscribe();
        resolve(currentUser);
      });
    });
    
    const initialUser = await authStatePromise;
    console.log('Firebase user:', initialUser?.uid);
    
    // NOW define the real token helper after auth is initialized
    window.getSkillBridgeFirebaseIdToken = async function (forceRefresh = false) {
      let user = auth.currentUser;
      if (!user) user = await new Promise(resolve => {
        const unsubscribe = onAuthStateChanged(auth, currentUser => {
          unsubscribe();
          resolve(currentUser);
        });
      });
      if (!user) {
        throw new Error('No authenticated Firebase user found. Please log in again.');
      }
      const idToken = await user.getIdToken(forceRefresh);
      localStorage.setItem('sb_token', idToken);
      return idToken;
    };
    
    console.log('[Firebase] initialized:', true);
    console.log('[Firebase] token helper:', typeof window.getSkillBridgeFirebaseIdToken);
    console.log('[Firebase] ready promise:', !!window.SkillBridgeFirebaseReady);

    // Authentication remains available even when this browser cannot use FCM.
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[FCM] Push notifications not supported in this browser.');
      return window.SkillBridgeFirebaseAuth;
    }

    // Register service worker
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('[FCM] Service Worker registered:', registration.scope);

    const messaging = getMessaging(app);

    // Request notification permission and get token
    async function requestPermissionAndToken() {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('[FCM] Notification permission denied.');
        return null;
      }

      // VAPID key from Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
      const VAPID_KEY = 'BMxxh_fauWmPpbxtWhQ8g17Awg5LGRsiCCMPPgzA3TjFUST-N_veLayidErDrNtBWE1XRgn-sNeX7j83hhpzOTM'; // Replace with your actual VAPID key from Firebase Console

      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });

      if (token) {
        console.log('[FCM] Registration token:', token.slice(0, 20) + '...');
        // Register token with backend
        await registerTokenWithBackend(token);
        return token;
      }
      return null;
    }

    // Register token with SkillBridge backend
    async function registerTokenWithBackend(token) {
      const authToken = await window.getSkillBridgeFirebaseIdToken();
      try {
        await fetch('/api/notifications/register-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
          body: JSON.stringify({ fcmToken: token, device: 'web' }),
        });
        localStorage.setItem('sb_fcm_token', token);
        console.log('[FCM] Token registered with SkillBridge backend.');
      } catch (e) {
        console.error('[FCM] Token registration failed:', e);
      }
    }

    // Handle foreground messages (when app is open)
    onMessage(messaging, (payload) => {
      console.log('[FCM] Foreground message:', payload);
      const { title, body } = payload.notification || {};
      const data = payload.data || {};

      // Show in-app toast notification
      if (window.showToast) {
        window.showToast(`${title}: ${body}`, 'info', 6000);
      }

      // Update notification badge
      updateNotificationBadge();

      // Dispatch custom event for notification pages to handle
      window.dispatchEvent(new CustomEvent('skillbridge-notification', { detail: payload }));
    });

    // Auto-request permission if user is logged in
    if (auth.currentUser) {
      // Request after short delay to not block page load
      setTimeout(requestPermissionAndToken, 3000);
    }

    // Expose globally for manual trigger
    window.SkillBridgeFCM = { requestPermissionAndToken, registerTokenWithBackend };
    return window.SkillBridgeFirebaseAuth;

  } catch (err) {
    console.error('[FCM] Initialization error:', err);
    if (window.SkillBridgeFirebaseAuth) return window.SkillBridgeFirebaseAuth;
    throw err;
  }
})();

function updateNotificationBadge() {
  const badges = document.querySelectorAll('.notif-badge');
  const count = parseInt(localStorage.getItem('sb_unread_notifs') || '0') + 1;
  localStorage.setItem('sb_unread_notifs', count);
  badges.forEach(b => {
    b.style.display = 'block';
    if (b.classList.contains('count-badge')) b.textContent = count;
  });
}
