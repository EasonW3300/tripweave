import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TripSession } from '../shared/trip';

// The JSON projection makes session lists cheap to read. Pi Durable separately
// owns each conversation transcript; writes here are serialized and replaced atomically.
export class SessionStore {
  private readonly sessions = new Map<string, TripSession>();
  private readonly watchers = new Map<string, Set<(session: TripSession) => void>>();
  private writeChain: Promise<void> = Promise.resolve();
  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<SessionStore> {
    const store = new SessionStore(path);
    try {
      const values = JSON.parse(await readFile(path, 'utf8')) as TripSession[];
      for (const value of values) store.sessions.set(value.id, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): TripSession[] {
    return [...this.sessions.values()].filter((session) => session.status !== 'archived' && !session.trashedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listTrashed(): TripSession[] {
    return [...this.sessions.values()].filter((session) => !!session.trashedAt)
      .sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
  }

  listArchived(): TripSession[] {
    return [...this.sessions.values()].filter((session) => session.status === 'archived' && !session.trashedAt)
      .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  }

  all(): TripSession[] { return [...this.sessions.values()]; }

  get(id: string): TripSession | undefined { return this.sessions.get(id); }

  watch(id: string, listener: (session: TripSession) => void): () => void {
    const listeners = this.watchers.get(id) ?? new Set<(session: TripSession) => void>();
    listeners.add(listener);
    this.watchers.set(id, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.watchers.delete(id); };
  }

  private notify(session: TripSession): void {
    // Emit only after disk persistence; a client snapshot must never claim a
    // state that cannot be recovered following a process exit.
    for (const listener of this.watchers.get(session.id) ?? []) {
      try { listener(session); } catch { /* A disconnected client cannot fail a write. */ }
    }
  }

  async create(title: string, conversationId: number): Promise<TripSession> {
    const now = new Date().toISOString();
    const session: TripSession = {
      id: randomUUID(), title, conversationId, status: 'collecting', brief: {},
      messages: [], deliveries: [], createdAt: now, updatedAt: now,
    };
    this.sessions.set(session.id, session);
    await this.persist();
    this.notify(session);
    return session;
  }

  async update(id: string, change: (session: TripSession) => void): Promise<TripSession> {
    const current = this.sessions.get(id);
    if (!current) throw new Error('session_not_found');
    const session = structuredClone(current);
    change(session);
    session.updatedAt = new Date().toISOString();
    this.sessions.set(id, session);
    await this.persist();
    this.notify(session);
    return session;
  }

  // Recycle-bin moves keep the Pi conversation and all delivery versions intact.
  // No background purge runs, so restoration is lossless unless a user later
  // explicitly requests a separate permanent-erasure operation.
  async trash(id: string): Promise<TripSession> {
    return this.update(id, (session) => {
      if (session.trashedAt) throw new Error('session_already_trashed');
      session.trashedAt = new Date().toISOString();
    });
  }

  async restore(id: string): Promise<TripSession> {
    return this.update(id, (session) => {
      if (!session.trashedAt) throw new Error('session_not_trashed');
      session.trashedAt = undefined;
    });
  }

  private persist(): Promise<void> {
    // A failed write must fail its caller, but must not permanently poison the
    // queue for later retries. Capture the snapshot at enqueue time.
    const snapshot = JSON.stringify([...this.sessions.values()], null, 2);
    const write = this.writeChain.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, snapshot);
      await rename(temporary, this.path);
    });
    this.writeChain = write;
    return write;
  }
}
