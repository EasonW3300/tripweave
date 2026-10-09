import Fastify from 'fastify';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TripService } from './trip-service';
import { renderItineraryHtml } from './html';
import { formatSessionEvent } from './sse';

// SSE sends committed session projections; reconnecting clients always get a
// fresh snapshot before subsequent updates rather than replaying stale UI.

// Fastify validates the local HTTP boundary before mutating any trip session.
export async function createApi(folder: string) {
  const service = await TripService.open(folder);
  const app = Fastify({ logger: false });
  app.addHook('onClose', async () => { await service.close(); });

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/settings', async () => service.config.publicState());
  app.put<{ Body: Record<string, unknown> }>('/api/settings', async (request, reply) => {
    const allowed = ['modelApiKey', 'modelBaseUrl', 'modelName', 'amapWebKey', 'amapJsKey', 'amapSecurityCode'];
    const patch = Object.fromEntries(Object.entries(request.body ?? {}).filter(([key, value]) => allowed.includes(key) && typeof value === 'string'));
    try { await service.config.update(patch); return service.config.publicState(); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });
  app.get('/api/sessions', async () => service.list());
  app.get('/api/trash', async () => service.listTrashed());
  app.get('/api/archive', async () => service.listArchived());
  app.post('/api/sessions', async (_request, reply) => {
    reply.code(201);
    return service.createSession();
  });
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = service.get(request.params.id);
    if (!session || session.trashedAt || session.status === 'archived') return reply.code(404).send({ error: 'session_not_found' });
    return session;
  });
  app.get<{ Params: { id: string } }>('/api/sessions/:id/events', async (request, reply) => {
    const session = service.get(request.params.id);
    if (!session || session.trashedAt || session.status === 'archived') return reply.code(404).send({ error: 'session_not_found' });
    reply.hijack();
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-cache');
    reply.raw.setHeader('connection', 'keep-alive');
    reply.raw.write(formatSessionEvent('snapshot', session));
    const stop = service.watch(session.id, (updated) => {
      if (!reply.raw.writableEnded) reply.raw.write(formatSessionEvent('update', updated));
    });
    const heartbeat = setInterval(() => { if (!reply.raw.writableEnded) reply.raw.write(': keepalive\n\n'); }, 20000);
    request.raw.on('close', () => { stop(); clearInterval(heartbeat); });
    return reply;
  });
  // DELETE is deliberately recoverable: it moves only this session into the
  // local recycle bin and leaves the durable Pi transcript available to restore.
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    try { return await service.trash(request.params.id); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: { id: string } }>('/api/trash/:id/restore', async (request, reply) => {
    try { return await service.restore(request.params.id); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: { id: string } }>('/api/archive/:id/restore', async (request, reply) => {
    try { return await service.restoreArchive(request.params.id); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });
  app.patch<{ Params: { id: string }; Body: { title?: string; archive?: boolean } }>('/api/sessions/:id', async (request, reply) => {
    try {
      if (request.body.archive) return await service.archive(request.params.id);
      if (typeof request.body.title === 'string') return await service.rename(request.params.id, request.body.title);
      return reply.code(400).send({ error: 'invalid_update' });
    } catch { return reply.code(400).send({ error: 'invalid_update' }); }
  });
  app.post<{ Params: { id: string }; Body: { text?: string; requestId?: string } }>('/api/sessions/:id/messages', async (request, reply) => {
    if (typeof request.body?.text !== 'string' || request.body.text.length > 4000 || (request.body.requestId !== undefined && (typeof request.body.requestId !== 'string' || request.body.requestId.length > 100))) return reply.code(400).send({ error: 'invalid_message' });
    try { return await service.send(request.params.id, request.body.text, request.body.requestId); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/sessions/:id/brief', async (request, reply) => {
    try { return await service.updateBrief(request.params.id, request.body); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: { id: string } }>('/api/sessions/:id/confirm', async (request, reply) => {
    try { return await service.confirm(request.params.id); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });
  app.get<{ Params: { id: string; version: string } }>('/api/sessions/:id/itinerary/:version.html', async (request, reply) => {
    const session = service.get(request.params.id);
    const delivery = session?.deliveries.find((item) => item.version === Number(request.params.version));
    if (!session || session.trashedAt || session.status === 'archived' || !delivery) return reply.code(404).send({ error: 'delivery_not_found' });
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: data:; connect-src 'none'; base-uri 'none'; form-action 'none'");
    return renderItineraryHtml(delivery, session.brief);
  });
  return app;
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const folder = process.env.TRIPWEAVE_DATA_DIR ?? join(process.cwd(), 'work', 'data');
  const app = await createApi(folder);
  await app.listen({ port: 4321, host: '127.0.0.1' });
  process.stdout.write('TripWeave API listening on http://127.0.0.1:4321\n');
}
