import { describe, expect, it } from 'vitest';
import { validateDelivery } from '../src/shared/itinerary';
import type { ItineraryDelivery } from '../src/shared/trip';

const valid: ItineraryDelivery = {
  id: 'trip-1-v1', tripSessionId: 'trip-1', version: 1, status: 'draft',
  city: '北京', durationDays: 1, estimatedTotalCny: 300, budgetTotalCny: 500,
  generatedAt: '2026-10-08T00:00:00.000Z', days: [{
    date: '2026-11-08', dayNumber: 1, title: '北京中轴线', route: [],
    items: [{ id: 'item-1', name: '故宫博物院', type: 'attraction', startTime: '09:00',
      durationMinutes: 180, estimatedCostCny: 60, coordinates: [116.397, 39.916],
      sourceUrl: 'https://www.dpm.org.cn/', tips: '提前预约', imageUrl: '', bookingUrl: '' }],
  }], warnings: [],
};

describe('行程校验', () => {
  it('没有高德坐标的景点不能交付', () => {
    const delivery = structuredClone(valid);
    delivery.days[0].items[0].coordinates = null;
    expect(validateDelivery(delivery)).toContain('missing_amap_coordinates');
  });

  it('超预算行程不能交付', () => {
    expect(validateDelivery({ ...valid, estimatedTotalCny: 800 })).toContain('over_budget');
  });

  it('有来源且约束满足的行程通过', () => {
    expect(validateDelivery(valid)).toEqual([]);
  });

  it('拒绝不存在的事实引用与不可能的时间窗', () => {
    const delivery = structuredClone(valid);
    delivery.facts = [];
    delivery.days[0].items[0].factIds = ['missing'];
    delivery.days[0].items[0].startTime = '23:30';
    expect(validateDelivery(delivery)).toContain('invalid_fact_reference');
    expect(validateDelivery(delivery)).toContain('outside_daily_window');
  });

  it('预算摘要不能把未知费用宣称为完整核验', () => {
    const delivery = structuredClone(valid);
    delivery.budgetSummary = { knownTotalCny: 300, unknownItemCount: 1, complete: true };
    expect(validateDelivery(delivery)).toContain('incomplete_budget_claim');
  });
});
