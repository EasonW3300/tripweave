import type { BookingAction, TripBrief } from '../shared/trip';

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// These are search entry points, not checkout links. Provider URL parameters
// have no documented stability guarantee, so criteria are copied separately.
export function buildBookingActions(brief: Partial<TripBrief>): BookingAction[] {
  const { origin, destination, startDate, durationDays, adults } = brief;
  if (!origin || !destination || !startDate || !durationDays || !adults) return [];
  const route = `${origin} → ${destination}`;
  const nightAfter = addDays(startDate, durationDays);
  return [
    { kind: 'flight', label: '查机票', url: 'https://flights.ctrip.com/', criteria: `${route}；出发 ${startDate}；${adults} 位成人` },
    { kind: 'rail', label: '查 12306 车票', url: 'https://www.12306.cn/index/', criteria: `${route}；乘车 ${startDate}；${adults} 位成人` },
    { kind: 'hotel', label: '查酒店', url: 'https://hotels.ctrip.com/list', criteria: `${destination}；入住 ${startDate}；退房 ${nightAfter}；${adults} 位成人` },
  ];
}
