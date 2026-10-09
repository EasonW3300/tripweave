import { describe, expect, it, vi } from 'vitest';
import { AMapClient } from '../src/server/amap';

describe('高德地点适配器', () => {
  it('把高德 POI 坐标转换为带来源的节点候选', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ status: '1', pois: [{
      id: 'B000A8X98R', name: '故宫博物院', location: '116.397,39.916', address: '东城区',
      photos: [{ url: 'https://example.org/photo.jpg' }],
    }] }), { status: 200 }));
    const client = new AMapClient('test-key', request as typeof fetch);
    const places = await client.searchPlaces('北京', '博物馆');
    expect(places).toMatchObject([{ id: 'B000A8X98R', name: '故宫博物院', coordinates: [116.397, 39.916] }]);
    expect(places[0].sourceUrl).toContain('amap.com');
  });

  it('拒绝无效坐标', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ status: '1', pois: [{ id: 'x', name: '未知地点', location: 'bad' }] })));
    expect(await new AMapClient('key', request as typeof fetch).searchPlaces('北京', '景点')).toEqual([]);
  });

  it('解析高德驾车和公交方案的真实路径', async () => {
    const request = vi.fn(async (url: URL) => new Response(JSON.stringify(url.pathname.includes('driving')
      ? { status: '1', route: { paths: [{ duration: '600', distance: '3200', steps: [{ polyline: '116.39,39.91;116.40,39.92' }] }] } }
      : { status: '1', route: { transits: [{ duration: '900', distance: '4100', segments: [{ walking: { steps: [{ polyline: '116.39,39.91;116.40,39.92' }] }, bus: { buslines: [{ polyline: '116.40,39.92;116.41,39.93' }] } }] }] } })));
    const client = new AMapClient('key', request as typeof fetch);
    const car = await client.drivingRoute([116.39, 39.91], [116.40, 39.92]);
    const bus = await client.transitRoute([116.39, 39.91], [116.41, 39.93], '北京');
    expect(car).toMatchObject({ durationMinutes: 10, distanceMeters: 3200, path: [[116.39, 39.91], [116.40, 39.92]] });
    expect(bus).toMatchObject({ durationMinutes: 15, distanceMeters: 4100 });
    expect(bus.path.at(-1)).toEqual([116.41, 39.93]);
    expect(request.mock.calls[1][0].searchParams.get('city')).toBe('北京');
  });

  it('高德临时 503 时有上限地重试安全查询', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: '1', pois: [{ id: 'p', name: '景点', location: '116.4,39.9' }] }), { status: 200 }));
    const places = await new AMapClient('key', request as typeof fetch).searchPlaces('北京', '景点');
    expect(places).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
