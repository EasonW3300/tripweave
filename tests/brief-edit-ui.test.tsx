// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';

// Flush React's fetch-driven projection updates before checking the brief editor.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('旅行简报编辑', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('确认前可修改预算，并把修订后的简报送给服务端', async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    let session = { id: 'one', title: '北京旅行', conversationId: 1, status: 'confirming',
      brief: { origin: '上海', destination: '北京', startDate: '2026-11-08', durationDays: 3, adults: 2,
        budgetPerPersonCny: 3000, interests: '历史', pace: '轻松', lodgingPreferences: '无', dietaryRestrictions: '无', mobilityRestrictions: '无' },
      messages: [], deliveries: [], createdAt: '', updatedAt: '' };
    const patches: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/settings') return { ok: true, json: async () => ({ modelBaseUrl: '', modelName: '', amapJsKey: '', amapSecurityCode: '' }) };
      if (url === '/api/sessions' && !init?.method) return { ok: true, json: async () => [session] };
      if (url === '/api/sessions/one/brief' && init?.method === 'PATCH') {
        const patch = JSON.parse(init.body as string) as Record<string, unknown>;
        patches.push(patch); session = { ...session, brief: { ...session.brief, ...patch } };
        return { ok: true, json: async () => session };
      }
      throw new Error(`unexpected ${url}`);
    }));
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<App />); });
    await act(async () => { (host.querySelector('.session-select') as HTMLButtonElement).click(); });
    await act(async () => { (host.querySelector('[aria-label="修改旅行信息"]') as HTMLButtonElement).click(); });
    const budget = host.querySelector('[aria-label="修改人均预算"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(budget, '4500'); budget.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { (host.querySelector('[aria-label="保存旅行信息"]') as HTMLButtonElement).click(); });
    expect(patches.at(-1)?.budgetPerPersonCny).toBe(4500);
    expect(host.querySelector('.brief-card')?.textContent).toContain('4500 元');
    await act(async () => { root.unmount(); });
  });
});
