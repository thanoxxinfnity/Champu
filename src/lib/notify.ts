/**
 * One quiet notification for finished background work.
 *
 * Phones can bury a user in alerts, so there is exactly one rule: a single notification slot (a fixed tag), which a newer message replaces rather
 * than stacks, shown only when the app is not on screen, and only after the user switched notifications on. A service worker registration is
 * used when there is one (Android shows those even with the tab in the background); otherwise the page's own Notification.
 */
import { getSetting, setSetting } from '@/lib/db/history';

const TAG = 'chomugiri-background';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined';
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function notificationsEnabled(): Promise<boolean> {
  return notificationsSupported() && Notification.permission === 'granted' && (await getSetting<boolean>('notificationsOn', false));
}

/** Asks the browser (this must come from a tap) and remembers the user's choice. */
export async function enableNotifications(on: boolean): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (!on) {
    await setSetting('notificationsOn', false);
    return Notification.permission;
  }
  const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  await setSetting('notificationsOn', result === 'granted');
  return result;
}

export async function notifyDone(title: string, body: string): Promise<void> {
  if (!(await notificationsEnabled())) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()) return; // the user is looking at it
  const options: NotificationOptions = { body: body.slice(0, 160), tag: TAG, silent: false };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) return void (await reg.showNotification(title, options));
  } catch {
    // fall through to the page's own notification
  }
  try {
    new Notification(title, options);
  } catch {
    // some WebViews refuse the constructor; there is nothing else to try
  }
}
