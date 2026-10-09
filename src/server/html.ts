import type { ItineraryDelivery, ItineraryItem, TripBrief } from '../shared/trip';
import { buildBookingActions } from './bookings';

// Booking actions are saved on new deliveries. The fallback only keeps older
// local MVP versions readable after this schema addition.
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function safeUrl(value: string): string {
  try { const url = new URL(value); return url.protocol === 'https:' ? escapeHtml(url.toString()) : ''; }
  catch { return ''; }
}

function projectCoordinates(delivery: ItineraryDelivery) {
  const points = delivery.days.flatMap((day) => day.items.map((item) => item.coordinates).filter((point): point is [number, number] => !!point));
  if (!points.length) return (_point: [number, number]): [number, number] => [325, 205];
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  return (point: [number, number]): [number, number] => [
    55 + ((point[0] - minLng) / Math.max(maxLng - minLng, 0.005)) * 540,
    355 - ((point[1] - minLat) / Math.max(maxLat - minLat, 0.005)) * 300,
  ];
}

function itemCard(item: ItineraryItem, day: number): string {
  const image = safeUrl(item.imageUrl);
  const source = safeUrl(item.sourceUrl);
  const booking = safeUrl(item.bookingUrl);
  return `<article class="stop" id="stop-${escapeHtml(item.id)}"><div class="stop-time">${escapeHtml(item.startTime)}<small>DAY ${day}</small></div><div class="stop-main">${image ? `<img src="${image}" alt="${escapeHtml(item.name)}" loading="lazy">` : ''}<div><h3>${escapeHtml(item.name)}</h3><small>AI 游览建议（未经核实）</small><p>${escapeHtml(item.tips)}</p><small>建议停留 ${Math.round(item.durationMinutes / 60 * 10) / 10} 小时</small><p class="verification-note">门票价格待核实 · 开放时间待核实 · 预约规则待核实</p><div class="stop-links">${source ? `<a href="${source}" target="_blank" rel="noopener noreferrer">高德地点 ↗</a>` : ''}${booking ? `<a href="${booking}" target="_blank" rel="noopener noreferrer">预约入口 ↗</a>` : ''}</div></div></div></article>`;
}

