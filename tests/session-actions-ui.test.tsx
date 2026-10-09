// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('会话重命名与归档界面', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('在更多菜单重命名、归档并恢复当前会话', async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    let session = { id: 'one', title: '北京旅行', conversationId: 1, status: 'collecting', brief: {}, messages: [], deliveries: [], createdAt: '', updatedAt: '' };
    const calls: string[] = [];
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/settings') return { ok: true, json: async () => ({ modelBaseUrl: '', modelName: '', amapJsKey: '', amapSecurityCode: '' }) };
      if (url === '/api/sessions' && !init?.method) return { ok: true, json: async () => session.status === 'archived' ? [] : [session] };
      if (url === '/api/archive' && !init?.method) return { ok: true, json: async () => session.status === 'archived' ? [session] : [] };
      if (url === '/api/sessions/one' && init?.method === 'PATCH') { const patch = JSON.parse(init.body as string); session = { ...session, ...(patch.title ? { title: patch.title } : { status: 'archived' }) }; return { ok: true, json: async () => session }; }
      if (url === '/api/archive/one/restore') { session = { ...session, status: 'collecting' }; return { ok: true, json: async () => session }; }
      throw new Error(`unexpected ${url}`);
    }));
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<App />); });
    await act(async () => { (host.querySelector('.session-select') as HTMLButtonElement).click(); });
    await act(async () => { (host.querySelector('[aria-label="更多会话操作"]') as HTMLButtonElement).click(); });
    await act(async () => { (host.querySelector('[aria-label="重命名当前会话"]') as HTMLButtonElement).click(); });
    const input = host.querySelector('[aria-label="新的会话名称"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '北京五日'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { (host.querySelector('[aria-label="保存会话名称"]') as HTMLButtonElement).click(); });
    expect(calls).toContain('PATCH /api/sessions/one');
    expect(session.title).toBe('北京五日');
    await act(async () => { (host.querySelector('[aria-label="更多会话操作"]') as HTMLButtonElement).click(); });
    await act(async () => { (host.querySelector('[aria-label="归档当前会话"]') as HTMLButtonElement).click(); });
    expect(host.querySelector('.session-select')).toBeNull();
    await act(async () => { (host.querySelector('[aria-label="打开归档会话"]') as HTMLButtonElement).click(); });
    await act(async () => { (host.querySelector('[aria-label="恢复归档会话"]') as HTMLButtonElement).click(); });
    expect(calls).toContain('POST /api/archive/one/restore');
    expect(host.querySelector('.session-select')).not.toBeNull();
    await act(async () => { root.unmount(); });
  });
});
