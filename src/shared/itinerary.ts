import type { ItineraryDelivery } from './trip';

// Delivery validation is the publication gate. A draft may be stored, but only
// an empty issue list permits the server to create a ready version and chat card.
export function validateDelivery(delivery: ItineraryDelivery): string[] {
  const issues: string[] = [];
  const factIds = new Set(delivery.facts?.map((fact) => fact.id) ?? []);
  for (const fact of delivery.facts ?? []) {
    if (!/^https:\/\//.test(fact.sourceUrl) || !Number.isFinite(Date.parse(fact.retrievedAt))) issues.push('invalid_fact_source');
  }
  if (delivery.days.length !== delivery.durationDays || delivery.days.length === 0) issues.push('day_count_mismatch');
  if (delivery.estimatedTotalCny > delivery.budgetTotalCny) issues.push('over_budget');
  if (delivery.budgetSummary?.complete && delivery.budgetSummary.unknownItemCount > 0) issues.push('incomplete_budget_claim');
  if (delivery.budgetSummary && delivery.budgetSummary.knownTotalCny > delivery.budgetTotalCny) issues.push('over_budget');
  if (!delivery.city || !Number.isInteger(delivery.version) || delivery.version < 1) issues.push('invalid_metadata');
  for (const day of delivery.days) {
    if (!day.items.length) issues.push('empty_day');
    const ids = new Set(day.items.map((item) => item.id));
    for (const item of day.items) {
      const point = item.coordinates;
      if (!point || point.length !== 2 || !point.every(Number.isFinite) || point[0] < 70 || point[0] > 140 || point[1] < 0 || point[1] > 60) issues.push('missing_amap_coordinates');
      if (!item.sourceUrl || !/^https:\/\//.test(item.sourceUrl)) issues.push('missing_source');
      if (item.estimatedCostCny !== null && (!Number.isFinite(item.estimatedCostCny) || item.estimatedCostCny < 0)) issues.push('invalid_cost');
      if (item.factIds?.some((id) => !factIds.has(id))) issues.push('invalid_fact_reference');
      // A stop must fit in a conservative sightseeing window, even when
      // opening hours are not independently available from the provider.
      const clock = /^(\d{2}):(\d{2})$/.exec(item.startTime);
      const minute = clock ? Number(clock[1]) * 60 + Number(clock[2]) : NaN;
      if (!Number.isFinite(minute) || minute < 7 * 60 || minute + item.durationMinutes > 22 * 60) issues.push('outside_daily_window');
    }
    for (const leg of day.route) {
      if (!ids.has(leg.fromItemId) || !ids.has(leg.toItemId)) issues.push('invalid_route_reference');
    }
  }
  return [...new Set(issues)];
}
