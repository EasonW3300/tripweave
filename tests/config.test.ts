import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalConfig } from '../src/server/config';

describe('本地配置', () => {
  it('公开状态只说明 Key 是否已设置，不返回凭证', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tripweave-config-'));
    try {
      const config = await LocalConfig.open(join(folder, 'settings.json'));
      await config.update({ modelApiKey: 'secret-model-key', amapWebKey: 'secret-map-key', modelBaseUrl: 'https://api.example.com/v1', modelName: 'travel-model' });
      expect(JSON.stringify(config.publicState())).not.toContain('secret-');
      expect(config.publicState().hasModelApiKey).toBe(true);
      expect(config.publicState().hasAmapWebKey).toBe(true);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
