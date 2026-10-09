import { describe, expect, it, vi } from 'vitest';
import { chooseCityRoute } from '../src/server/route-choice';

const from: [number, number] = [116.39, 39.91];
const to: [number, number] = [116.41, 39.93];

describe('市内交通选择', () => {
  it('行动受限时使用驾车，不调用步行方案', async () => {
    const adapter = { walkingRoute: vi.fn(), drivingRoute: vi.fn(async () => ({ durationMinutes: 20, distanceMeters: 6000, path: [from, to] })), transitRoute: vi.fn() };
    expect((await chooseCityRoute(adapter, '北京', '不能长距离步行', from, to)).mode).toBe('drive');
    expect(adapter.walkingRoute).not.toHaveBeenCalled();
  });

  it('步行超过五公里时优先公交，但公交失败可保留可接受的步行路线', async () => {
    const adapter = { walkingRoute: vi.fn(async () => ({ durationMinutes: 90, distanceMeters: 6000, path: [from, to] })), drivingRoute: vi.fn(), transitRoute: vi.fn(async () => ({ durationMinutes: 35, distanceMeters: 7000, path: [from, to] })) };
    expect((await chooseCityRoute(adapter, '北京', '无', from, to)).mode).toBe('transit');
    adapter.transitRoute.mockRejectedValueOnce(new Error('no_transit'));
    expect((await chooseCityRoute(adapter, '北京', '无', from, to)).mode).toBe('walk');
  });
});
