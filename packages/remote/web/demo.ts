// Fixture states for the design screenshots (`?demo=<name>&theme=light|dark`). They drive the
// real App renderer with canned data and no socket, so docs/media/remote shows the shipped UI.
import type { BrowseResult, EventBody, Figures, ProviderGroup, SessionEvent, SessionSummary } from "../src/protocol.ts";
import { App } from "./app.ts";

const HOME = "/Users/me";
const now = Date.now();
const min = 60_000;

const MODELS: ProviderGroup[] = [
  { provider: "chatgpt", label: "ChatGPT", usable: true, models: [
    { model: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "chatgpt", efforts: ["low", "medium", "high", "xhigh", "max"], usable: true },
    { model: "gpt-6-astra", name: "GPT-6 Astra", provider: "chatgpt", efforts: ["low", "medium", "high", "xhigh", "max"], usable: true },
    { model: "gpt-6-luna", name: "GPT-6 Luna", provider: "chatgpt", efforts: ["low", "medium", "high", "xhigh", "max"], usable: true },
  ] },
  { provider: "anthropic", label: "Claude", usable: true, models: [
    { model: "claude-opus-5-5", name: "Opus 5.5", provider: "anthropic", efforts: ["low", "medium", "high", "max"], usable: true },
    { model: "claude-sonnet-5-5", name: "Sonnet 5.5", provider: "anthropic", efforts: ["low", "medium", "high", "max"], usable: true },
  ] },
  { provider: "opencode-go", label: "OpenCode Go", usable: true, models: [
    { model: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", provider: "opencode-go", efforts: ["low", "high", "max"], usable: true },
    { model: "glm-5.3-flash", name: "glm-5.3-flash", provider: "opencode-go", efforts: ["low", "high", "max"], usable: true },
  ] },
  { provider: "google-gemini", label: "Google Gemini", usable: false, models: [
    { model: "gemini-3.8-flash", name: "gemini-3.8-flash", provider: "google-gemini", efforts: ["low", "medium", "high"], usable: false },
  ] },
];

const SESSIONS: SessionSummary[] = [
  { id: "s1", title: "로그인 토큰 갱신이 두 번 도는 버그 고쳐줘", cwd: `${HOME}/code/dayripple`, model: "gpt-6.1-sol", effort: "high", state: "waiting", pending: 1, createdAt: now - 14 * min, updatedAt: now - 1 * min, lastSeq: 40, epoch: "e" },
  { id: "s2", title: "README 영어판을 한국어판에 맞춰 갱신", cwd: `${HOME}/Documents/ClaudeRipple`, model: "deepseek-v4.1-flash", effort: "high", state: "running", pending: 0, createdAt: now - 6 * min, updatedAt: now - 0.2 * min, lastSeq: 22, epoch: "e" },
  { id: "s3", title: "결제 웹훅 재시도 로직 설계 검토", cwd: `${HOME}/code/bodyripple`, model: "claude-opus-5-5", effort: "max", state: "idle", pending: 0, createdAt: now - 200 * min, updatedAt: now - 95 * min, lastSeq: 88, epoch: "e" },
  { id: "s4", title: "테스트 깨진 것 원인만 찾아줘 (수정 금지)", cwd: `${HOME}/code/talkripple`, model: "glm-5.3-flash", effort: "low", state: "stopped", pending: 0, createdAt: now - 3000 * min, updatedAt: now - 1500 * min, lastSeq: 31, epoch: "e" },
];

const FIG: Figures = { effort: "high", cachePct: 94, contextPct: 38, fiveHourPct: 12, fiveHourResetAt: now + 130 * min, workers: [{ model: "deepseek-v4.1-flash", provider: "opencode-go", requests: 12 }, { model: "gpt-6-luna", provider: "chatgpt", requests: 3 }], at: now - 20_000 };

function events(bodies: EventBody[], start = now - 9 * min): SessionEvent[] {
  return bodies.map((b, i) => ({ ...b, seq: i + 1, at: start + i * 9000 } as SessionEvent));
}

const ANSWER = "원인을 찾았습니다. `refreshToken()`이 **두 곳**에서 불립니다.\n\n1. `useSession` 훅이 마운트될 때\n2. `apiClient`의 401 인터셉터가 같은 순간에\n\n둘이 동시에 돌면 첫 번째가 받은 토큰을 두 번째가 무효로 만듭니다. 인터셉터 쪽에 진행 중인 갱신을 공유하는 잠금을 두겠습니다.";

const CHAT = (streaming: boolean, perm: boolean): EventBody[] => [
  { kind: "user", text: "로그인 토큰 갱신이 두 번 도는 버그 고쳐줘. 앱을 켜자마자 가끔 로그아웃돼.", clientMsgId: "c1" },
  { kind: "turn", model: "gpt-6.1-sol", effort: "high" },
  { kind: "state", state: "running" },
  { kind: "figures", figures: FIG },
  { kind: "assistant", msg: "m1", model: "gpt-6.1-sol", text: "먼저 토큰을 갱신하는 곳을 모두 찾아보겠습니다.", tools: [
    { id: "t1", name: "Grep", summary: "refreshToken  src/" },
    { id: "t2", name: "Read", summary: "src/api/client.ts" },
  ] },
  { kind: "tool_result", toolUseId: "t1", ok: true, text: "src/hooks/useSession.ts:42\nsrc/api/client.ts:88" },
  { kind: "tool_result", toolUseId: "t2", ok: true, text: "…" },
  { kind: "subagent", toolUseId: "t3", sub: "sub-t3", description: "갱신 경쟁 상태를 재현하는 테스트 작성", model: "deepseek-v4.1-flash", status: "done", steps: 7 },
  ...(streaming
    ? [{ kind: "delta", msg: "m2", text: ANSWER.slice(0, 150) } as EventBody]
    : [
      { kind: "assistant", msg: "m2", model: "gpt-6.1-sol", text: ANSWER, tools: [{ id: "t4", name: "Edit", summary: "src/api/client.ts  +14 −3" }] } as EventBody,
      { kind: "tool_result", toolUseId: "t4", ok: true, text: "ok" } as EventBody,
    ]),
  ...(!streaming && !perm ? [
    { kind: "result", ok: true, ms: 74_000, turns: 6 } as EventBody,
    { kind: "state", state: "idle" } as EventBody,
  ] : []),
  ...(perm ? [
    { kind: "state", state: "waiting" } as EventBody,
    { kind: "permission", id: "p1", tool: "Bash", title: "테스트를 실행해도 될까요?", summary: "npm test -- src/api", input: "npm test -- src/api/client.test.ts --reporter=dot", canAlways: true } as EventBody,
  ] : []),
];

const BROWSE: BrowseResult = { path: `${HOME}/code`, parent: HOME, home: HOME, truncated: false, entries: ["bodyripple", "carlog", "dayripple", "mambo", "talkripple"].map((n) => ({ path: `${HOME}/code/${n}`, name: n })) };

export function runDemo(name: string, params: URLSearchParams): void {
  const theme = params.get("theme");
  if (theme) document.documentElement.dataset.theme = theme;
  const open = { state: "open" as const, attempt: 0, nextAt: null, lastRx: now - 2000, downSince: null };
  const app = new App(open);
  app.ui.now = now;
  app.ui.host = { name: "MacBook Pro", version: "0.8.10", routerOk: true };
  app.ui.home = HOME;
  app.ui.models = MODELS;
  app.ui.sessions = SESSIONS;
  app.ui.draft = { cwd: `${HOME}/Documents/ClaudeRipple`, model: "gpt-6.1-sol", effort: "high" };
  app.recentModels = ["gpt-6.1-sol", "deepseek-v4.1-flash", "claude-opus-5-5"];
  app.outbox = [];
  const session = (evs: EventBody[], state: SessionSummary["state"] = "running"): void => {
    app.ui.sessions = [{ ...SESSIONS[0]!, state, pending: 0 }];
    const c = app.cache("s1");
    c.events = events(evs);
    c.epoch = "e";
    app.screen = { name: "session", id: "s1" };
  };
  switch (name) {
    case "pair": app.screen = { name: "pair" }; break;
    case "home": app.screen = { name: "home" }; break;
    case "home-empty": app.ui.sessions = []; app.screen = { name: "home" }; break;
    case "folder":
      app.screen = { name: "home" };
      app.ui.sheet = { kind: "folder", loading: false, filter: "", browse: BROWSE, recent: [
        { path: `${HOME}/Documents/ClaudeRipple`, name: "ClaudeRipple", lastUsed: now - 6 * min },
        { path: `${HOME}/code/dayripple`, name: "dayripple", lastUsed: now - 14 * min },
        { path: `${HOME}/code/bodyripple`, name: "bodyripple", lastUsed: now - 95 * min },
      ] };
      break;
    case "model":
      app.screen = { name: "home" };
      app.ui.sheet = { kind: "model", groups: MODELS, recent: app.recentModels, model: "gpt-6.1-sol", effort: "high", forSession: null };
      break;
    case "stream": session(CHAT(true, false)); break;
    case "permission": session(CHAT(false, true), "waiting"); break;
    case "workers": session(CHAT(false, false), "idle"); app.ui.workersOpen = true; break;
    case "reconnecting":
      session(CHAT(true, false));
      app.ui.link = { state: "waiting", attempt: 3, nextAt: now + 3000, lastRx: now - 9000, downSince: now - 9000 };
      break;
    case "lost":
      session(CHAT(true, false));
      app.ui.link = { state: "waiting", attempt: 9, nextAt: now + 9000, lastRx: now - 134_000, downSince: now - 134_000 };
      app.outbox = [{ clientMsgId: "q1", session: "s1", text: "잠금 말고 단일 비행(single-flight)으로 해줘", at: now - 40_000, state: "pending" }];
      break;
    case "offline":
      app.screen = { name: "home" };
      app.ui.link = { state: "offline", attempt: 2, nextAt: null, lastRx: now - 50_000, downSince: now - 50_000 };
      break;
  }
  app.render();
  if (name === "stream" || name === "reconnecting" || name === "lost") {
    // Clock pinned so "working for" reads the same on every render.
    app.cache("s1").events.forEach((e) => { if (e.kind === "turn") e.at = now - 42_000; });
    app.renderSession();
  }
  document.body.dataset.ready = "1";
}
