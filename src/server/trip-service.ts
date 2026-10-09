import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { DurableJournal } from './durable';
import { SessionStore } from './session-store';
import { LocalConfig } from './config';
import { AMapClient } from './amap';
import { ModelClient } from './model';
import { buildDelivery } from './planner';
import { chooseCityRoute } from './route-choice';

// chooseCityRoute keeps travel-mode policy outside the pure day planner.
import { mergeBrief, nextMissingSlot, parseUserMessage, slotQuestions } from '../shared/brief';
import type { BriefSlot, ChatMessage, ItineraryDelivery, TripBrief, TripSession } from '../shared/trip';

function answerForSlot(slot: BriefSlot, text: string): Partial<TripBrief> {
  const value = text.trim();
  switch (slot) {
    case 'origin': return { origin: value.replace(/出发|市/g, '') };
    case 'destination': return { destination: value.replace(/市/g, '') };
    case 'durationDays': {
      const days = Number(value.match(/\d+/)?.[0]);
      return Number.isFinite(days) ? { durationDays: days } : {};
    }
    case 'adults': {
      const adults = Number(value.match(/\d+/)?.[0]);
      return Number.isFinite(adults) ? { adults } : {};
    }
    case 'budgetPerPersonCny': {
      const budgetPerPersonCny = Number(value.match(/\d+/)?.[0]);
      return Number.isFinite(budgetPerPersonCny) ? { budgetPerPersonCny } : {};
    }
    case 'startDate': return parseUserMessage(value);
    case 'interests': return { interests: value };
    case 'pace': return { pace: value };
    case 'lodgingPreferences': return { lodgingPreferences: value };
    case 'dietaryRestrictions': return { dietaryRestrictions: value };
    case 'mobilityRestrictions': return { mobilityRestrictions: value };
  }
}

function message(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: randomUUID(), role, text, createdAt: new Date().toISOString() };
}

// A session's brief and chat progress are projected into one durable local file,
// while every visible chat turn is also appended to its Pi Durable conversation.
export class TripService {
  private readonly commandQueues = new Map<string, Promise<void>>();
  private constructor(
    private readonly store: SessionStore,
    private readonly journal: DurableJournal,
    readonly config: LocalConfig,
    private readonly plan: (session: TripSession, report: (step: NonNullable<TripSession['planningStep']>) => Promise<void>) => Promise<ItineraryDelivery>,
  ) {}

  static async open(folder: string, overridePlan?: (session: TripSession, report: (step: NonNullable<TripSession['planningStep']>) => Promise<void>) => Promise<ItineraryDelivery>): Promise<TripService> {
    await mkdir(folder, { recursive: true });
    const store = await SessionStore.open(join(folder, 'sessions.json'));
    const config = await LocalConfig.open(join(folder, 'settings.json'));
    const plan = overridePlan ?? (async (session: TripSession, report: (step: NonNullable<TripSession['planningStep']>) => Promise<void>) => {
      const settings = config.get();
      if (!settings.amapWebKey || !settings.modelApiKey || !settings.modelName) throw new Error('planning_keys_missing');
      const amap = new AMapClient(settings.amapWebKey);
      const model = new ModelClient(settings.modelBaseUrl, settings.modelApiKey, settings.modelName);
      const city = session.brief.destination!;
      await report('searching');
      const keywords = ['景点', '博物馆', '公园', session.brief.interests!];
      const groups = await Promise.all(keywords.map((keyword) => amap.searchPlaces(city, keyword)));
      const places = [...new Map(groups.flat().map((place) => [place.id, place])).values()];
      await report('ranking');
      const ranking = await model.rankPlaces(session.brief, places);
      await report('routing');
      const delivery = await buildDelivery(session.id, session.deliveries.length + 1, session.brief, places, ranking,
        (from, to) => chooseCityRoute(amap, city, session.brief.mobilityRestrictions ?? '', from, to));
      await report('validating');
      return delivery;
    });
    const journal = await DurableJournal.open(join(folder, 'conversations.sqlite'), async (sessionId) => {
      const session = store.get(sessionId);
      if (!session) throw new Error('session_not_found');
      return plan(session, async (step) => { await store.update(sessionId, (current) => { current.planningStep = step; }); });
    });
    const service = new TripService(store, journal, config, plan);
    // A process can exit between changing the projection to planning and
    // committing its Pi task. That state has no work to resume.
    for (const session of store.all().filter((item) => item.status === 'planning' && !item.planningTaskId)) {
      const reply = '上次规划在创建任务前中断。请检查配置后重新确认规划。';
      await journal.append(session.conversationId, 'assistant', reply);
      await store.update(session.id, (current) => {
        current.status = 'failed';
        current.messages.push(message('assistant', reply));
      });
    }
    // Work admitted before a crash has a persisted task ID. Reattach the
    // projection without blocking the API from serving other sessions.
    for (const session of store.all().filter((item) => item.status === 'planning' && item.planningTaskId)) {
      void service.finishPlan(session.id, session.planningTaskId!).catch(() => {});
    }
    return service;
  }

