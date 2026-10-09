import type { BriefSlot, TripBrief } from './trip';

// The fixed order makes the next question deterministic even when model extraction changes.
const required: BriefSlot[] = [
  'destination', 'origin', 'startDate', 'durationDays', 'adults',
  'budgetPerPersonCny', 'interests', 'pace', 'lodgingPreferences',
  'dietaryRestrictions', 'mobilityRestrictions',
];

export const slotQuestions: Record<BriefSlot, string> = {
  destination: '你想去哪个城市？',
  origin: '你从哪个城市出发？',
  startDate: '具体哪一天出发？请给我一个日期，例如 11 月 12 日。',
  durationDays: '计划玩几天？',
  adults: '一共有几位出行？如果有儿童，也请告诉我。',
  budgetPerPersonCny: '每人的旅行预算大约是多少？',
  interests: '你更喜欢历史文化、自然风景、美食，还是其他主题？',
  pace: '希望行程轻松一些，还是多逛几个地方？',
  lodgingPreferences: '住宿有什么偏好或限制？没有的话也可以直接说“无”。',
  dietaryRestrictions: '饮食方面有什么限制？没有的话也可以说“无”。',
  mobilityRestrictions: '步行强度或行动能力方面有什么限制？没有的话也可以说“无”。',
};

export function emptyBrief(): TripBrief { return {}; }

export function mergeBrief(current: TripBrief, patch: Partial<TripBrief>): TripBrief {
  const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) };
  if (next.durationDays !== undefined && (!Number.isInteger(next.durationDays) || next.durationDays < 1 || next.durationDays > 30)) throw new Error('invalid_duration');
  if (next.adults !== undefined && (!Number.isInteger(next.adults) || next.adults < 1 || next.adults > 20)) throw new Error('invalid_adults');
  if (next.budgetPerPersonCny !== undefined && (!Number.isFinite(next.budgetPerPersonCny) || next.budgetPerPersonCny <= 0)) throw new Error('invalid_budget');
  return next;
}

export function nextMissingSlot(brief: TripBrief): BriefSlot | null {
  return required.find((slot) => brief[slot] === undefined || brief[slot] === '') ?? null;
}

function isoDate(month: number, day: number, now: Date): string | undefined {
  const year = month < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : undefined;
}

// This extraction covers common explicit Chinese answers; the model adapter can add
// structured fields later, but vague dates deliberately remain unconfirmed.
export function parseUserMessage(text: string, now = new Date()): Partial<TripBrief> {
  const patch: Partial<TripBrief> = {};
  const city = text.match(/(?:去|到|目的地是|想去)([\u4e00-\u9fa5]{2,8}?)(?:旅游|旅行|玩|待|逛|，|。|\s|$)/);
  if (city) patch.destination = city[1].replace(/市$/, '');
  const origin = text.match(/(?:从|出发地是)([\u4e00-\u9fa5]{2,8}?)(?:出发|去|到|，|。|\s|$)/);
  if (origin) patch.origin = origin[1].replace(/市$/, '');
  const days = text.match(/(\d{1,2})\s*(?:天|日游)/);
  if (days) patch.durationDays = Number(days[1]);
  const budget = text.match(/(?:预算|经费|人均|每人)[^\d]{0,6}(\d{2,7})\s*元?/);
  if (budget) patch.budgetPerPersonCny = Number(budget[1]);
  const adults = text.match(/(\d{1,2})\s*(?:个人|人出行|位成人|位大人)/);
  if (adults) patch.adults = Number(adults[1]);
  const date = text.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?/);
  if (date) {
    if (date[1]) patch.startDate = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
    else patch.startDate = isoDate(Number(date[2]), Number(date[3]), now);
  }
  if (/没有?饮食限制|饮食(?:没有?|无)限制|不忌口/.test(text)) patch.dietaryRestrictions = '无';
  if (/没有?住宿限制|住宿(?:没有?|无)要求/.test(text)) patch.lodgingPreferences = '无';
  if (/没有?行动限制|步行(?:没有?|无)限制/.test(text)) patch.mobilityRestrictions = '无';
  if (/历史|博物馆|文化|古迹/.test(text)) patch.interests = '历史文化';
  else if (/美食|吃/.test(text)) patch.interests = '美食';
  else if (/自然|山水|公园/.test(text)) patch.interests = '自然风景';
  if (/轻松|悠闲|慢慢|不要太赶|别太赶/.test(text)) patch.pace = '轻松';
  else if (/紧凑|多逛|打卡/.test(text)) patch.pace = '充实';
  return patch;
}
