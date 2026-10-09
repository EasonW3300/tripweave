import type { TripSession } from '../shared/trip';

const stages: Record<NonNullable<TripSession['planningStep']>, { label: string; percent: number }> = {
  queued: { label: '准备规划任务', percent: 10 },
  searching: { label: '检索地点与资料', percent: 25 },
  ranking: { label: '筛选匹配地点', percent: 50 },
  routing: { label: '计算路线与步行距离', percent: 70 },
  validating: { label: '校验并整理行程', percent: 90 },
};

// This is a public workflow stage, never a model thought trace or ETA.
export function planningProgress(step: TripSession['planningStep']) {
  return stages[step ?? 'queued'];
}