  list(): TripSession[] { return this.store.list(); }
  listTrashed(): TripSession[] { return this.store.listTrashed(); }
  listArchived(): TripSession[] { return this.store.listArchived(); }
  get(id: string): TripSession | undefined { return this.store.get(id); }
  watch(id: string, listener: (session: TripSession) => void): () => void { return this.store.watch(id, listener); }

  async trash(id: string): Promise<TripSession> { return this.store.trash(id); }
  async restore(id: string): Promise<TripSession> { return this.store.restore(id); }

  async createSession(): Promise<TripSession> {
    const conversationId = await this.journal.create();
    return this.store.create('新的旅行', conversationId);
  }

  async rename(id: string, title: string): Promise<TripSession> {
    const safe = title.trim().slice(0, 60);
    if (!safe) throw new Error('empty_title');
    return this.store.update(id, (session) => { if (session.trashedAt) throw new Error('session_trashed'); session.title = safe; });
  }

  async archive(id: string): Promise<TripSession> {
    return this.store.update(id, (session) => {
      if (session.trashedAt) throw new Error('session_trashed');
      if (session.status === 'archived') throw new Error('session_already_archived');
      if (session.status === 'planning') throw new Error('planning_in_progress');
      session.statusBeforeArchive = session.status;
      session.status = 'archived';
      session.archivedAt = new Date().toISOString();
    });
  }

  async restoreArchive(id: string): Promise<TripSession> {
    return this.store.update(id, (session) => {
      if (session.status !== 'archived' || session.trashedAt) throw new Error('session_not_archived');
      session.status = session.statusBeforeArchive ?? 'collecting';
      session.statusBeforeArchive = undefined;
      session.archivedAt = undefined;
    });
  }

