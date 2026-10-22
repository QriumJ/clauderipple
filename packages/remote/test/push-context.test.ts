import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventLog } from '../src/eventlog.ts';
import { DesktopSessions } from '../src/desktop.ts';
import { Sessions } from '../src/sessions.ts';
import { PermissionQueue } from '../src/permissions.ts';

const done = { kind: 'result' as const, ok: true, ms: 1, turns: 1 };

test('host push context reads this turn before its result, not tools, thinking or a prior answer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-context-'));
  let sessions: Sessions | undefined;
  try {
    fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify([{ id: 's', sdkSessionId: null, cwd: '/private/folder', model: 'm', effort: null, title: 'Named session', createdAt: 1, updatedAt: 1, state: 'idle', createdBy: 'c', contextWindow: null }]));
    sessions = new Sessions({ dir, permissions: PermissionQueue.open(path.join(dir, 'permissions.json')),
      router: { status: async () => { throw new Error('must not call router'); }, figures: async () => { throw new Error('must not call router'); } },
      queryFn: () => { throw new Error('must not start a query'); }, onEvent: () => {}, onSessions: () => {} });
    const log = sessions.log('s');
    log.append({ kind: 'assistant', msg: 'old', model: 'm', text: 'Previous turn', tools: [] });
    log.append(done);
    log.append({ kind: 'turn', model: 'm', effort: null });
    log.append({ kind: 'assistant', msg: 'a', model: 'm', text: 'Implemented the push fix', tools: [] });
    log.append({ kind: 'thinking', msg: 'a', block: 0, text: 'PRIVATE REASONING' });
    log.append({ kind: 'tool_result', toolUseId: 't', ok: true, text: 'PRIVATE TOOL OUTPUT' });
    const result = log.append(done);
    assert.deepEqual(await sessions.pushContext('s', result), { title: 'Named session', cwd: '/private/folder', text: 'Implemented the push fix' });
    log.append({ kind: 'turn', model: 'm', effort: null });
    const empty = log.append(done);
    assert.equal((await sessions.pushContext('s', empty)).text, '');
  } finally { sessions?.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('large host answers use their preview and never expose a previous turn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-log-'));
  const log = EventLog.open({ dir });
  try {
    log.append({ kind: 'turn', model: 'm', effort: null });
    log.append({ kind: 'assistant', msg: 'large', model: 'm', text: 'Answer '.repeat(8000), tools: [] });
    const event = log.append(done);
    assert.ok(log.lastAssistantText(event.seq).startsWith('Answer '));
    log.append({ kind: 'turn', model: 'm', effort: null });
    assert.equal(log.lastAssistantText(), '');
  } finally { log.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Mac push context reads top-level final text and failure reason without importing a log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-mac-'));
  const project = path.join(dir, 'project'); fs.mkdirSync(project);
  const id = '11111111-1111-4111-8111-111111111111';
  const file = path.join(project, `${id}.jsonl`);
  const rows = [
    { type: 'user', cwd: '/private/folder', uuid: 'user', message: { content: 'Do work' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Old answer' }] } },
    { type: 'user', uuid: 'user2', message: { content: 'Now fix push' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed push end to end' }, { type: 'thinking', thinking: 'PRIVATE REASONING' }] } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'Worker secret' }] } },
    { type: 'result', subtype: 'error_during_execution', result: 'Timed out' },
  ];
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const desktop = new DesktopSessions({ projects: dir, summarize: () => '', excluded: () => new Set(), processes: () => '', registry: () => new Map() });
  try {
    assert.equal(desktop.list().length, 1);
    assert.deepEqual(desktop.pushContext(id), { text: 'Fixed push end to end', error: 'Timed out' });
    assert.deepEqual(fs.readdirSync(dir), ['project']);
  } finally { desktop.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
