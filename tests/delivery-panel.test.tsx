import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeliveryPanel } from '../src/client/DeliveryPanel';
import type { ItineraryDelivery } from '../src/shared/trip';

describe('交付面板预订动作', () => {
  it('展示版本化搜索条件和第三方入口，不宣称已预订', () => {
    const delivery: ItineraryDelivery = {
      id: 'd', tripSessionId: 's', version: 1, status: 'ready', city: '北京', durationDays: 1,
      generatedAt: '', estimatedTotalCny: 0, budgetTotalCny: 1000, warnings: [],
      days: [{ date: '2026-11-08', dayNumber: 1, title: '文化', route: [{ fromItemId: 'p', toItemId: 'p', mode: 'drive', durationMinutes: 20, distanceMeters: 3000, path: [[116.4, 39.9], [116.41, 39.91]] }], items: [{ id: 'p', name: '故宫', type: 'attraction', startTime: '09:00', durationMinutes: 120, estimatedCostCny: 0, coordinates: [116.4, 39.9], sourceUrl: 'https://uri.amap.com/', tips: '', imageUrl: '', bookingUrl: '' }] }],
      bookingActions: [{ kind: 'rail', label: '查 12306 车票', url: 'https://www.12306.cn/index/', criteria: '上海 → 北京；2026-11-08' }],
      facts: [{ id: 'f', field: 'coordinates', value: '116.4,39.9', sourceUrl: 'https://uri.amap.com/', sourceTitle: '高德地图 · 故宫', retrievedAt: '2026-10-08T00:00:00Z', confidence: 'probable', provider: 'amap' }],
      budgetSummary: { knownTotalCny: 0, unknownItemCount: 4, complete: false },
    };
    const html = renderToStaticMarkup(<DeliveryPanel delivery={delivery} amapJsKey="" amapSecurityCode="" onClose={() => {}} />);
    expect(html).toContain('上海 → 北京');
    expect(html).toContain('12306');
    expect(html).toContain('搜索');
    expect(html).not.toContain('已预订');
    expect(html).toContain('费用未完整核实');
    expect(html).toContain('高德地图 · 故宫');
    expect(html).toContain('驾车约 20 分钟');
    expect(html).toContain('门票价格待核实');
    expect(html).toContain('开放时间待核实');
    expect(html).toContain('预约规则待核实');
    expect(html).toContain('AI 游览建议（未经核实）');
  });
});
