import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../src/server/session-store';

describe('旅行会话', () => {
  it('独立保存两个会话，并在重启后恢复', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-sessions-'));
    try {
      const one = await SessionStore.open(join(folder, 'sessions.json'));
      const beijing = await one.create('北京旅行', 1);
      const chengdu = await one.create('成都旅行', 2);
      await one.update(beijing.id, (session) => { session.brief.destination = '北京'; });
      const two = await SessionStore.open(join(folder, 'sessions.json'));
      expect(two.get(beijing.id)?.brief.destination).toBe('北京');
      expect(two.get(chengdu.id)?.brief.destination).toBeUndefined();
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('只将指定会话移入回收站，恢复后保留原记录', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-trash-'));
    try {
      const store = await SessionStore.open(join(folder, 'sessions.json'));
      const beijing = await store.create('北京旅行', 1);
      const chengdu = await store.create('成都旅行', 2);
      await store.update(beijing.id, (session) => { session.brief.destination = '北京'; });
      await store.trash(beijing.id);
      expect(store.list().map((session) => session.id)).toEqual([chengdu.id]);
      expect(store.listTrashed().map((session) => session.id)).toEqual([beijing.id]);
      const reopened = await SessionStore.open(join(folder, 'sessions.json'));
      expect(reopened.listTrashed()[0].brief.destination).toBe('北京');
      await reopened.restore(beijing.id);
      expect(reopened.list().map((session) => session.id)).toContain(beijing.id);
      expect(reopened.get(beijing.id)?.brief.destination).toBe('北京');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('订阅者只收到指定会话的持久化更新', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-watch-'));
    try {
      const store = await SessionStore.open(join(folder, 'sessions.json'));
      const first = await store.create('北京', 1);
      const second = await store.create('成都', 2);
      const titles: string[] = [];
      const stop = store.watch(first.id, (session) => titles.push(session.title));
      await store.update(second.id, (session) => { session.title = '成都两日'; });
      await store.update(first.id, (session) => { session.title = '北京三日'; });
      stop();
      await store.update(first.id, (session) => { session.title = '北京四日'; });
      expect(titles).toEqual(['北京三日']);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
