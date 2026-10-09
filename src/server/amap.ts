export interface Place {
  id: string;
  name: string;
  address: string;
  coordinates: [number, number];
  imageUrl: string;
  sourceUrl: string;
}

interface AMapPoi {
  id?: string;
  name?: string;
  location?: string;
  address?: string | unknown[];
  photos?: { url?: string }[];
}

function parsePolyline(value: string): [number, number][] {
  return value.split(';').flatMap((pair): [number, number][] => {
    const [lng, lat] = pair.split(',').map(Number);
    return Number.isFinite(lng) && Number.isFinite(lat) && lng >= 70 && lng <= 140 && lat >= 0 && lat <= 60 ? [[lng, lat]] : [];
  });
}

function routeResult(duration: string, distance: string, path: [number, number][]) {
  const durationMinutes = Math.ceil(Number(duration) / 60);
  const distanceMeters = Number(distance);
  if (!Number.isFinite(durationMinutes) || !Number.isFinite(distanceMeters) || durationMinutes < 0 || distanceMeters < 0 || path.length < 2) throw new Error('amap_route_invalid');
  return { durationMinutes, distanceMeters, path };
}

// Only AMap-supplied coordinates enter the itinerary. Failed or malformed POIs
// are discarded, so the language model never has a chance to invent map points.
export class AMapClient {
  constructor(private readonly key: string, private readonly request: typeof fetch = fetch) {}

  private async get(url: URL): Promise<Response> {
    // GET-only AMap queries are replay-safe. Retry transient transport/5xx
    // failures at most twice; quota and credential errors are not retried.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.request(url, { signal: AbortSignal.timeout(12000) });
        if (response.ok || ![502, 503, 504].includes(response.status) || attempt === 2) return response;
      } catch (error) { if (attempt === 2) throw error; }
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    }
    throw new Error('amap_unreachable');
  }

  async searchPlaces(city: string, keywords: string): Promise<Place[]> {
    const url = new URL('https://restapi.amap.com/v3/place/text');
    url.searchParams.set('key', this.key);
    url.searchParams.set('city', city);
    url.searchParams.set('keywords', keywords);
    url.searchParams.set('offset', '15');
    url.searchParams.set('extensions', 'all');
    const response = await this.get(url);
    if (!response.ok) throw new Error('amap_http_error');
    const body = await response.json() as { status?: string; infocode?: string; pois?: AMapPoi[] };
    if (body.status !== '1') throw new Error(`amap_${body.infocode ?? 'error'}`);
    return (body.pois ?? []).flatMap((poi): Place[] => {
      const [lng, lat] = (poi.location ?? '').split(',').map(Number);
      if (!poi.id || !poi.name || !Number.isFinite(lng) || !Number.isFinite(lat) || lng < 70 || lng > 140 || lat < 0 || lat > 60) return [];
      return [{
        id: poi.id, name: poi.name, address: typeof poi.address === 'string' ? poi.address : '',
        coordinates: [lng, lat], imageUrl: poi.photos?.[0]?.url ?? '',
        sourceUrl: `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(poi.name)}`,
      }];
    });
  }

  async walkingRoute(from: [number, number], to: [number, number]): Promise<{ durationMinutes: number; distanceMeters: number; path: [number, number][] }> {
    const url = new URL('https://restapi.amap.com/v3/direction/walking');
    url.searchParams.set('key', this.key);
    url.searchParams.set('origin', from.join(','));
    url.searchParams.set('destination', to.join(','));
    const response = await this.get(url);
    if (!response.ok) throw new Error('amap_route_http_error');
    const body = await response.json() as { status?: string; route?: { paths?: { duration?: string; distance?: string; steps?: { polyline?: string }[] }[] } };
    const route = body.route?.paths?.[0];
    if (body.status !== '1' || !route) throw new Error('amap_route_unavailable');
    const path = (route.steps ?? []).flatMap((step) => parsePolyline(step.polyline ?? ''));
    return routeResult(route.duration ?? '', route.distance ?? '', path);
  }

  async drivingRoute(from: [number, number], to: [number, number]) {
    const url = new URL('https://restapi.amap.com/v3/direction/driving');
    url.searchParams.set('key', this.key);
    url.searchParams.set('origin', from.join(','));
    url.searchParams.set('destination', to.join(','));
    url.searchParams.set('extensions', 'all');
    const response = await this.get(url);
    if (!response.ok) throw new Error('amap_route_http_error');
    const body = await response.json() as { status?: string; route?: { paths?: { duration?: string; distance?: string; steps?: { polyline?: string }[] }[] } };
    const path = body.route?.paths?.[0];
    if (body.status !== '1' || !path) throw new Error('amap_route_unavailable');
    return routeResult(path.duration ?? '', path.distance ?? '', (path.steps ?? []).flatMap((step) => parsePolyline(step.polyline ?? '')));
  }

  async transitRoute(from: [number, number], to: [number, number], city: string) {
    const url = new URL('https://restapi.amap.com/v3/direction/transit/integrated');
    url.searchParams.set('key', this.key);
    url.searchParams.set('origin', from.join(','));
    url.searchParams.set('destination', to.join(','));
    url.searchParams.set('city', city);
    url.searchParams.set('extensions', 'all');
    const response = await this.get(url);
    if (!response.ok) throw new Error('amap_route_http_error');
    const body = await response.json() as { status?: string; route?: { transits?: { duration?: string; distance?: string; segments?: { walking?: { steps?: { polyline?: string }[] }; bus?: { buslines?: { polyline?: string }[] } }[] }[] } };
    const transit = body.route?.transits?.[0];
    if (body.status !== '1' || !transit) throw new Error('amap_route_unavailable');
    const path = (transit.segments ?? []).flatMap((segment) => [
      ...(segment.walking?.steps ?? []).flatMap((step) => parsePolyline(step.polyline ?? '')),
      ...(segment.bus?.buslines ?? []).flatMap((line) => parsePolyline(line.polyline ?? '')),
    ]);
    return routeResult(transit.duration ?? '', transit.distance ?? '', path);
  }
}
