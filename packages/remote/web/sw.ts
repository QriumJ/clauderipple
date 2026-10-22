// Service worker: shows the host's pushes and opens the session on tap. A classic script (no
// imports), registered from app.ts. It caches nothing: the app's state lives on the host, and a
// stale offline copy of the shell would be one more thing that could lie.
//
// Every push shows a notification, even one that fails to parse: iOS revokes push for a site
// whose pushes show nothing.

interface RipplePush { title?: string; body?: string; session?: string; tag?: string }
interface SwWindow { url: string; focus(): Promise<unknown>; navigate(url: string): Promise<unknown> }
interface SwScope {
  addEventListener(type: "install" | "activate", fn: (e: { waitUntil(p: Promise<unknown>): void }) => void): void;
  addEventListener(type: "push", fn: (e: { data: { json(): unknown } | null; waitUntil(p: Promise<unknown>): void }) => void): void;
  addEventListener(type: "notificationclick", fn: (e: { notification: { data: unknown; close(): void }; waitUntil(p: Promise<unknown>): void }) => void): void;
  registration: { scope: string; showNotification(title: string, options: { body?: string; tag?: string; data?: unknown; icon?: string; badge?: string }): Promise<void> };
  clients: { matchAll(o: { type: "window"; includeUncontrolled: boolean }): Promise<SwWindow[]>; openWindow(url: string): Promise<unknown>; claim(): Promise<void> };
  skipWaiting(): Promise<void>;
}
const swScope = self as unknown as SwScope;

swScope.addEventListener("install", (e) => e.waitUntil(swScope.skipWaiting()));
swScope.addEventListener("activate", (e) => e.waitUntil(swScope.clients.claim()));

swScope.addEventListener("push", (e) => {
  let p: RipplePush = {};
  try { p = (e.data?.json() ?? {}) as RipplePush; } catch { /* shown generic below */ }
  e.waitUntil(swScope.registration.showNotification(p.title || "Ripple", {
    body: p.body ?? "",
    ...(p.tag ? { tag: p.tag } : {}),
    data: { session: p.session ?? null },
    icon: new URL("icon.svg", swScope.registration.scope).href,
  }));
});

swScope.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const session = (e.notification.data as { session?: string | null } | null)?.session;
  const target = new URL(session ? `./#/s/${encodeURIComponent(session)}` : "./", swScope.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await swScope.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins[0];
    if (win) {
      await win.focus();
      try { await win.navigate(target); } catch { /* not controlled yet: focusing is the most we can do */ }
      return;
    }
    await swScope.clients.openWindow(target);
  })());
});
