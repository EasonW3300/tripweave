import type { AMapClient } from './amap';
import type { RouteFunction } from './planner';

// AMap's mode-specific services return road geometry and travel time. This
// selector chooses a feasible mode; it does not claim venue accessibility.
export async function chooseCityRoute(
  adapter: Pick<AMapClient, 'walkingRoute' | 'drivingRoute' | 'transitRoute'>,
  city: string, mobilityRestrictions: string,
  from: [number, number], to: [number, number],
): ReturnType<RouteFunction> {
  if (/轮椅|行动不便|不能步行|不能长距离步行/.test(mobilityRestrictions)) {
    return { ...await adapter.drivingRoute(from, to), mode: 'drive' };
  }
  let walking: Awaited<ReturnType<AMapClient['walkingRoute']>> | undefined;
  try {
    walking = await adapter.walkingRoute(from, to);
    if (walking.distanceMeters <= 5000) return { ...walking, mode: 'walk' };
  } catch { /* A transit route may still connect these two locations. */ }
  try { return { ...await adapter.transitRoute(from, to, city), mode: 'transit' }; }
  catch (error) {
    if (walking && walking.distanceMeters <= 12000) return { ...walking, mode: 'walk' };
    throw error;
  }
}
