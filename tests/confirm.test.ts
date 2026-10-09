import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TripService } from '../src/server/trip-service';
import type { ItineraryDelivery } from '../src/shared/trip';

describe('简报确认', () => {
  it('信息不完整时拒绝启动规划', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-confirm-'));
    const service = await TripService.open(folder);
    try {
      const session = await service.createSession();
      await expect(service.confirm(session.id)).rejects.toThrow('incomplete_brief');
    } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('规划成功后才产生交付卡片', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-ready-'));
    const service = await TripService.open(folder, async (session) => ({
      id: 'd1', tripSessionId: session.id, version: 1, status: 'ready', city: '北京', durationDays: 1,
      estimatedTotalCny: 100, budgetTotalCny: 1000, generatedAt: new Date().toISOString(), warnings: [],
      days: [{ date: '2026-11-08', dayNumber: 1, title: '北京', route: [], items: [{ id: 'p1', name: '景点', type: 'attraction', startTime: '09:00', durationMinutes: 120, estimatedCostCny: 100, coordinates: [116.4, 39.9], sourceUrl: 'https://amap.com/', tips: '', imageUrl: '', bookingUrl: '' }] }],
    } satisfies ItineraryDelivery));
    try {
      const session = await service.createSession();
      await service.updateBrief(session.id, { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 1,
        adults: 1, budgetPerPersonCny: 1000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' });
      const ready = await service.confirm(session.id);
      expect(ready.status).toBe('ready');
      expect(ready.messages.at(-1)?.deliveryVersion).toBe(1);
    } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('规划中的公开阶段可查询，完成后清除', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-progress-'));
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = await TripService.open(folder, async (session, report) => {
      await report('searching');
      entered();
      await gate;
      return { id: 'd1', tripSessionId: session.id, version: 1, status: 'ready', city: '北京', durationDays: 1,
        estimatedTotalCny: 0, budgetTotalCny: 1000, generatedAt: '', days: [], warnings: [] } as ItineraryDelivery;
    });
    try {
      const session = await service.createSession();
      await service.updateBrief(session.id, { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 1,
        adults: 1, budgetPerPersonCny: 1000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' });
      const finishing = service.confirm(session.id);
      await started;
      expect(service.get(session.id)?.planningStep).toBe('searching');
      release();
      await finishing;
      expect(service.get(session.id)?.planningStep).toBeUndefined();
    } finally { release(); await service.close(); await rm(folder, { recursive: true, force: true }); }
  });
});
