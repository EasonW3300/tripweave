import { describe, expect, it } from 'vitest';
import { buildBookingActions } from '../src/server/bookings';

describe('第三方预订搜索动作', () => {
  it('分别生成机票、12306 和酒店的可复制条件，不把条件塞进不稳定 URL', () => {
    const actions = buildBookingActions({ origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 5, adults: 2 });
    expect(actions.map((item) => item.kind)).toEqual(['flight', 'rail', 'hotel']);
    expect(actions[0].criteria).toContain('上海 → 北京');
    expect(actions[1].criteria).toContain('2026-11-08');
    expect(actions[2].criteria).toContain('2026-11-13');
    expect(actions.every((item) => item.url.startsWith('https://') && !item.url.includes('上海') && !item.url.includes('北京'))).toBe(true);
    expect(actions[1].url).toContain('12306.cn');
  });

  it('缺少必要简报时不生成貌似可用的预订动作', () => {
    expect(buildBookingActions({ destination: '北京' })).toEqual([]);
  });
});
