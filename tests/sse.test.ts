import { describe, expect, it } from 'vitest';
import { formatSessionEvent } from '../src/server/sse';

describe('会话事件流', () => {
  it('把一次会话快照编码为合法 SSE 帧', () => {
    expect(formatSessionEvent('snapshot', { id: 's1', text: '北京\n旅行' })).toBe('event: snapshot\ndata: {"id":"s1","text":"北京\\n旅行"}\n\n');
  });
});
