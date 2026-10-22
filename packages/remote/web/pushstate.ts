// Whether notifications can work on this phone — the decision only, no browser APIs, so it is
// tested in Node (notify.ts reads the browser and does the subscribing). The rules come from the
// platforms, not from us: a service worker (so push) needs a secure context — https, which the
// relay gives; on iPhone, web push exists only for a site added to the Home Screen and opened from
// there (iOS 16.4+).

export type PushAvail = "on" | "off" | "denied" | "install" | "insecure" | "unsupported";

export interface PushEnv {
  secure: boolean;
  hasServiceWorker: boolean;
  hasPush: boolean;
  ios: boolean;
  standalone: boolean;
  permission: "default" | "granted" | "denied" | null;
  subscribed: boolean;
}

export function pushAvailability(e: PushEnv): PushAvail {
  if (!e.secure) return "insecure";
  // iOS Safari outside the Home Screen app has no PushManager at all; say what to do, not "unsupported".
  if (e.ios && !e.standalone) return "install";
  if (!e.hasServiceWorker || !e.hasPush) return "unsupported";
  if (e.permission === "denied") return "denied";
  if (e.permission === "granted" && e.subscribed) return "on";
  return "off";
}
