import { describe, expect, it } from 'vitest';
import { buildDelivery } from '../src/server/planner';
import type { Place } from '../src/server/amap';

const places: Place[] = [
  { id: 'p1', name: '甲景点', address: '', coordinates: [116.39, 39.91], imageUrl: '', sourceUrl: 'https://uri.amap.com/p1' },
  { id: 'p2', name: '乙景点', address: '', coordinates: [116.40, 39.92], imageUrl: '', sourceUrl: 'https://uri.amap.com/p2' },
];

describe('规划生成', () => {
  it('只接受高德候选，缺路线时不发布 ready 行程', async () => {
    const brief = { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 1, adults: 1,
      budgetPerPersonCny: 3000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' };
    await expect(buildDelivery('s1', 1, brief, places, [{ id: 'p1', tips: '慢慢游览' }, { id: 'p2', tips: '拍照' }],
      async () => { throw new Error('route_unavailable'); })).rejects.toThrow('route_unavailable');
  });

  it('将已验证节点和路线装入同一版本', async () => {
    const brief = { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 1, adults: 1,
      budgetPerPersonCny: 3000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' };
    const delivery = await buildDelivery('s1', 1, brief, places, [{ id: 'p1', tips: '慢慢游览' }, { id: 'p2', tips: '拍照' }],
      async () => ({ durationMinutes: 15, distanceMeters: 1000, path: [places[0].coordinates, places[1].coordinates] }));
    expect(delivery.status).toBe('ready');
    expect(delivery.days[0].route).toHaveLength(1);
    expect(delivery.days[0].items.map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(delivery.facts?.length).toBeGreaterThanOrEqual(2);
    expect(delivery.facts?.every((fact) => fact.sourceUrl.startsWith('https://') && !!fact.retrievedAt)).toBe(true);
    expect(delivery.facts?.every((fact) => fact.provider === 'amap' && !['openingHours', 'ticketPrice', 'reservation'].includes(fact.field))).toBe(true);
    expect(delivery.facts?.some((fact) => fact.field === 'name' && fact.value === '甲景点')).toBe(true);
    expect(delivery.days[0].items[0].factIds?.length).toBeGreaterThan(0);
    expect(delivery.budgetSummary?.complete).toBe(false);
    expect(delivery.days[0].items.every((item) => item.estimatedCostCny === null)).toBe(true);
  });

  it('配图存在时记录图片来源，避免无来源展示', async () => {
    const brief = { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 1, adults: 1,
      budgetPerPersonCny: 3000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' };
    const withPhoto = places.map((place, index) => index === 0 ? { ...place, imageUrl: 'https://example.org/photo.jpg' } : place);
    const delivery = await buildDelivery('s1', 1, brief, withPhoto, [{ id: 'p1', tips: '' }, { id: 'p2', tips: '' }],
      async (from, to) => ({ durationMinutes: 15, distanceMeters: 1000, path: [from, to] }));
    expect(delivery.facts?.some((fact) => fact.field === 'photo' && fact.sourceUrl === 'https://example.org/photo.jpg')).toBe(true);
  });

  it('优先把地理相近的候选安排同一天', async () => {
    const candidates: Place[] = [
      { id: 'a', name: 'A', address: '', coordinates: [116.39, 39.91], imageUrl: '', sourceUrl: 'https://uri.amap.com/a' },
      { id: 'b', name: 'B', address: '', coordinates: [117.00, 40.50], imageUrl: '', sourceUrl: 'https://uri.amap.com/b' },
      { id: 'c', name: 'C', address: '', coordinates: [116.40, 39.92], imageUrl: '', sourceUrl: 'https://uri.amap.com/c' },
      { id: 'd', name: 'D', address: '', coordinates: [117.01, 40.51], imageUrl: '', sourceUrl: 'https://uri.amap.com/d' },
    ];
    const brief = { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 2, adults: 1,
      budgetPerPersonCny: 3000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' };
    const delivery = await buildDelivery('s1', 1, brief, candidates, candidates.map((place) => ({ id: place.id, tips: '' })),
      async (from, to) => ({ durationMinutes: 15, distanceMeters: Math.abs(from[0] - to[0]) * 100000, path: [from, to] }));
    expect(delivery.days.map((day) => day.items.map((item) => item.id))).toEqual([['a', 'c'], ['b', 'd']]);
  });

  it('最近节点路线不可用时尝试同类备选', async () => {
    const candidates: Place[] = [
      { id: 'a', name: 'A', address: '', coordinates: [116.39, 39.91], imageUrl: '', sourceUrl: 'https://uri.amap.com/a' },
      { id: 'b', name: 'B', address: '', coordinates: [116.40, 39.92], imageUrl: '', sourceUrl: 'https://uri.amap.com/b' },
      { id: 'c', name: 'C', address: '', coordinates: [116.41, 39.93], imageUrl: '', sourceUrl: 'https://uri.amap.com/c' },
    ];
    const brief = { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 1, adults: 1,
      budgetPerPersonCny: 3000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' };
    const delivery = await buildDelivery('s1', 1, brief, candidates, candidates.map((place) => ({ id: place.id, tips: '' })),
      async (from, to) => { if (to[0] === 116.40) throw new Error('route_unavailable'); return { durationMinutes: 20, distanceMeters: 1500, path: [from, to] }; });
    expect(delivery.days[0].items.map((item) => item.id)).toEqual(['a', 'c']);
    expect(delivery.budgetSummary?.unknownItemCount).toBe(5);
  });

  it('行动受限时允许驾车路线且不误报步行超限', async () => {
    const brief = { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 1, adults: 1,
      budgetPerPersonCny: 3000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '不能长距离步行' };
    const delivery = await buildDelivery('s1', 1, brief, places, [{ id: 'p1', tips: '' }, { id: 'p2', tips: '' }],
      async (from, to) => ({ durationMinutes: 15, distanceMeters: 15000, path: [from, to] }), 'drive');
    expect(delivery.days[0].route[0].mode).toBe('drive');
  });

  it('远距离公共交通方案不被步行上限误拒', async () => {
    const brief = { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 1, adults: 1,
      budgetPerPersonCny: 3000, interests: '文化', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' };
    const delivery = await buildDelivery('s1', 1, brief, places, [{ id: 'p1', tips: '' }, { id: 'p2', tips: '' }],
      async (from, to) => ({ durationMinutes: 30, distanceMeters: 15000, path: [from, to], mode: 'transit' as const }));
    expect(delivery.days[0].route[0].mode).toBe('transit');
  });
});
