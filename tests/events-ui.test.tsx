// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('会话实时更新', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('切入会话后订阅 SSE 并应用已提交快照', async () => {
    const session = { id: 'one', title: '北京旅行', conversationId: 1, status: 'collecting', brief: {}, messages: [], deliveries: [], createdAt: '', updatedAt: '' };
    HTMLElement.prototype.scrollTo = vi.fn();
    let source: { url: string; onmessage?: (event: MessageEvent) => void; addEventListener: (name: string, listener: EventListener) => void; close: () => void } | undefined;
    class FakeEventSource {
      url: string;
      private listeners: Record<string, EventListener> = {};
      constructor(url: string) { this.url = url; source = this; }
      addEventListener(name: string, listener: EventListener) { this.listeners[name] = listener; }
      emit(name: string, value: unknown) { this.listeners[name]?.({ data: JSON.stringify(value) } as MessageEvent); }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/sessions' ? [session] : { modelBaseUrl: '', modelName: '', amapJsKey: '', amapSecurityCode: '' } })));
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<App />); });
    await act(async () => { (host.querySelector('.session-select') as HTMLButtonElement).click(); });
    expect(source?.url).toBe('/api/sessions/one/events');
    await act(async () => { (source as FakeEventSource).emit('update', { ...session, title: '北京五日旅行' }); });
    expect(host.textContent).toContain('北京五日旅行');
    await act(async () => { root.unmount(); });
  });
});
