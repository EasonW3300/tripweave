import { describe, expect, it, vi } from 'vitest';
import { ModelClient } from '../src/server/model';

describe('模型规划', () => {
  it('只接受候选地点 ID，过滤模型捏造的节点', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ranked: [
      { id: 'known', tips: '慢慢游览' }, { id: 'invented', tips: '不存在' },
    ] }) } }] })));
    const model = new ModelClient('https://example.org/v1', 'key', 'test-model', request as typeof fetch);
    const ranked = await model.rankPlaces({ destination: '北京', durationDays: 1 }, [{ id: 'known', name: '已知景点', address: '' }]);
    expect(ranked).toEqual([{ id: 'known', tips: '慢慢游览' }]);
  });

  it('过滤模型生成的未经证实票价与开放时间', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ranked: [
      { id: 'known', tips: '门票60元，9:00开放，建议从正门游览。' },
    ] }) } }] })));
    const model = new ModelClient('https://example.org/v1', 'key', 'test-model', request as typeof fetch);
    const ranked = await model.rankPlaces({ destination: '北京', durationDays: 1 }, [{ id: 'known', name: '已知景点', address: '' }]);
    expect(ranked).toEqual([{ id: 'known', tips: '可根据个人兴趣安排游览；门票、开放与预约信息请另行核实。' }]);
  });
});