  private serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.commandQueues.get(id) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    const settled = result.then(() => {}, () => {});
    this.commandQueues.set(id, settled);
    void settled.then(() => { if (this.commandQueues.get(id) === settled) this.commandQueues.delete(id); });
    return result;
  }

  async send(id: string, text: string, requestId?: string): Promise<TripSession> {
    // The same request can reach the local API twice concurrently after a
    // client retry. Serialize per session before checking its durable marker.
    return this.serialize(id, () => this.sendNow(id, text, requestId));
  }

  private async sendNow(id: string, text: string, requestId?: string): Promise<TripSession> {
    const current = this.store.get(id);
    if (!current) throw new Error('session_not_found');
    if (current.trashedAt) throw new Error('session_trashed');
    if (current.status === 'archived') throw new Error('session_archived');
    if (requestId && current.processedRequests?.[requestId]) {
      if (current.processedRequests[requestId] !== text.trim()) throw new Error('request_id_conflict');
      return current;
    }
    if (current.status === 'planning') throw new Error('planning_in_progress');
    const value = text.trim();
    if (!value) throw new Error('empty_message');
    const pending = nextMissingSlot(current.brief);
    const extracted = parseUserMessage(value);
    // A short answer such as “上海” is interpreted against the pending question.
    const contextual = pending && Object.keys(extracted).length === 0 ? answerForSlot(pending, value) : {};
    if (current.status === 'ready' && Object.keys(extracted).length === 0) {
      const reply = '我还没能识别这项调整。请明确告诉我想改变的日期、天数、预算、兴趣或旅行节奏。';
      await this.journal.append(current.conversationId, 'user', value, requestId && `${requestId}:user`);
      await this.journal.append(current.conversationId, 'assistant', reply, requestId && `${requestId}:assistant`);
      return this.store.update(id, (session) => {
        session.messages.push(message('user', value), message('assistant', reply));
        if (requestId) (session.processedRequests ??= {})[requestId] = value;
      });
    }
    let brief: TripBrief;
    try { brief = mergeBrief(current.brief, { ...contextual, ...extracted }); }
    catch { brief = current.brief; }
    const missing = nextMissingSlot(brief);
    const reply = missing ? slotQuestions[missing] : current.status === 'ready'
      ? '已记录调整。请核对旅行简报，确认后我会生成新的行程版本。'
      : '信息已收集齐全。请核对旅行简报，确认后我开始规划。';
    await this.journal.append(current.conversationId, 'user', value, requestId && `${requestId}:user`);
    await this.journal.append(current.conversationId, 'assistant', reply, requestId && `${requestId}:assistant`);
    return this.store.update(id, (session) => {
      session.brief = brief;
      session.status = missing ? 'collecting' : 'confirming';
      session.messages.push(message('user', value), message('assistant', reply));
      if (requestId) (session.processedRequests ??= {})[requestId] = value;
      if (brief.destination && session.title === '新的旅行') session.title = `${brief.destination}旅行`;
    });
  }

  async updateBrief(id: string, patch: Partial<TripBrief>): Promise<TripSession> {
    return this.store.update(id, (session) => {
      if (session.trashedAt) throw new Error('session_trashed');
      if (session.status === 'archived') throw new Error('session_archived');
      if (session.status === 'planning') throw new Error('planning_in_progress');
      session.brief = mergeBrief(session.brief, patch);
      session.status = nextMissingSlot(session.brief) ? 'collecting' : 'confirming';
    });
  }

  async confirm(id: string): Promise<TripSession> {
    const current = this.store.get(id);
    if (!current) throw new Error('session_not_found');
    if (current.trashedAt) throw new Error('session_trashed');
    if (current.status === 'archived') throw new Error('session_archived');
    if (nextMissingSlot(current.brief)) throw new Error('incomplete_brief');
    if (current.status === 'planning') throw new Error('planning_in_progress');
    await this.store.update(id, (session) => { session.status = 'planning'; session.planningStep = 'queued'; });
    const taskId = await this.journal.startPlan(current.conversationId, id);
    await this.store.update(id, (session) => { session.planningTaskId = taskId; });
    return this.finishPlan(id, taskId);
  }

  private async finishPlan(id: string, taskId: number): Promise<TripSession> {
    const current = this.store.get(id);
    if (!current) throw new Error('session_not_found');
    try {
      const delivery = await this.journal.waitPlan(taskId);
      if (delivery.status !== 'ready') throw new Error('delivery_not_ready');
      if (current.deliveries.some((item) => item.id === delivery.id)) return current;
      const reply = `行程规划完成：${delivery.city} ${delivery.durationDays} 日。点击下方卡片查看路线与攻略。`;
      await this.journal.append(current.conversationId, 'assistant', reply);
      return this.store.update(id, (session) => {
        session.status = 'ready'; session.planningTaskId = undefined; session.planningStep = undefined;
        session.deliveries.push(delivery);
        session.messages.push({ ...message('assistant', reply), deliveryVersion: delivery.version });
      });
    } catch (error) {
      const reason = (error as Error).message;
      const reply = reason === 'planning_keys_missing' ? '还需要配置模型 API Key、模型名称和高德 Web 服务 Key，才能开始联网规划。' : `规划未完成：${reason}。你可以检查配置后重试。`;
      await this.journal.append(current.conversationId, 'assistant', reply);
      await this.store.update(id, (session) => {
        session.status = 'failed'; session.planningTaskId = undefined; session.planningStep = undefined;
        session.messages.push(message('assistant', reply));
      });
      throw error;
    }
  }

  async close(): Promise<void> { await this.journal.close(); }
}
