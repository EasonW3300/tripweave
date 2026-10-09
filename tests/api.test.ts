import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApi } from '../src/server/api';

describe('本地 API', () => {
  it('创建会话并推进问询', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-api-'));
    const api = await createApi(folder);
    try {
      const created = await api.inject({ method: 'POST', url: '/api/sessions' });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;
      const response = await api.inject({ method: 'POST', url: `/api/sessions/${id}/messages`, payload: { text: '我想去北京玩5天' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().brief.destination).toBe('北京');
      expect(response.json().messages.at(-1).text).toContain('从哪个城市出发');
    } finally { await api.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('删除单个会话后可从回收站恢复，其他会话不受影响', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-api-trash-'));
    const api = await createApi(folder);
    try {
      const first = (await api.inject({ method: 'POST', url: '/api/sessions' })).json();
      const second = (await api.inject({ method: 'POST', url: '/api/sessions' })).json();
      const removed = await api.inject({ method: 'DELETE', url: `/api/sessions/${first.id}` });
      expect(removed.statusCode).toBe(200);
      expect((await api.inject({ method: 'GET', url: '/api/sessions' })).json().map((row: { id: string }) => row.id)).toEqual([second.id]);
      expect((await api.inject({ method: 'GET', url: '/api/trash' })).json()[0].id).toBe(first.id);
      expect((await api.inject({ method: 'GET', url: `/api/sessions/${first.id}` })).statusCode).toBe(404);
      expect((await api.inject({ method: 'GET', url: `/api/sessions/${first.id}/itinerary/1.html` })).statusCode).toBe(404);
      expect((await api.inject({ method: 'PATCH', url: `/api/sessions/${first.id}`, payload: { title: '改名' } })).statusCode).toBe(400);
      expect((await api.inject({ method: 'POST', url: `/api/sessions/${first.id}/messages`, payload: { text: '你好' } })).statusCode).toBe(400);
      expect((await api.inject({ method: 'POST', url: `/api/trash/${first.id}/restore` })).statusCode).toBe(200);
      expect((await api.inject({ method: 'GET', url: '/api/sessions' })).json()).toHaveLength(2);
    } finally { await api.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('归档与恢复不会混入回收站，重命名仅修改指定会话', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-api-archive-'));
    const api = await createApi(folder);
    try {
      const first = (await api.inject({ method: 'POST', url: '/api/sessions' })).json();
      const second = (await api.inject({ method: 'POST', url: '/api/sessions' })).json();
      const renamed = await api.inject({ method: 'PATCH', url: `/api/sessions/${first.id}`, payload: { title: '北京春游' } });
      expect(renamed.json().title).toBe('北京春游');
      expect((await api.inject({ method: 'PATCH', url: `/api/sessions/${first.id}`, payload: { archive: true } })).statusCode).toBe(200);
      expect((await api.inject({ method: 'GET', url: '/api/sessions' })).json().map((row: { id: string }) => row.id)).toEqual([second.id]);
      expect((await api.inject({ method: 'GET', url: '/api/archive' })).json()[0].title).toBe('北京春游');
      expect((await api.inject({ method: 'GET', url: '/api/trash' })).json()).toEqual([]);
      expect((await api.inject({ method: 'POST', url: `/api/archive/${first.id}/restore` })).statusCode).toBe(200);
      expect((await api.inject({ method: 'GET', url: '/api/sessions' })).json()).toHaveLength(2);
    } finally { await api.close(); await rm(folder, { recursive: true, force: true }); }
  });
});