// The model contributes plain text only. Every dynamic field is escaped, and
// all outbound URLs must use HTTPS before entering this deterministic page.
export function renderItineraryHtml(delivery: ItineraryDelivery, brief: Partial<TripBrief>): string {
  const project = projectCoordinates(delivery);
  const stops = delivery.days.flatMap((day) => day.items.map((item) => ({ item, day: day.dayNumber })));
  const paths = delivery.days.flatMap((day) => day.route.map((leg) => `<polyline points="${leg.path.map((point) => project(point).join(',')).join(' ')}" fill="none" stroke="#14786b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>`)).join('');
  const markers = stops.map(({ item, day }, index) => {
    if (!item.coordinates) return '';
    const [x, y] = project(item.coordinates);
    return `<g class="map-stop" data-stop="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(item.name)}"><circle cx="${x}" cy="${y}" r="15" fill="#194e43" stroke="white" stroke-width="4"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="white" font-size="11" font-weight="700">${index + 1}</text><title>D${day} ${escapeHtml(item.name)}</title></g>`;
  }).join('');
  const evidence = (delivery.facts ?? []).map((fact) => `<li><a href="${safeUrl(fact.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fact.sourceTitle)}</a> · ${escapeHtml(fact.retrievedAt.slice(0, 10))} · ${fact.confidence === 'verified' ? '已核实' : '供应商资料，需复核'}</li>`).join('');
  const budgetNote = delivery.budgetSummary && !delivery.budgetSummary.complete ? `<p>费用未完整核实；已知费用 ¥${delivery.budgetSummary.knownTotalCny}，另有 ${delivery.budgetSummary.unknownItemCount} 项待核实。预算上限不是报价。</p>` : '';
  const sections = delivery.days.map((day) => `<section class="day"><header><span>DAY ${String(day.dayNumber).padStart(2, '0')}</span><div><h2>${escapeHtml(day.title)}</h2><small>${escapeHtml(day.date)}</small></div></header>${day.items.map((item) => itemCard(item, day.dayNumber)).join('')}</section>`).join('') + `<section class="card"><h2>来源与预算说明</h2>${budgetNote}<ul>${evidence}</ul></section>`;
  const actions = delivery.bookingActions ?? buildBookingActions({ ...brief, durationDays: delivery.durationDays });
  const bookings = actions.map((action) => `<div class="booking-row"><div><strong>${escapeHtml(action.label)}</strong><code>${escapeHtml(action.criteria)}</code></div><div><a href="${safeUrl(action.url)}" target="_blank" rel="noopener noreferrer">打开搜索 ↗</a><button class="copy" data-criteria="${escapeHtml(action.criteria)}">复制条件</button></div></div>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(delivery.city)} ${delivery.durationDays} 日行程 · 旅序 TripWeave</title><style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1a352d;background:#f4f7f4}*{box-sizing:border-box}body{margin:0}a{color:#126c55;text-decoration:none}button{font:inherit;cursor:pointer}.topbar{display:flex;justify-content:space-between;background:#153e34;color:white;padding:14px max(22px,calc((100% - 1180px)/2));font-size:13px}.topbar span{opacity:.7}.hero{max-width:1180px;margin:auto;padding:65px 25px 35px}.kicker{font-size:11px;letter-spacing:.16em;color:#6c9b7d;font-weight:800}.hero h1{font-size:clamp(45px,6vw,80px);line-height:1.07;margin:15px 0;letter-spacing:-.06em}.hero p{color:#648172;font-size:14px}.hero-stats{display:flex;gap:25px;border-top:1px solid #d9e5da;margin-top:35px;padding-top:20px;font-size:12px;color:#658373}.hero-stats strong{display:block;color:#1e4b3e;font-size:21px;margin-bottom:3px}.layout{max-width:1180px;margin:auto;display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:36px;padding:0 25px 70px}.day{margin-bottom:50px}.day header{display:flex;gap:18px;align-items:baseline;border-bottom:1px solid #ccdfd1;padding:12px 0}.day header span{color:#489174;font-size:11px;font-weight:800}.day h2{margin:0;font-size:22px}.day small{color:#839b88}.stop{display:grid;grid-template-columns:70px 1fr;gap:15px;padding:19px 0;border-bottom:1px solid #e2ebe3}.stop-time{font-size:13px;color:#1c6f58;font-weight:800}.stop-time small{display:block;font-size:9px;margin-top:4px}.stop-main{display:flex;gap:13px}.stop-main img{width:95px;height:95px;object-fit:cover;border-radius:8px}.stop-main h3{margin:0 0 7px;font-size:16px}.stop-main p{font-size:12px;line-height:1.6;color:#5e796a;margin:0 0 7px}.stop-links{display:flex;gap:14px;margin-top:9px;font-size:11px;font-weight:750}.sticky{position:sticky;top:20px;align-self:start}.card{background:#fff;border:1px solid #dce8dd;border-radius:13px;padding:19px;margin-bottom:16px;box-shadow:0 7px 22px #22573e0a}.card h2{font-size:16px;margin:8px 0 15px}.route-svg{width:100%;height:250px;background:#e8f0e8;border-radius:9px}.map-stop{cursor:pointer}.map-stop:hover circle,.map-stop:focus circle{fill:#c98936}.card p{font-size:11px;line-height:1.65;color:#678272}.booking-row{border-top:1px solid #e4eee5;padding:11px 0}.booking-row strong{font-size:12px}.booking-row code{display:block;white-space:normal;color:#5a7663;font-size:10px;margin:7px 0}.booking-row>div:last-child{display:flex;gap:10px}.booking-row a,.booking-row button{border:1px solid #c8dccd;border-radius:7px;background:#f4faf5;padding:7px;color:#225d49;font-size:10px}.notice{background:#fcfaf1;border-color:#ede7ce}.selected-stop{background:#eaf5ec;border-radius:9px}.copy-status{font-size:10px;color:#1b7c56}@media(max-width:850px){.layout{display:block}.sticky{position:static}.hero{padding-top:38px}.hero-stats{gap:15px;flex-wrap:wrap}.stop{grid-template-columns:54px 1fr}.stop-main img{width:73px;height:73px}}@media print{.topbar,.booking-row button{display:none}.layout{display:block}.sticky{position:static}}
  </style></head><body><div class="topbar"><strong>旅序 TRIPWEAVE</strong><span>行程版本 ${delivery.version} · ${escapeHtml(delivery.generatedAt.slice(0, 10))}</span></div><header class="hero"><span class="kicker">YOUR JOURNEY, IN ORDER</span><h1>${escapeHtml(delivery.city)}<br>${delivery.durationDays} 日旅行计划</h1><p>按天探索路线、地点与行前提示。预订链接仅打开第三方搜索，不会下单。</p><div class="hero-stats"><div><strong>${delivery.days.length}</strong>旅行天数</div><div><strong>${stops.length}</strong>路线节点</div><div><strong>¥${delivery.budgetTotalCny.toLocaleString()}</strong>预算上限</div></div></header><main class="layout"><div>${sections}</div><aside class="sticky"><div class="card"><h2>规划路径</h2><svg class="route-svg" viewBox="0 0 650 410" aria-label="行程路线示意图">${paths}${markers}</svg><p>根据高德坐标与路线绘制，点击节点查看地点。</p></div><div class="card"><h2>预订交通与住宿</h2><p>请在第三方平台核对日期、余票、价格与退改规则。搜索条件不会自动提交。</p>${bookings}<div class="copy-status" id="copy-status"></div></div><div class="card notice"><strong>规划说明</strong>${delivery.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join('')}</div></aside></main><script>
  document.querySelectorAll('[data-stop]').forEach(function(node){function select(){var target=document.getElementById('stop-'+node.dataset.stop);if(target){document.querySelectorAll('.selected-stop').forEach(function(el){el.classList.remove('selected-stop')});target.classList.add('selected-stop');target.scrollIntoView({behavior:'smooth',block:'center'})}}node.addEventListener('click',select);node.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();select()}})});
  document.querySelectorAll('.copy').forEach(function(button){button.addEventListener('click',async function(){try{await navigator.clipboard.writeText(button.dataset.criteria);document.getElementById('copy-status').textContent='已复制搜索条件'}catch{document.getElementById('copy-status').textContent='复制失败，请手动选择条件'}})});
  </script></body></html>`;
}
