import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AppSettings {
  modelApiKey: string;
  modelBaseUrl: string;
  modelName: string;
  amapWebKey: string;
  amapJsKey: string;
  amapSecurityCode: string;
}

const defaults: AppSettings = {
  modelApiKey: '', modelBaseUrl: 'https://api.openai.com/v1', modelName: '',
  amapWebKey: '', amapJsKey: '', amapSecurityCode: '',
};

export class LocalConfig {
  private constructor(private readonly path: string, private settings: AppSettings) {}

  static async open(path: string): Promise<LocalConfig> {
    try { return new LocalConfig(path, { ...defaults, ...JSON.parse(await readFile(path, 'utf8')) }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return new LocalConfig(path, { ...defaults });
    }
  }

  get(): Readonly<AppSettings> { return this.settings; }

  publicState() {
    return {
      modelBaseUrl: this.settings.modelBaseUrl, modelName: this.settings.modelName,
      hasModelApiKey: !!this.settings.modelApiKey,
      hasAmapWebKey: !!this.settings.amapWebKey,
      hasAmapJsKey: !!this.settings.amapJsKey,
      amapJsKey: this.settings.amapJsKey,
      hasAmapSecurityCode: !!this.settings.amapSecurityCode,
      amapSecurityCode: this.settings.amapSecurityCode,
    };
  }

  async update(patch: Partial<AppSettings>): Promise<void> {
    if (patch.modelBaseUrl && !/^https:\/\//.test(patch.modelBaseUrl)) throw new Error('model_base_url_must_use_https');
    this.settings = { ...this.settings, ...patch };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.path);
  }
}
