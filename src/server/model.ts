import type { TripBrief } from '../shared/trip';
import type { Place } from './amap';
import type { RankedPlace } from './planner';

// Ranking text is untrusted even when the prompt forbids fabricated facts.
// Conservative screening keeps common price/schedule claims out of a sourced itinerary.
const unsupportedFactPattern = /[0-9０-９]|免费|门票|票价|开放|闭馆|营业|预约|售票|入场费|票务/;
const fallbackTip = '可根据个人兴趣安排游览；门票、开放与预约信息请另行核实。';

export class ModelClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async rankPlaces(brief: TripBrief, candidates: Pick<Place, 'id' | 'name' | 'address'>[]): Promise<RankedPlace[]> {
    if (!this.apiKey || !this.model) throw new Error('model_not_configured');
    const endpoint = new URL(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`);
    const response = await this.request(endpoint, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model, temperature: 0.3, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是中国境内城市旅行规划助手。只能从候选 POI 的 id 中选择，不得新造地点、事实、坐标、门票或营业时间。根据用户偏好排序，每天至少选 2 个不同地点。返回严格 JSON：{"ranked":[{"id":"候选ID","tips":"不含未经验证事实的简短游览建议"}]}。' },
          { role: 'user', content: JSON.stringify({ brief, candidates }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`model_http_${response.status}`);
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('model_empty_response');
    let parsed: { ranked?: { id?: unknown; tips?: unknown }[] };
    try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch { throw new Error('model_invalid_json'); }
    const allowed = new Set(candidates.map((place) => place.id));
    const used = new Set<string>();
    return (parsed.ranked ?? []).flatMap((item): RankedPlace[] => {
      if (typeof item.id !== 'string' || !allowed.has(item.id) || used.has(item.id)) return [];
      used.add(item.id);
      const suggestion = typeof item.tips === 'string' ? item.tips.trim().slice(0, 180) : '';
      return [{ id: item.id, tips: suggestion && !unsupportedFactPattern.test(suggestion) ? suggestion : fallbackTip }];
    });
  }
}
