import { useEffect, useMemo, useRef, useState } from 'react';
import type { ItineraryDelivery, ItineraryItem } from '../shared/trip';

declare global {
  interface Window { AMap?: any; _AMapSecurityConfig?: { securityJsCode: string }; }
}

let mapScript: Promise<void> | null = null;
function safeExternalUrl(value: string): string | undefined {
  try { return new URL(value).protocol === 'https:' ? value : undefined; }
  catch { return undefined; }
}
function loadAMap(key: string, securityCode: string): Promise<void> {
  if (window.AMap) return Promise.resolve();
  if (!mapScript) mapScript = new Promise((resolve, reject) => {
    if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.onload = () => window.AMap ? resolve() : reject(new Error('map_unavailable'));
    script.onerror = () => { mapScript = null; script.remove(); reject(new Error('map_load_failed')); };
    document.head.appendChild(script);
  });
  return mapScript;
}

function MapCanvas({ items, paths, keyValue, securityCode, onSelect }: { items: ItineraryItem[]; paths: [number, number][][]; keyValue: string; securityCode: string; onSelect: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    if (!keyValue || !container.current || items.length === 0) return;
    let disposed = false;
    let map: any;
    void loadAMap(keyValue, securityCode).then(() => {
      if (disposed || !container.current) return;
      const AMap = window.AMap!;
      map = new AMap.Map(container.current, { zoom: 12, center: items[0].coordinates, viewMode: '2D' });
      const overlays: any[] = [];
      for (const path of paths) {
        if (path.length > 1) overlays.push(new AMap.Polyline({ path, strokeColor: '#0b776c', strokeWeight: 5, strokeOpacity: 0.9, showDir: true }));
      }
      items.forEach((item, index) => {
        const marker = new AMap.Marker({ position: item.coordinates, label: { content: String(index + 1), direction: 'top' }, title: item.name });
        marker.on('click', () => onSelect(item.id));
        overlays.push(marker);
      });
      map.add(overlays);
      map.setFitView(overlays, false, [72, 72, 72, 72]);
    }).catch(() => setFailure('地图暂时无法加载。行程节点仍可在左侧查看。'));
    return () => { disposed = true; map?.destroy(); };
  }, [items, paths, keyValue, securityCode, onSelect]);
  if (!keyValue) return <div className="map-placeholder"><div className="map-grid" /><strong>路线地图待连接</strong><p>在设置中添加高德 JS API Key 后，这里会显示真实底图与路线。</p></div>;
  return <div className="map-wrap"><div className="map-canvas" ref={container} />{failure && <div className="map-warning">{failure}</div>}<span className="map-attribution">地图数据 © 高德地图</span></div>;
}

export function DeliveryPanel({ delivery, amapJsKey, amapSecurityCode, selectedItemId = null, selectedDayIndex = 0, onClose }: { delivery: ItineraryDelivery; amapJsKey: string; amapSecurityCode: string; selectedItemId?: string | null; selectedDayIndex?: number; onClose: () => void }) {
  const [dayIndex, setDayIndex] = useState(selectedDayIndex);
  const [selectedId, setSelectedId] = useState<string | null>(selectedItemId);
  const day = delivery.days[dayIndex] ?? delivery.days[0];
  const selected = day.items.find((item) => item.id === selectedId) ?? day.items[0];
  const paths = useMemo(() => day.route.map((leg) => leg.path), [day]);
  useEffect(() => { setDayIndex(selectedDayIndex); setSelectedId(selectedItemId); }, [selectedDayIndex, selectedItemId, delivery.id]);

  return <aside className="delivery-panel" aria-label="详细行程和地图">
    <div className="panel-header"><div><span className="eyebrow">ITINERARY / VERSION {delivery.version}</span><h2>{delivery.city} · {delivery.durationDays} 日行程</h2></div><button className="panel-close" onClick={onClose} aria-label="关闭行程面板">✕</button></div>
    <div className="panel-tabs" role="tablist" aria-label="选择行程日期">{delivery.days.map((entry, index) => <button role="tab" aria-selected={index === dayIndex} className={index === dayIndex ? 'active' : ''} key={entry.date} onClick={() => { setDayIndex(index); setSelectedId(null); }}>D{entry.dayNumber}<small>{entry.date.slice(5)}</small></button>)}</div>
    <div className="panel-body"><div className="timeline"><div className="timeline-top"><span>{day.date}</span><h3>{day.title}</h3></div>
      {day.items.map((item, index) => <button className={`stop-row ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><span className="stop-index">{String(index + 1).padStart(2, '0')}</span><span className="stop-content"><strong>{item.name}</strong><small>{item.startTime} · 建议停留 {Math.round(item.durationMinutes / 60 * 10) / 10} 小时</small></span><span className="stop-arrow">↗</span></button>)}
      {day.route.map((leg) => <div className="route-note" key={`${leg.fromItemId}-${leg.toItemId}`}>{leg.mode === 'drive' ? '驾车' : leg.mode === 'transit' ? '公交' : '步行'}约 {leg.durationMinutes} 分钟 · {Math.round(leg.distanceMeters / 100) / 10} 公里</div>)}
      <a className="html-link" href={`/api/sessions/${delivery.tripSessionId}/itinerary/${delivery.version}.html`} target="_blank" rel="noreferrer">打开详细 HTML 行程页 ↗</a>
      {!!delivery.bookingActions?.length && <div className="panel-bookings"><strong>交通与住宿搜索</strong><p>打开第三方平台后，请自行核对价格与余票。</p>{delivery.bookingActions.map((action) => <div className="panel-booking" key={action.kind}><span>{action.label}</span><small>{action.criteria}</small><div>{safeExternalUrl(action.url) && <a href={safeExternalUrl(action.url)} target="_blank" rel="noopener noreferrer">打开搜索 ↗</a>}<button onClick={() => void navigator.clipboard.writeText(action.criteria)}>复制条件</button></div></div>)}</div>}
      <div className="uncertainty"><strong>出行提醒</strong>{delivery.budgetSummary && !delivery.budgetSummary.complete && <p>费用未完整核实：已知 ¥{delivery.budgetSummary.knownTotalCny}，另有 {delivery.budgetSummary.unknownItemCount} 项待核实。</p>}{delivery.warnings.map((warning) => <p key={warning}>{warning}</p>)}{!!delivery.facts?.length && <><strong>资料来源</strong>{delivery.facts.map((fact) => <p key={fact.id}><a href={safeExternalUrl(fact.sourceUrl)} target="_blank" rel="noopener noreferrer">{fact.sourceTitle}</a> · {fact.retrievedAt.slice(0, 10)} · {fact.confidence === 'verified' ? '已核实' : '需复核'}</p>)}</>}</div>
    </div><div className="map-section"><MapCanvas items={day.items} paths={paths} keyValue={amapJsKey} securityCode={amapSecurityCode} onSelect={setSelectedId} />
      {selected && <article className="place-detail">{selected.imageUrl && <img src={selected.imageUrl} alt={selected.name} />}<div className="place-detail-body"><span className="eyebrow">STOP {day.items.findIndex((item) => item.id === selected.id) + 1}</span><h3>{selected.name}</h3><small>AI 游览建议（未经核实）</small><p>{selected.tips}</p><p className="place-unverified">门票价格待核实 · 开放时间待核实 · 预约规则待核实</p><div className="place-actions"><a href={selected.sourceUrl} target="_blank" rel="noreferrer">高德地点 ↗</a>{selected.bookingUrl && <a href={selected.bookingUrl} target="_blank" rel="noreferrer">预约入口 ↗</a>}</div></div></article>}
    </div></div>
  </aside>;
}
