import { randomUUID } from 'node:crypto';
import { validateDelivery } from '../shared/itinerary';
import type { ItineraryDay, ItineraryDelivery, ItineraryItem, RouteLeg, TripBrief } from '../shared/trip';
import type { Place } from './amap';
import { buildBookingActions } from './bookings';

// Booking actions retain the confirmed search conditions with the versioned
// delivery; rendering them later never depends on the mutable current brief.

export interface RankedPlace { id: string; tips: string; }
export type RouteFunction = (from: [number, number], to: [number, number]) => Promise<{ durationMinutes: number; distanceMeters: number; path: [number, number][]; mode?: RouteLeg['mode'] }>;

function dayAt(start: string, offset: number): string {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

// The model may rank and describe AMap candidates, but only candidates returned
// by AMap can become stops. Real AMap routes connect the resulting stop IDs.
export async function buildDelivery(
  sessionId: string, version: number, brief: TripBrief, places: Place[], ranking: RankedPlace[], route: RouteFunction,
  routeMode: RouteLeg['mode'] = 'walk',
): Promise<ItineraryDelivery> {
  if (!brief.destination || !brief.startDate || !brief.durationDays || !brief.adults || !brief.budgetPerPersonCny) throw new Error('incomplete_brief');
  const byId = new Map(places.map((place) => [place.id, place]));
  const selected = ranking.map(({ id, tips }) => ({ place: byId.get(id), tips })).filter((entry): entry is { place: Place; tips: string } => !!entry.place);
  if (selected.length < brief.durationDays * 2) throw new Error('insufficient_verified_places');
  const retrievedAt = new Date().toISOString();
  // POI names and coordinates come from AMap, not the language model. The
  // provider is a useful location source but not proof of ticket/opening facts.
  const facts = selected.flatMap(({ place }) => [
    { id: `amap-name-${place.id}`, field: 'name' as const,
      value: place.name, sourceUrl: place.sourceUrl, sourceTitle: `高德地图 · ${place.name}`,
      retrievedAt, confidence: 'probable' as const, provider: 'amap' },
    ...(place.address ? [{ id: `amap-address-${place.id}`, field: 'address' as const,
      value: place.address, sourceUrl: place.sourceUrl, sourceTitle: `高德地图 · ${place.name}`,
      retrievedAt, confidence: 'probable' as const, provider: 'amap' }] : []),
    { id: `amap-location-${place.id}`, field: 'coordinates' as const,
      value: `${place.coordinates[0]},${place.coordinates[1]}`,
      sourceUrl: place.sourceUrl, sourceTitle: `高德地图 · ${place.name}`,
      retrievedAt, confidence: 'probable' as const, provider: 'amap' },
    ...(/^https:\/\//.test(place.imageUrl) ? [{ id: `amap-photo-${place.id}`, field: 'photo' as const,
      value: place.imageUrl, sourceUrl: place.imageUrl, sourceTitle: `高德地点配图 · ${place.name}`,
      retrievedAt, confidence: 'probable' as const, provider: 'amap' }] : []),
  ]);
  const days: ItineraryDay[] = [];
  const remaining = [...selected];
  for (let index = 0; index < brief.durationDays; index++) {
    // Keep model rank as the day anchor, then choose the closest still-unused
    // candidate to avoid alternating across distant city districts.
    const anchor = remaining.shift()!;
    const distance = (entry: typeof anchor) => {
      const dx = entry.place.coordinates[0] - anchor.place.coordinates[0];
      const dy = entry.place.coordinates[1] - anchor.place.coordinates[1];
      return dx * dx + dy * dy;
    };
    const candidates = remaining.map((entry, candidateIndex) => ({ entry, candidateIndex })).sort((a, b) => distance(a.entry) - distance(b.entry));
    let partnerIndex = -1;
    let transport: Awaited<ReturnType<RouteFunction>> | undefined;
    let lastError: Error = new Error('route_unavailable');
    for (const candidate of candidates) {
      try {
        const next = await route(anchor.place.coordinates, candidate.entry.place.coordinates);
        if ((next.mode ?? routeMode) === 'walk' && next.distanceMeters > 12000) { lastError = new Error('daily_walking_limit'); continue; }
        partnerIndex = candidate.candidateIndex;
        transport = next;
        break;
      } catch (error) { lastError = error as Error; }
    }
    if (partnerIndex < 0 || !transport) throw lastError;
    const pair = [anchor, remaining.splice(partnerIndex, 1)[0]];
    const firstStart = '09:30';
    const secondMinute = 9 * 60 + 30 + 150 + transport.durationMinutes + 60;
    const secondStart = `${String(Math.floor(secondMinute / 60)).padStart(2, '0')}:${String(secondMinute % 60).padStart(2, '0')}`;
    const items: ItineraryItem[] = pair.map(({ place, tips }, pairIndex) => ({
      id: place.id, name: place.name, type: 'attraction',
      startTime: pairIndex ? secondStart : firstStart, durationMinutes: 150,
      estimatedCostCny: null, coordinates: place.coordinates, sourceUrl: place.sourceUrl,
      imageUrl: /^https:\/\//.test(place.imageUrl) ? place.imageUrl : '', tips, bookingUrl: '',
      factIds: [`amap-name-${place.id}`, ...(place.address ? [`amap-address-${place.id}`] : []),
        `amap-location-${place.id}`, ...(/^https:\/\//.test(place.imageUrl) ? [`amap-photo-${place.id}`] : [])],
    }));
    const legs: RouteLeg[] = [{
      fromItemId: items[0].id, toItemId: items[1].id, mode: transport.mode ?? routeMode,
      durationMinutes: transport.durationMinutes, distanceMeters: transport.distanceMeters, path: transport.path,
    }];
    days.push({ date: dayAt(brief.startDate, index), dayNumber: index + 1, title: `${brief.destination} · 第 ${index + 1} 天`, items, route: legs });
  }
  const delivery: ItineraryDelivery = {
    id: randomUUID(), tripSessionId: sessionId, version, status: 'draft', city: brief.destination,
    durationDays: brief.durationDays, estimatedTotalCny: 0,
    budgetTotalCny: brief.budgetPerPersonCny * brief.adults,
    generatedAt: new Date().toISOString(), days,
    bookingActions: buildBookingActions(brief),
    facts, budgetSummary: { knownTotalCny: 0, unknownItemCount: days.reduce((sum, day) => sum + day.items.length, 0) + 3, complete: false },
    warnings: ['门票、餐饮、住宿与交通价格尚未核实；预算数字仅为用户设定上限，不是完整报价。', '出行前请通过景区官方渠道核实开放时间与预约要求。'],
  };
  const issues = validateDelivery(delivery);
  if (issues.length) throw new Error(`invalid_delivery:${issues.join(',')}`);
  return { ...delivery, status: 'ready' };
}
