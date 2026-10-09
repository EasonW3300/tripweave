import { describe, expect, it } from 'vitest';
import { renderItineraryHtml } from '../src/server/html';
import type { ItineraryDelivery } from '../src/shared/trip';

describe('详细行程 HTML', () => {
  it('转义模型文本并保留版本、地图节点与供应商入口', () => {
    const delivery: ItineraryDelivery = {
      id: 'd1', tripSessionId: 's1', version: 2, status: 'ready', city: '北京', durationDays: 1,
      estimatedTotalCny: 0, budgetTotalCny: 5000, generatedAt: '2026-10-08T00:00:00Z', warnings: [],
      budgetSummary: { knownTotalCny: 0, unknownItemCount: 4, complete: false },
      facts: [{ id: 'f1', field: 'coordinates', value: '116.4,39.9', sourceUrl: 'https://uri.amap.com/', sourceTitle: '高德地图 · 故宫', retrievedAt: '2026-10-08T00:00:00Z', confidence: 'probable', provider: 'amap' }],
      days: [{ date: '2026-11-08', dayNumber: 1, title: '故宫路线', route: [], items: [{ id: 'p1', name: '故宫', type: 'attraction', startTime: '09:00', durationMinutes: 180, estimatedCostCny: 0, coordinates: [116.4, 39.9], sourceUrl: 'https://uri.amap.com/', tips: '<script>alert(1)</script>', imageUrl: '', bookingUrl: '' }] }],
    };
    const html = renderItineraryHtml(delivery, { origin: '上海', destination: '北京', startDate: '2026-11-08', adults: 1 });
    expect(html).toContain('版本 2');
    expect(html).toContain('故宫');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('12306');
    expect(html).toContain('2026-11-09');
    expect(html).toContain('高德地图 · 故宫');
    expect(html).toContain('费用未完整核实');
    expect(html).toContain('门票价格待核实');
    expect(html).toContain('开放时间待核实');
    expect(html).toContain('预约规则待核实');
    expect(html).toContain('AI 游览建议（未经核实）');
  });
});
