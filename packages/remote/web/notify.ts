// Notifications on the phone, the browser half: reading what this browser offers (the decision is
// pushstate.ts) and subscribing. Permission may only be asked from a tap.
import type { PushEnv } from "./pushstate.ts";

export function browserPushEnv(subscribed: boolean): PushEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  return {
    secure: window.isSecureContext,
    hasServiceWorker: "serviceWorker" in nav,
    hasPush: "PushManager" in window,
    ios,
    standalone: matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    permission: "Notification" in window ? Notification.permission : null,
    subscribed,
  };
}

export function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64u.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64u.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Whether a subscription was made with this host's key; a host with a new key needs a new one. */
export function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // some browsers do not expose it; resubscribing every time would be worse
  const a = new Uint8Array(k);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Turn notifications on. Call straight from a tap: the permission prompt must be the first thing
 * that awaits, or iOS refuses it. `hostKey` is fetched before (the host's VAPID public key).
 */
export async function enablePush(hostKey: () => Promise<string>, register: (sub: PushSubscriptionJSON) => Promise<void>): Promise<"on" | "denied"> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const key = await hostKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await register(sub.toJSON());
  return "on";
}
