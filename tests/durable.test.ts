import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableJournal } from '../src/server/durable';

describe('Pi Durable 会话日志', () => {
  it('重启后保留独立会话与消息', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-'));
    try {
      const one = await DurableJournal.open(join(folder, 'trips.sqlite'));
      const beijing = await one.create();
      const chengdu = await one.create();
      await one.append(beijing, 'user', '我想去北京');
      await one.close();
      const two = await DurableJournal.open(join(folder, 'trips.sqlite'));
      expect(await two.messages(beijing)).toMatchObject([{ role: 'user', text: '我想去北京' }]);
      expect(await two.messages(chengdu)).toEqual([]);
      await two.close();
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('规划任务的完成结果在重新打开 storage 后仍可读取', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-task-'));
    try {
      const plan = async () => ({ id: 'delivery-1', tripSessionId: 's1', version: 1, status: 'ready' as const,
        city: '北京', durationDays: 0, estimatedTotalCny: 0, budgetTotalCny: 0, generatedAt: '', days: [], warnings: [] });
      const first = await DurableJournal.open(join(folder, 'trips.sqlite'), plan);
      const conversation = await first.create();
      const taskId = await first.startPlan(conversation, 's1');
      expect((await first.waitPlan(taskId)).id).toBe('delivery-1');
      await first.close();
      const second = await DurableJournal.open(join(folder, 'trips.sqlite'), plan);
      expect((await second.waitPlan(taskId)).id).toBe('delivery-1');
      await second.close();
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('带相同请求标记的日志在重启重放时不重复追加', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-journal-once-'));
    try {
      const first = await DurableJournal.open(join(folder, 'trips.sqlite'));
      const conversation = await first.create();
      await first.append(conversation, 'user', '去北京', 'request-1:user');
      await first.close();
      const second = await DurableJournal.open(join(folder, 'trips.sqlite'));
      await second.append(conversation, 'user', '去北京', 'request-1:user');
      expect(await second.messages(conversation)).toHaveLength(1);
      await second.close();
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
