import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TripService } from '../src/server/trip-service';

describe('多轮问询', () => {
  it('从模糊目的地开始，一次只问下一个关键问题', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-flow-'));
    const service = await TripService.open(folder);
    try {
      const session = await service.createSession();
      const first = await service.send(session.id, '我想下个月去北京旅游');
      expect(first.brief.destination).toBe('北京');
      expect(first.messages.at(-1)?.text).toContain('从哪个城市出发');
      const second = await service.send(session.id, '上海');
      expect(second.brief.origin).toBe('上海');
      expect(second.messages.at(-1)?.text).toContain('具体哪一天');
    } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('缺少规划凭证时记录可重试失败状态', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-busy-'));
    const service = await TripService.open(folder);
    try {
      const session = await service.createSession();
      await service.updateBrief(session.id, { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 1,
        adults: 1, budgetPerPersonCny: 1000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' });
      await expect(service.confirm(session.id)).rejects.toThrow('planning_keys_missing');
      expect(service.get(session.id)?.status).toBe('failed');
    } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('重启后把没有任务 ID 的中断规划标记为可重试', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-recover-'));
    const first = await TripService.open(folder);
    const session = await first.createSession();
    await first.close();
    const path = join(folder, 'sessions.json');
    const rows = JSON.parse(await readFile(path, 'utf8'));
    rows[0].status = 'planning';
    await writeFile(path, JSON.stringify(rows));
    const reopened = await TripService.open(folder);
    try {
      expect(reopened.get(session.id)?.status).toBe('failed');
      expect(reopened.get(session.id)?.messages.at(-1)?.text).toContain('中断');
    } finally { await reopened.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('回收站中的中断规划重启后也能恢复为可重试状态', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-trash-recover-'));
    const first = await TripService.open(folder);
    const session = await first.createSession();
    await first.trash(session.id);
    await first.close();
    const path = join(folder, 'sessions.json');
    const rows = JSON.parse(await readFile(path, 'utf8'));
    rows[0].status = 'planning';
    await writeFile(path, JSON.stringify(rows));
    const reopened = await TripService.open(folder);
    try { expect(reopened.listTrashed()[0].status).toBe('failed'); }
    finally { await reopened.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('相同请求 ID 重试不会重复写入聊天', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-idempotent-'));
    const service = await TripService.open(folder);
    try {
      const session = await service.createSession();
      const first = await service.send(session.id, '我想去北京', 'request-1');
      const repeated = await service.send(session.id, '我想去北京', 'request-1');
      expect(first.messages).toHaveLength(2);
      expect(repeated.messages).toHaveLength(2);
    } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('并发的相同请求 ID 也只产生一轮聊天', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-concurrent-'));
    const service = await TripService.open(folder);
    try {
      const session = await service.createSession();
      await Promise.all([service.send(session.id, '我想去北京', 'request-2'), service.send(session.id, '我想去北京', 'request-2')]);
      expect(service.get(session.id)?.messages).toHaveLength(2);
    } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
  });
});
