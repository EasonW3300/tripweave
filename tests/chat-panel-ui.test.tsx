// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('交付卡片与多会话', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('仅完成的会话出现卡片，点击开关右侧面板且切换会话关闭面板', async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    const delivery = { id: 'd1', tripSessionId: 'ready', version: 1, status: 'ready', city: '北京', durationDays: 1,
      estimatedTotalCny: 0, budgetTotalCny: 2000, generatedAt: '', warnings: [], days: [{ date: '2026-11-08', dayNumber: 1, title: '文化', route: [], items: [{ id: 'p1', name: '故宫', type: 'attraction', startTime: '09:00', durationMinutes: 120, estimatedCostCny: 0, coordinates: [116.4, 39.9], sourceUrl: 'https://uri.amap.com/', tips: '', imageUrl: '', bookingUrl: '' }, { id: 'p2', name: '什刹海', type: 'attraction', startTime: '13:00', durationMinutes: 120, estimatedCostCny: 0, coordinates: [116.38, 39.94], sourceUrl: 'https://uri.amap.com/', tips: '慢行', imageUrl: '', bookingUrl: '' }] }] };
    const sessions = [
      { id: 'ready', title: '北京旅行', conversationId: 1, status: 'ready', brief: {}, messages: [{ id: 'm1', role: 'assistant', text: '行程完成', deliveryVersion: 1, createdAt: '' }], deliveries: [delivery], createdAt: '', updatedAt: '' },
      { id: 'collecting', title: '成都旅行', conversationId: 2, status: 'collecting', brief: {}, messages: [], deliveries: [], createdAt: '', updatedAt: '' },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/sessions' ? sessions : { modelBaseUrl: '', modelName: '', amapJsKey: '', amapSecurityCode: '' } })));
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<App />); });
    await act(async () => { (host.querySelectorAll('.session-select')[1] as HTMLButtonElement).click(); });
    expect(host.querySelector('.delivery-card')).toBeNull();
    expect(host.querySelector('.delivery-panel')).toBeNull();
    await act(async () => { (host.querySelectorAll('.session-select')[0] as HTMLButtonElement).click(); });
    const card = host.querySelector('.delivery-card') as HTMLButtonElement;
    expect(card).not.toBeNull();
    expect(host.querySelector('.delivery-panel')).toBeNull();
    await act(async () => { card.click(); });
    expect(host.querySelector('.workspace.panel-open .delivery-panel')).not.toBeNull();
    await act(async () => { card.click(); });
    expect(host.querySelector('.delivery-panel')).toBeNull();
    await act(async () => { (host.querySelector('[aria-label="查看景点：什刹海"]') as HTMLButtonElement).click(); });
    expect(host.querySelector('.place-detail h3')?.textContent).toBe('什刹海');
    await act(async () => { root.unmount(); });
  });
});
