// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';

// React's act flushes async fetch-driven state before assertions about the
// visible session rail and recycle-bin dialog.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const session = (id: string, title: string) => ({ id, title, conversationId: 1, status: 'collecting', brief: {}, messages: [], deliveries: [], createdAt: '', updatedAt: '' });

describe('会话回收站界面', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('确认删除选中会话后可从回收站恢复', async () => {
    const first = session('one', '北京旅行');
    const second = session('two', '成都旅行');
    let active = [first, second];
    let trash: typeof active = [];
    const calls: string[] = [];
    HTMLElement.prototype.scrollTo = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/settings') return { ok: true, json: async () => ({ modelBaseUrl: '', modelName: '', hasModelApiKey: false, hasAmapWebKey: false, hasAmapJsKey: false, amapJsKey: '', amapSecurityCode: '' }) };
      if (url === '/api/sessions' && !init?.method) return { ok: true, json: async () => active };
      if (url === '/api/trash' && !init?.method) return { ok: true, json: async () => trash };
      if (url === '/api/sessions/one' && init?.method === 'DELETE') { active = [second]; trash = [first]; return { ok: true, json: async () => first }; }
      if (url === '/api/trash/one/restore') { active = [first, second]; trash = []; return { ok: true, json: async () => first }; }
      throw new Error(`unexpected ${url}`);
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<App />); });
    await act(async () => { (host.querySelector('.session-select') as HTMLButtonElement).click(); });
    expect(host.querySelector('[aria-label="删除当前会话"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="打开回收站"]')).not.toBeNull();
    await act(async () => { (host.querySelector('[aria-label="删除北京旅行"]') as HTMLButtonElement).click(); });
    expect(calls).toContain('DELETE /api/sessions/one');
    expect(host.querySelector('[aria-label="删除北京旅行"]')).toBeNull();
    await act(async () => { (host.querySelector('[aria-label="打开回收站"]') as HTMLButtonElement).click(); });
    await act(async () => { (host.querySelector('[aria-label="恢复北京旅行"]') as HTMLButtonElement).click(); });
    expect(calls).toContain('POST /api/trash/one/restore');
    expect(host.querySelector('[aria-label="删除北京旅行"]')).not.toBeNull();
    await act(async () => { root.unmount(); });
  });
});
