import { describe, expect, it } from 'vitest';
import { emptyBrief, mergeBrief, nextMissingSlot, parseUserMessage } from '../src/shared/brief';

describe('旅行简报', () => {
  it('从一句话中提取多个明确条件，并优先追问出发地', () => {
    const brief = mergeBrief(emptyBrief(), parseUserMessage('我想下个月去北京玩5天，预算每人5000元'));
    expect(brief.destination).toBe('北京');
    expect(brief.durationDays).toBe(5);
    expect(brief.budgetPerPersonCny).toBe(5000);
    expect(nextMissingSlot(brief)).toBe('origin');
  });

  it('把无饮食限制视为已回答，而不是缺失', () => {
    const brief = mergeBrief(emptyBrief(), parseUserMessage('没有饮食限制'));
    expect(brief.dietaryRestrictions).toBe('无');
  });

  it('拒绝无效预算与时长', () => {
    expect(() => mergeBrief(emptyBrief(), { budgetPerPersonCny: -1 })).toThrow();
    expect(() => mergeBrief(emptyBrief(), { durationDays: 0 })).toThrow();
  });
});
