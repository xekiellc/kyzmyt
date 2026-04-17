// js/notifications.js
// Push notification registration and management

const VAPID_PUBLIC_KEY = window.ENV_VAPID_PUBLIC_KEY || '';

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('Service worker registered:', reg.scope);
    return reg;
  } catch (err) {
    console.warn('Service worker registration failed:', err);
    return null;
  }
}

export async function requestPushPermission(userId) {
  if (!('Notification' in window) || !('PushManager' in window)) {
    console.warn('Push notifications not supported');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  return await subscribeToPush(userId);
}

async function subscribeToPush(userId) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await saveSubscription(userId, existing);
      return true;
    }

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    await saveSubscription(userId, subscription);
    return true;
  } catch (err) {
    console.warn('Push subscription failed:', err);
    return false;
  }
}

async function saveSubscription(userId, subscription) {
  await fetch('/.netlify/functions/push-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      action: 'subscribe',
      subscription: subscription.toJSON()
    })
  });
}

export async function unregisterPush(userId) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    await fetch('/.netlify/functions/push-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'unsubscribe' })
    });
    return true;
  } catch {
    return false;
  }
}

export function showLocalNotification(title, body, url = '/pages/app.html') {
  if (Notification.permission === 'granted') {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, {
        body,
        icon: '/assets/icon-192.png',
        badge: '/assets/badge-72.png',
        data: { url },
        tag: 'kyzmyt-local'
      });
    });
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
