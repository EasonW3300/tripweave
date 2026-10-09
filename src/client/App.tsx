import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ItineraryDelivery, TripBrief, TripSession } from '../shared/trip';
import { togglePanel } from './panel-state';
import { DeliveryPanel } from './DeliveryPanel';
import { planningProgress } from './planning-progress';

// The server exposes only committed workflow stages; the client maps them to
// public labels without revealing model-private reasoning.
// TripBrief is the editable snapshot; PATCH revalidates it on the server.

type PublicSettings = {
  modelBaseUrl: string; modelName: string; hasModelApiKey: boolean;
  hasAmapWebKey: boolean; hasAmapJsKey: boolean; amapJsKey: string;
  amapSecurityCode: string;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as T;
}

const statusLabels: Record<TripSession['status'], string> = {
  collecting: '等待补充信息', confirming: '等待确认简报', planning: '正在规划',
  ready: '行程已生成', failed: '规划待重试', archived: '已归档',
};

export function App() {
  const [sessions, setSessions] = useState<TripSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedSessions, setTrashedSessions] = useState<TripSession[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedSessions, setArchivedSessions] = useState<TripSession[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [briefEditOpen, setBriefEditOpen] = useState(false);
  const [briefDraft, setBriefDraft] = useState<TripBrief>({});
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [configDraft, setConfigDraft] = useState({ modelBaseUrl: 'https://api.openai.com/v1', modelName: '', modelApiKey: '', amapWebKey: '', amapJsKey: '', amapSecurityCode: '' });
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = useMemo(() => sessions.find((session) => session.id === activeId) ?? null, [sessions, activeId]);
  const delivery = active?.deliveries.find((item) => item.version === openVersion) ?? null;

  useEffect(() => {
    void Promise.all([requestJson<TripSession[]>('/api/sessions'), requestJson<PublicSettings>('/api/settings')])
      .then(([items, config]) => { setSessions(items); setSettings(config); setConfigDraft((current) => ({ ...current, modelBaseUrl: config.modelBaseUrl, modelName: config.modelName, amapJsKey: config.amapJsKey, amapSecurityCode: config.amapSecurityCode })); })
      .catch((failure) => setError(failure.message));
  }, []);
  // Background Pi tasks may finish after the user switches conversations or
  // reloads the page. Refresh projections while any session is still planning.
  useEffect(() => {
    if (!sessions.some((session) => session.status === 'planning')) return;
    const timer = window.setInterval(() => {
      void requestJson<TripSession[]>('/api/sessions').then(setSessions).catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [sessions]);
  useEffect(() => {
    if (!activeId || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/sessions/${activeId}/events`);
    const apply = (event: Event) => {
      try {
        const session = JSON.parse((event as MessageEvent).data) as TripSession;
        if (session.id !== activeId) return;
        if (session.trashedAt) setSessions((current) => current.filter((item) => item.id !== session.id));
        else replaceSession(session);
      } catch { /* A malformed frame cannot replace the current chat. */ }
    };
    source.addEventListener('snapshot', apply);
    source.addEventListener('update', apply);
    return () => source.close();
  }, [activeId]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [active?.messages.length, activeId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpenVersion(null); setSettingsOpen(false); setTrashOpen(false); setArchiveOpen(false); setRenameOpen(false); setBriefEditOpen(false); setMoreOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function replaceSession(session: TripSession) {
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
  }

  async function createSession() {
    setError('');
    try {
      const session = await requestJson<TripSession>('/api/sessions', { method: 'POST' });
      replaceSession(session);
      setActiveId(session.id);
      setOpenVersion(null);
    } catch (failure) { setError((failure as Error).message); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!activeId || !draft.trim() || busy) return;
    setBusy(true); setError('');
    const text = draft.trim();
    setDraft('');
    try { replaceSession(await requestJson<TripSession>(`/api/sessions/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ text, requestId: crypto.randomUUID() }) })); }
    catch (failure) { setDraft(text); setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!activeId || busy) return;
    setBusy(true); setError('');
    setSessions((current) => current.map((session) => session.id === activeId ? { ...session, status: 'planning' } : session));
    try { replaceSession(await requestJson<TripSession>(`/api/sessions/${activeId}/confirm`, { method: 'POST' })); }
    catch (failure) {
      setError((failure as Error).message);
      void requestJson<TripSession>(`/api/sessions/${activeId}`).then(replaceSession);
    } finally { setBusy(false); }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); setError('');
    const payload = Object.fromEntries(Object.entries(configDraft).filter(([key, value]) => value && (key !== 'amapJsKey' || value !== settings?.amapJsKey)));
    try {
      const next = await requestJson<PublicSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setSettings(next); setSettingsOpen(false);
      setConfigDraft((current) => ({ ...current, modelApiKey: '', amapWebKey: '' }));
    } catch (failure) { setError((failure as Error).message); }
  }

  function selectSession(id: string) { setActiveId(id); setOpenVersion(null); setSelectedItemId(null); setBriefEditOpen(false); setError(''); }
  function selectDelivery(version: number) { setSelectedItemId(null); setOpenVersion((current) => togglePanel(current, version)); }
  function selectPlace(version: number, dayIndex: number, itemId: string) { setSelectedDayIndex(dayIndex); setSelectedItemId(itemId); setOpenVersion(version); }

  async function trashSession(session: TripSession) {
    if (!window.confirm(`将“${session.title}”移入回收站？之后可以恢复。`)) return;
    setError('');
    try {
      const removed = await requestJson<TripSession>(`/api/sessions/${session.id}`, { method: 'DELETE' });
      const remaining = sessions.filter((item) => item.id !== session.id);
      setSessions(remaining);
      setTrashedSessions((current) => [removed, ...current.filter((item) => item.id !== removed.id)]);
      if (activeId === session.id) { setActiveId(remaining[0]?.id ?? null); setOpenVersion(null); }
    } catch (failure) { setError((failure as Error).message); }
  }

  async function openTrash() {
    setError('');
    try { setTrashedSessions(await requestJson<TripSession[]>('/api/trash')); setTrashOpen(true); }
    catch (failure) { setError((failure as Error).message); }
  }

  async function restoreSession(session: TripSession) {
    setError('');
    try {
      const restored = await requestJson<TripSession>(`/api/trash/${session.id}/restore`, { method: 'POST' });
      setTrashedSessions((current) => current.filter((item) => item.id !== session.id));
      replaceSession(restored);
      setActiveId(restored.id);
      setTrashOpen(false);
    } catch (failure) { setError((failure as Error).message); }
  }

  async function renameSession(event: FormEvent) {
    event.preventDefault();
    if (!active || !renameDraft.trim()) return;
    setError('');
    try {
      replaceSession(await requestJson<TripSession>(`/api/sessions/${active.id}`, { method: 'PATCH', body: JSON.stringify({ title: renameDraft.trim() }) }));
      setRenameOpen(false);
    } catch (failure) { setError((failure as Error).message); }
  }

  async function saveBrief(event: FormEvent) {
    event.preventDefault();
    if (!active) return;
    setError('');
    try {
      // Keep the confirmed chat history intact while the server moves a
      // revised ready trip back through the brief-confirmation gate.
      replaceSession(await requestJson<TripSession>(`/api/sessions/${active.id}/brief`, { method: 'PATCH', body: JSON.stringify(briefDraft) }));
      setBriefEditOpen(false);
    } catch (failure) { setError((failure as Error).message); }
  }

  async function archiveSession() {
    if (!active || !window.confirm(`归档“${active.title}”？之后可以从归档会话中恢复。`)) return;
    setError('');
    try {
      const archived = await requestJson<TripSession>(`/api/sessions/${active.id}`, { method: 'PATCH', body: JSON.stringify({ archive: true }) });
      const remaining = sessions.filter((item) => item.id !== active.id);
      setSessions(remaining); setArchivedSessions((current) => [archived, ...current]);
      setActiveId(remaining[0]?.id ?? null); setOpenVersion(null); setMoreOpen(false);
    } catch (failure) { setError((failure as Error).message); }
  }

  async function openArchive() {
    setError('');
    try { setArchivedSessions(await requestJson<TripSession[]>('/api/archive')); setArchiveOpen(true); setMoreOpen(false); }
    catch (failure) { setError((failure as Error).message); }
  }

  async function restoreArchive(session: TripSession) {
    setError('');
    try {
      const restored = await requestJson<TripSession>(`/api/archive/${session.id}/restore`, { method: 'POST' });
      setArchivedSessions((current) => current.filter((item) => item.id !== session.id));
      replaceSession(restored); setActiveId(restored.id); setArchiveOpen(false);
    } catch (failure) { setError((failure as Error).message); }
  }

  return <div className="app-shell">
    <aside className="session-rail">
      <div className="brand"><div className="brand-mark">旅</div><div><strong>旅序</strong><small>TRIPWEAVE</small></div></div>
      <select className="mobile-session-select" aria-label="切换旅行会话" value={activeId ?? ''} onChange={(event) => selectSession(event.target.value)}>
        <option value="">选择会话</option>{sessions.map((session) => <option value={session.id} key={session.id}>{session.title}</option>)}
      </select>
      <button className="new-trip" onClick={() => void createSession()}><span>＋</span> 新建旅行规划</button>
      <div className="rail-label">旅行会话 <span>{sessions.length}</span></div>
      <nav className="session-list" aria-label="旅行会话">
        {sessions.map((session) => <div key={session.id} className={`session-row ${session.id === activeId ? 'selected' : ''}`}>
          <button className="session-select" onClick={() => selectSession(session.id)}><span className="session-name">{session.title}</span><span className="session-status"><i className={`status-dot ${session.status}`} />{statusLabels[session.status]}</span></button>
          <button className="session-delete" aria-label={`删除${session.title}`} title="移入回收站" onClick={() => void trashSession(session)}>×</button>
        </div>)}
      </nav>
      <div className="rail-bottom"><button onClick={() => void openArchive()} aria-label="打开归档会话">归档</button><button onClick={() => void openTrash()} aria-label="打开回收站">回收站</button><button onClick={() => setSettingsOpen(true)} aria-label="打开设置">设置</button></div>
    </aside>

    <main className={`workspace ${delivery ? 'panel-open' : ''}`}>
      <section className="chat-pane">
        <header className="chat-header">
          <div><span className="eyebrow">TRAVEL CONVERSATION</span><h1>{active?.title ?? '开始一段新的旅程'}</h1></div>
          <div className="header-actions"><span className="connection-pill"><i /> 本地会话</span>{active && active.status !== 'planning' && <button aria-label="修改旅行信息" onClick={() => { setBriefDraft(active.brief); setBriefEditOpen(true); }}>修改信息</button>}{active && <button className="header-delete" aria-label="删除当前会话" onClick={() => void trashSession(active)}>删除</button>}<button className="header-trash" aria-label="打开回收站" onClick={() => void openTrash()}>回收站</button>{active && <div className="more-wrap"><button aria-label="更多会话操作" onClick={() => setMoreOpen((current) => !current)}>更多</button>{moreOpen && <div className="more-menu"><button aria-label="重命名当前会话" onClick={() => { setRenameDraft(active.title); setRenameOpen(true); setMoreOpen(false); }}>重命名</button><button aria-label="归档当前会话" onClick={() => void archiveSession()}>归档当前会话</button><button aria-label="打开归档会话" onClick={() => void openArchive()}>查看归档</button></div>}</div>}<button onClick={() => setSettingsOpen(true)}>配置</button></div>
        </header>
        {active ? <>
          <div className="messages" ref={scrollRef}>
            <div className="day-divider">旅程从这里开始</div>
            {active.messages.length === 0 && <div className="empty-chat"><span className="intro-number">01 / 对话规划</span><h2>先聊聊，你想去哪里？</h2><p>从一个念头开始就好。旅序会逐步了解时间、预算与偏好，再为你安排路线。</p><div className="suggestions"><button onClick={() => setDraft('我想下个月去北京旅游')}>下个月去北京</button><button onClick={() => setDraft('想去成都玩5天，预算每人5000元')}>计划成都旅行</button></div></div>}
            {active.messages.map((item) => <div className={`message-row ${item.role}`} key={item.id}>
              {item.role === 'assistant' && <div className="assistant-avatar">旅</div>}
              <div className="message-stack"><div className="bubble">{item.text}</div>
                {item.deliveryVersion && (() => { const plan = active.deliveries.find((entry) => entry.version === item.deliveryVersion); return plan ? <><button className={`delivery-card ${openVersion === plan.version ? 'active' : ''}`} onClick={() => selectDelivery(plan.version)} key={plan.id}>
                  <span className="delivery-overline">已完成 · 行程版本 {plan.version}</span><strong>{plan.city} {plan.durationDays} 日旅行计划</strong><span>{plan.days.reduce((sum, day) => sum + day.items.length, 0)} 个路线节点 · 预算上限 ¥{plan.budgetTotalCny.toLocaleString()}</span><span className="delivery-action">{openVersion === plan.version ? '收起行程 ←' : '查看行程与地图 →'}</span>
                </button><div className="place-chips">{plan.days.flatMap((day, dayIndex) => day.items.map((stop) => <button key={`${dayIndex}-${stop.id}`} aria-label={`查看景点：${stop.name}`} onClick={() => selectPlace(plan.version, dayIndex, stop.id)}>{stop.name}</button>))}</div></> : null; })()}
              </div>
            </div>)}
            {active.status === 'confirming' && <div className="brief-card"><span className="eyebrow">TRIP BRIEF</span><h3>旅行信息确认</h3><dl>{Object.entries(active.brief).map(([key, value]) => <div key={key}><dt>{({ destination: '目的地', origin: '出发地', startDate: '出发日期', durationDays: '天数', adults: '人数', budgetPerPersonCny: '人均预算', interests: '偏好', pace: '节奏', lodgingPreferences: '住宿', dietaryRestrictions: '饮食', mobilityRestrictions: '行动限制' } as Record<string, string>)[key] ?? key}</dt><dd>{String(value)}{key === 'budgetPerPersonCny' ? ' 元' : ''}</dd></div>)}</dl><button className="primary-action" onClick={() => void confirm()} disabled={busy}>确认并开始规划</button></div>}
            {active.status === 'planning' && <div className="progress-card"><span className="eyebrow">PLANNING IN PROGRESS</span><h3>正在整理这段旅程</h3><p>{planningProgress(active.planningStep).label}。你可以切换到其他会话，规划会在后台继续。</p><div className="progress-track" role="progressbar" aria-valuenow={planningProgress(active.planningStep).percent} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${planningProgress(active.planningStep).percent}%` }} /></div></div>}
          </div>
          <form className="composer" onSubmit={(event) => void send(event)}><div className="composer-inner"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="告诉旅序你的想法，或继续补充旅行条件…" rows={2} disabled={busy || active.status === 'planning'} /><button type="submit" disabled={busy || !draft.trim() || active.status === 'planning'} aria-label="发送消息">↑</button></div><small>Enter 发送 · Shift + Enter 换行</small></form>
        </> : <div className="welcome"><span className="intro-number">TRIPWEAVE / 旅序</span><h2>去哪里，<br />我们慢慢聊。</h2><p>像发消息一样规划旅行。从出发日期到路线节点，旅序会把散落的想法整理成一张可以打开的行程地图。</p><button className="primary-action" onClick={() => void createSession()}>开始规划一段旅行 <span>↗</span></button><div className="welcome-footer">多会话并行 · 本地保存 · 中国城市旅行</div></div>}
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')}>关闭</button></div>}
      </section>
      {delivery && <DeliveryPanel delivery={delivery} amapJsKey={settings?.amapJsKey ?? ''} amapSecurityCode={settings?.amapSecurityCode ?? ''} selectedItemId={selectedItemId} selectedDayIndex={selectedDayIndex} onClose={() => setOpenVersion(null)} />}
    </main>

    {settingsOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <form className="settings-modal" onSubmit={(event) => void saveSettings(event)}>
        <div className="modal-header"><div><span className="eyebrow">LOCAL CONFIGURATION</span><h2>连接你的旅行工具</h2></div><button type="button" onClick={() => setSettingsOpen(false)}>✕</button></div>
        <p>模型和高德 Web 服务凭证保存在本机。浏览器地图使用高德 JS API Key 与安全密钥。</p>
        <label>模型 Base URL<input value={configDraft.modelBaseUrl} onChange={(event) => setConfigDraft({ ...configDraft, modelBaseUrl: event.target.value })} /></label>
        <label>模型名称<input value={configDraft.modelName} onChange={(event) => setConfigDraft({ ...configDraft, modelName: event.target.value })} placeholder="例如 gpt-4.1-mini" /></label>
        <label>模型 API Key<input type="password" value={configDraft.modelApiKey} onChange={(event) => setConfigDraft({ ...configDraft, modelApiKey: event.target.value })} placeholder={settings?.hasModelApiKey ? '已保存；留空则不修改' : '请输入 API Key'} /></label>
        <label>高德 Web 服务 Key<input type="password" value={configDraft.amapWebKey} onChange={(event) => setConfigDraft({ ...configDraft, amapWebKey: event.target.value })} placeholder={settings?.hasAmapWebKey ? '已保存；留空则不修改' : '用于 POI 与路线'} /></label>
        <label>高德 JS API Key<input value={configDraft.amapJsKey} onChange={(event) => setConfigDraft({ ...configDraft, amapJsKey: event.target.value })} placeholder="用于交互地图" /></label>
        <label>高德 JS 安全密钥<input type="password" value={configDraft.amapSecurityCode} onChange={(event) => setConfigDraft({ ...configDraft, amapSecurityCode: event.target.value })} placeholder="用于本地浏览器地图" /></label>
        <button className="primary-action" type="submit">保存本地配置</button>
      </form>
    </div>}
    {trashOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setTrashOpen(false); }}>
      <section className="settings-modal trash-modal" aria-label="回收站"><div className="modal-header"><div><span className="eyebrow">RECYCLE BIN</span><h2>回收站</h2></div><button onClick={() => setTrashOpen(false)} aria-label="关闭回收站">✕</button></div>
        <p>移入回收站的会话保留在本机，不会自动永久清理。</p>
        {trashedSessions.length === 0 ? <p>回收站为空。</p> : trashedSessions.map((session) => <div className="trash-row" key={session.id}><div><strong>{session.title}</strong><small>{session.trashedAt?.slice(0, 10)}</small></div><button aria-label={`恢复${session.title}`} onClick={() => void restoreSession(session)}>恢复</button></div>)}
      </section>
    </div>}
    {renameOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameOpen(false); }}><form className="settings-modal rename-modal" onSubmit={(event) => void renameSession(event)}><div className="modal-header"><h2>重命名会话</h2><button type="button" onClick={() => setRenameOpen(false)}>✕</button></div><label>会话名称<input aria-label="新的会话名称" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={60} autoFocus /></label><button type="submit" className="primary-action" aria-label="保存会话名称">保存</button></form></div>}
    {briefEditOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setBriefEditOpen(false); }}><form className="settings-modal brief-edit-modal" onSubmit={(event) => void saveBrief(event)}><div className="modal-header"><div><span className="eyebrow">TRIP BRIEF</span><h2>修改旅行信息</h2></div><button type="button" onClick={() => setBriefEditOpen(false)}>✕</button></div><p>保存后请重新核对简报并确认，才会生成新版本行程。</p><div className="brief-edit-grid">
      {([['origin', '出发地'], ['destination', '目的地'], ['interests', '兴趣偏好'], ['pace', '行程节奏'], ['lodgingPreferences', '住宿偏好'], ['dietaryRestrictions', '饮食限制'], ['mobilityRestrictions', '行动限制']] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={`修改${label}`} value={briefDraft[key] ?? ''} onChange={(event) => setBriefDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
      <label>出发日期<input aria-label="修改出发日期" type="date" value={briefDraft.startDate ?? ''} onChange={(event) => setBriefDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
      {([['durationDays', '旅行天数'], ['adults', '成人数'], ['budgetPerPersonCny', '人均预算']] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={`修改${label}`} type="number" min="1" value={briefDraft[key] ?? ''} onChange={(event) => setBriefDraft((current) => ({ ...current, [key]: event.target.value === '' ? undefined : Number(event.target.value) }))} /></label>)}
    </div><button type="submit" className="primary-action" aria-label="保存旅行信息">保存并重新确认</button></form></div>}
    {archiveOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setArchiveOpen(false); }}><section className="settings-modal trash-modal" aria-label="归档会话"><div className="modal-header"><h2>归档会话</h2><button onClick={() => setArchiveOpen(false)}>✕</button></div><p>归档会话保留在本机，不会出现在日常会话列表。</p>{archivedSessions.length === 0 ? <p>暂无归档会话。</p> : archivedSessions.map((session) => <div className="trash-row" key={session.id}><div><strong>{session.title}</strong><small>{session.archivedAt?.slice(0, 10)}</small></div><button aria-label="恢复归档会话" onClick={() => void restoreArchive(session)}>恢复</button></div>)}</section></div>}
  </div>;
}
