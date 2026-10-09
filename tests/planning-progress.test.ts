import { describe, expect, it } from 'vitest';
import { planningProgress } from '../src/client/planning-progress';

describe('公开规划进度', () => {
  it('把持久化阶段映射成可理解的状态和百分比', () => {
    expect(planningProgress('searching')).toEqual({ label: '检索地点与资料', percent: 25 });
    expect(planningProgress('routing')).toEqual({ label: '计算路线与步行距离', percent: 70 });
  });
});
