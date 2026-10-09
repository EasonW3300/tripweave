import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { createRegistry, defineExtension, defineTask, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import type { ConversationId, Task, TaskId } from '@earendil-works/pi-durable';
import type { ItineraryDelivery } from '../shared/trip';

// Pi Durable owns the SQLite transcript and commit boundary. The travel workflow
// adds application entries without offering filesystem or shell tools to a model.
export class DurableJournal {
  private constructor(
    private readonly harness: Harness,
    private readonly planningTask: Task<{ sessionId: string }, { phase: 'run' }, ItineraryDelivery, object>,
  ) {}

  static async open(path: string, plan?: (sessionId: string) => Promise<ItineraryDelivery>): Promise<DurableJournal> {
    const storage = await openNodeSqliteStorage(path);
    // Reinstall the same named task on every start so Pi can resume checkpoints
    // that were committed before a process exit.
    const planningTask = defineTask<{ sessionId: string }, { phase: 'run' }, ItineraryDelivery>({
      name: 'tripweave.plan', version: 1,
      initial: () => ({ phase: 'run' }),
      phases: { run: async (task, runtime, context) => {
        try {
          if (!plan) throw new Error('planning_callback_missing');
          const delivery = await plan(task.input.sessionId);
          await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: delivery } }), context);
        } catch (error) {
          await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'failed', error: { message: (error as Error).message } } }), context);
        }
      } },
      abort: async (_task, runtime, context) => {
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context);
      },
    });
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'tripweave-planning', tasks: [planningTask] }));
    const harness = await Harness.open(storage, {
      models: createModels(), registry,
    }, BACKGROUND_CONTEXT);
    harness.resume();
    return new DurableJournal(harness, planningTask);
  }


  async startPlan(conversationId: number, sessionId: string): Promise<number> {
    const conversation = await this.harness.conversation(conversationId as ConversationId, BACKGROUND_CONTEXT);
    if (!conversation) throw new Error('conversation_not_found');
    return conversation.commit((tx) => tx.createTask(this.planningTask, { sessionId }, {
      ownership: { kind: 'conversation' }, background: true,
    }), BACKGROUND_CONTEXT);
  }

  async waitPlan(taskId: number): Promise<ItineraryDelivery> {
    const settled = await this.harness.waitForTask(taskId as TaskId<ItineraryDelivery>, BACKGROUND_CONTEXT);
    const outcome = settled.state.outcome;
    if (outcome.status === 'completed') return outcome.result;
    throw new Error(outcome.status === 'failed' ? outcome.error.message : `planning_${outcome.status}`);
  }

  async create(): Promise<number> {
    const conversation = await this.harness.createConversation({ ownership: { kind: 'ownerless' } }, BACKGROUND_CONTEXT);
    return conversation.id;
  }

  async append(id: number, role: 'user' | 'assistant', text: string, entryKey?: string): Promise<void> {
    const conversation = await this.harness.conversation(id as ConversationId, BACKGROUND_CONTEXT);
    if (!conversation) throw new Error('conversation_not_found');
    if (entryKey) {
      // A completed Pi commit can precede a process crash before the JSON
      // projection updates. Replay sees the stable key and skips that entry.
      const page = await conversation.entries({ order: 'ascending' }, 1000, undefined, BACKGROUND_CONTEXT);
      const prior = page.items.find((entry) => entry.kind === 'tripweave.chat' && (entry.data as { entryKey?: string }).entryKey === entryKey);
      if (prior) {
        const data = prior.data as { role: string; text: string };
        if (data.role !== role || data.text !== text) throw new Error('journal_entry_conflict');
        return;
      }
    }
    // One committed entry is the durable event exposed to the IM projection.
    await conversation.commit(async (tx) => {
      await tx.appendEntry(conversation.id, { kind: 'tripweave.chat', data: entryKey ? { role, text, entryKey } : { role, text } });
    }, BACKGROUND_CONTEXT);
  }

  async messages(id: number): Promise<{ role: 'user' | 'assistant'; text: string }[]> {
    const conversation = await this.harness.conversation(id as ConversationId, BACKGROUND_CONTEXT);
    if (!conversation) throw new Error('conversation_not_found');
    const page = await conversation.entries({ order: 'ascending' }, 1000, undefined, BACKGROUND_CONTEXT);
    return page.items.filter((entry) => entry.kind === 'tripweave.chat').map((entry) => {
      const data = entry.data as { role: 'user' | 'assistant'; text: string };
      return { role: data.role, text: data.text };
    });
  }

  async close(): Promise<void> { await this.harness.close(BACKGROUND_CONTEXT); }
}
