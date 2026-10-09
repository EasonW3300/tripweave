# 旅序 TripWeave MVP 设计规格

**日期：** 2026-10-07
**状态：** 用户已批准；2026-10-09 增补可恢复删除及高德单一数据源决策
**目标平台：** 本地单用户桌面浏览器应用
**目标市场：** 中国境内城市游

## 1. 产品目标

旅序 TripWeave 是一个 IM 形态的旅游规划 Agent。用户可以用自然语言提出模糊需求，例如“我想下个月去北京旅游”。Agent 通过多轮对话补齐出发地、具体日期、天数、人数、预算、兴趣、节奏和限制，展示旅行简报并取得确认，然后通过高德检索地点与计算路线，校验可核实的时间窗和已知费用，最终交付结构化逐日行程。未知的景区营业信息与费用不参与“已核实”结论。

规划完成前，界面保持专注聊天。规划完成后，AI 在聊天中发送一张行程交付卡片。用户点击卡片时，右侧展开占内容区 50% 宽度的行程与地图面板，聊天区域同步缩窄；再次点击同一卡片、点击关闭按钮或按 `Esc` 时收起面板。详细 HTML 行程页由同一份结构化数据确定性渲染。

MVP 的预订能力止于第三方深链：机票、火车票和酒店入口携带可表达的搜索条件跳转至第三方平台，由用户自行完成登录、实名、下单、支付和售后。

## 2. 已确认的产品决策

- 项目名称：旅序 TripWeave。
- 架构路线：组合式重构，不整体 fork 单一旅行项目。
- 运行方式：本地单用户。
- 旅行范围：中国境内城市游，北京作为首个验收样例但不写死。
- 地图供应商：高德地图 Web API 与 JS API。
- 坐标系统：内部统一使用 GCJ-02。
- 模型接入：应用独立配置 OpenAI-compatible API Key、Base URL 和模型名，不依赖用户的 Pi 登录状态。
- 持久运行时：`@earendil-works/pi-durable`，SQLite storage，固定精确依赖版本。
- 预订方式：第三方搜索深链，不在应用内交易。
- 客户端形态：IM 主界面、多旅行会话、按需展开的行程地图面板。
- 当前数据策略：只使用高德提供地点、坐标、路线和可用配图；门票价格、开放时间与预约规则保持“待核实”，不以高德的消费数据冒充门票报价，也不依据未知费用宣称预算可行。

## 3. 范围

### 3.1 MVP 包含

1. 新建、重命名、切换和归档多个旅行会话。
   单个会话的“删除”默认移入本机回收站，不自动永久清理；回收站可恢复原聊天、简报和行程版本。
2. 每个旅行会话独立保存聊天、旅行简报、研究事实、规划任务和行程版本。
3. 一次主动追问一个关键条件，同时允许从用户一条消息中提取多个槽位。
4. 旅行简报确认门槛。
5. 从高德 POI 获取地点、地址、坐标和可用配图并记录来源；不接入其他景点资料源。
6. 高德 POI 搜索、地理编码、步行/驾车/公交路线计算。
7. 逐日行程、预算摘要、地图节点、景点攻略、来源引用和备选项。
8. 可恢复的后台规划任务及进度展示。
9. AI 行程交付卡片及右侧 50% 面板展开/收起。
10. 地图节点、行程卡片和聊天地点引用联动。
11. 确定性生成响应式详细 HTML 行程页，并支持打印。
12. 机票、火车票和酒店的第三方搜索深链。
13. 本地设置页管理高德 Key 和 OpenAI-compatible 模型配置。

### 3.2 MVP 不包含

- 应用内出票、下单、支付、退款或自动提交实名信息。
- 用户账号、多租户、云同步、跨设备推送或多人协作。
- 境外地图和全球旅行供应商适配。
- 操作用户已登录的第三方预订页面。
- 跨会话合并行程。
- 将超出天气预报范围的预测展示为确定事实。
- 让 LLM 自由生成带脚本的任意 HTML。

## 4. 系统架构

```text
React IM client
  ├─ trip session sidebar
  ├─ message timeline + slot widgets
  ├─ delivery card
  └─ on-demand 50% itinerary/map panel
              │ HTTP commands + SSE events
Local application gateway / projection layer
  ├─ stable API and request validation
  ├─ Pi view/events → client event projection
  ├─ local configuration and secret boundary
  └─ deterministic HTML renderer
              │
Pi Durable single-owner runtime
  ├─ conversations and committed entries
  ├─ typed documents
  ├─ durable planning tasks
  └─ restart recovery and request deduplication
              │ typed extensions/tools
Provider adapters
  ├─ OpenAI-compatible model
  ├─ AMap POI/geocoding/routing
  ├─ image/source discovery
  └─ booking deep-link builders
              │
SQLite + local generated artifacts
```

### 4.1 边界原则

- 浏览器 UI 不直接操作 Pi Durable storage，也不保存权威行程。
- Pi Durable 是会话、任务和恢复语义的权威来源。
- `ItineraryDelivery` 是聊天交付卡片、地图、行程列表与 HTML 页面的唯一业务事实来源。
- Provider adapter 隔离高德、搜索和预订供应商的协议变化。
- 模型 API Key 与高德 Web 服务 Key 仅在本地服务进程中读取，不写入聊天、日志、HTML 或发送给模型。高德 JS 地图 Key 与安全密钥按浏览器 SDK 要求发送到前端，并在高德控制台限制域名；它们不能当作服务端秘密。
- Pi Durable storage 只由一个本地进程拥有，不启动多个共享同一 SQLite 的应用实例。

## 5. 交互设计

### 5.1 多会话导航

左侧旅行会话栏常驻，行为类似 Codex 的项目/session：

- “新建旅行规划”创建独立 `TripSession` 与 Pi conversation。
- 列表展示名称、更新时间以及 `等待回答 / 规划中 / 已完成 / 失败` 状态。
- 规划中的会话显示公开任务进度，不显示模型私有思维链。
- 切换会话不取消后台规划。
- 每个会话独立记住最后查看的行程版本；切入会话时默认不自动展开行程面板。

### 5.2 需求澄清

- Agent 从用户消息中提取所有能够确定的槽位。
- 确定性规则选择优先级最高的一个缺失槽位，AI 只主动询问这一项。
- 用户可以主动在一条消息里补齐多项信息。
- UI 可以为常见问题显示天数、人数、预算范围、节奏等快捷控件，但自由文本始终可用。
- 页面实时显示旅行简报，明确哪些信息已确定、哪些仍缺失。

### 5.3 简报确认

所有必要槽位齐全后，AI 展示结构化旅行简报。只有用户确认后，系统才能创建 `PlanningRun`。用户修改简报时回到信息收集状态，不使用旧条件静默规划。

### 5.4 规划和交付

- 规划期间在聊天中展示“检索地点、计算路线、核对已知费用、整理行程”等可审计步骤。
- 只有 `ItineraryDelivery.status = ready` 时才能发送交付卡片。
- 交付卡片包含目的地、天数、预算、节点数量、节奏或关键限制以及版本号。
- 点击未展开的卡片，打开该版本的右侧面板。
- 点击已经展开的同一卡片，关闭面板。
- 点击另一版本卡片，在右侧原位切换版本。
- 桌面内容区宽度不小于 1024px 时，面板占内容区 50%；聊天区域占剩余空间并保持可操作。
- 窄屏使用全屏行程抽屉，提供明确的“返回聊天”操作。

### 5.5 行程面板

- 左侧或顶部按天切换，展示当前日的时间线。
- 地图展示当前日路线和带序号节点。
- 点击地图节点、行程项或聊天地点引用，设置同一个 `selectedItemId`。
- 节点卡片展示可用图片、时间、时长、已知费用或“待核实”、AI 游览建议、开放/预约的待核实提示、来源和可用的外部入口。
- HTML 页入口打开独立响应式页面，该页面读取指定的行程版本。

## 6. 领域模型

### 6.1 `TripSession`

- `id`
- `title`
- `conversationId`
- `status`: `collecting | confirming | planning | ready | revising | failed | archived`
- `activeDeliveryVersion`
- `lastViewedDeliveryVersion`
- `panelOpen`
- `createdAt`, `updatedAt`, `archivedAt`

`panelOpen` 属于本地 UI 偏好，不决定业务行程是否 ready。切换到另一个会话时界面默认关闭面板；返回后仍能找到最后查看的版本。

### 6.2 `TripBrief`

必要字段：

- 出发地。
- 目的地城市。
- 明确的出发和结束日期；“下个月”必须解析为候选范围并由用户确认具体日期。
- 天数。
- 成人和儿童人数。
- 总预算及包含范围。
- 旅行节奏。
- 兴趣偏好。
- 住宿偏好或明确“无”。
- 饮食限制或明确“无”。
- 行动能力及其他硬限制或明确“无”。

可选字段包括交通偏好、必去/不去地点、早晚作息和常用出发地。

### 6.3 `ResearchFact`

- `id`, `field`, `value`
- `sourceUrl`, `sourceTitle`
- `retrievedAt`, `validForDate`
- `confidence`: `verified | probable | unverified`
- `provider`

地址、坐标、营业时间、门票、预约要求和交通数据不能仅由模型记忆生成。

### 6.4 `ItineraryDelivery`

- `tripSessionId`, `version`, `status`
- `briefSnapshot`
- `currency`, `budgetSummary`
- `days[]`
- `facts[]`
- `warnings[]`
- `generatedAt`

每天包含日期、主题、节点和路线段。每个节点包含稳定 ID、类型、开始时间、时长、GCJ-02 坐标、费用、攻略、图片、事实引用、预订动作及备选项。路线段包含交通方式、起终点 ID、距离、时长和高德路线几何。

### 6.5 `PlanningRun`

- `id`, `tripSessionId`, `briefRevision`
- `status`, `currentStep`, `progress`
- `startedAt`, `updatedAt`, `completedAt`
- `toolRuns[]`, `error`, `resumeState`

公开进度只描述任务阶段，不保存或展示模型私有思维链。

## 7. Agent 状态机

```text
COLLECTING
  └─ necessary slots complete → CONFIRMING
CONFIRMING
  ├─ user changes brief → COLLECTING
  └─ user confirms → PLANNING
PLANNING
  ├─ recoverable tool failure → retry/continue
  ├─ unresolved constraint → COLLECTING with targeted question
  ├─ terminal failure → FAILED
  └─ validation succeeds → READY
READY
  └─ user requests change → REVISING
REVISING
  ├─ validation succeeds → READY with a new version
  └─ clarification required → COLLECTING without deleting old versions
```

状态跃迁由应用规则执行，模型只能提出结构化意图，不能自行跳过确认或校验。

## 8. 规划流程

1. 规范化并确认旅行简报。
2. 检索高德 POI 候选，并将门票、营业时间、预约规则、住宿及跨城交通费用标记为待核实。
3. 通过高德获取 POI、地址和 GCJ-02 坐标。
4. 按地理邻近、日期可用性、兴趣和节奏将节点分配到各天。
5. 调用高德计算路线距离与时长。
6. 校验已知的每日时间窗、步行强度和已知费用；缺失的营业时间、预约日期与费用不宣称通过校验。
7. 若约束冲突，自动尝试备选节点或顺序；无法解决时回到聊天请求用户选择。
8. 生成并验证 `ItineraryDelivery` JSON。
9. 原子提交新版本，将会话设为 `ready` 并发送交付卡片。
10. 从同一版本确定性渲染地图、卡片和 HTML。

## 9. 工具与外部服务

### 9.1 高德适配器

- POI 搜索。
- 地理编码。
- 步行、驾车和公交路线。
- 所有返回值在边界处转换为内部类型，保留 provider 原始 ID 和更新时间。
- 不允许模型自行构造坐标。

### 9.2 当前资料来源边界

- 当前版本仅接受高德 POI 的地点名称、地址、GCJ-02 坐标及可用配图，并保留来源 URL 和获取时间。
- 高德 POI 不作为门票价格、景区开放时间或预约规则的核实依据；这些项目在节点卡片和 HTML 中逐项标为“待核实”。
- 模型提供的游览建议明确标为未经景区核实，不能写入 `ResearchFact`，也不得生成价格或开放时间断言。
- 原设计中的官网/文旅联网研究适配器延后，只有用户另行批准数据源与接入方式后才启用。

### 9.3 预订深链适配器

- 分别定义 `flight`、`rail` 和 `hotel` action。
- action 保存可复制的搜索条件和供应商 URL。
- URL 不能包含 API Key、模型上下文或未获用户授权的个人信息。
- 某供应商不支持可靠预填时，打开其搜索首页并同时展示可复制条件。

### 9.4 模型适配器

- 配置项为 `baseUrl`、`apiKey`、`model`。
- 模型仅对高德候选地点排序并提供标明未经核实的游览建议；输出必须解析为结构化数据并校验地点 ID，不能生成坐标或把景区价格、营业信息写成事实。
- 模型失败不能破坏已提交文档。

## 10. 持久化与恢复

- SQLite 由单一 Pi Durable 运行时进程持有。
- conversation entries、typed documents 和 task intent 先提交再执行副作用。
- POI、检索和路线查询可以声明为安全重放，但必须有超时和缓存策略。
- 第三方跳转属于客户端动作，不由恢复流程自动再次打开。
- 每次用户命令携带 request ID，避免网络重试造成重复消息或重复规划。
- 应用启动时恢复未完成 `PlanningRun`；若依赖配置缺失，则暂停并在会话中给出可操作错误。
- 精确锁定 Pi Durable 版本，升级前运行恢复和重放测试。

## 11. 错误处理

- **模型/搜索/高德超时：** 保留已完成步骤，对当前安全步骤进行有上限的指数退避重试。
- **Key 缺失或失效：** 暂停受影响任务，引导用户打开本地设置；不得把密钥或完整供应商错误送入模型。
- **资料缺失：** 将字段标记为 `unverified` 或“待核实”，不让模型补造。
- **路线不可达：** 尝试同类备选节点或其他交通方式；仍失败则向用户请求选择。
- **已知费用超预算：** 不进入 `READY`，先自动修订，无法满足时明确展示冲突。营业时间未知时不声称已通过营业时间校验，而是在交付内容中逐项提示待核实。
- **应用重启：** 从最后提交状态恢复，非安全工具返回 interrupted 状态而不是静默重放。
- **深链失效：** 保留并展示可复制的搜索条件。
- **部分规划失败：** 已验证事实和旧行程版本继续可读，新版本只有完整校验通过后才可见。

## 12. 安全与隐私

- API Key 存在本机 secret/config 边界，不进入 SQLite 会话正文和导出 HTML。
- Pi 进程只授予必需的网络和文件范围；不向旅行 Agent 暴露通用 shell 或任意文件工具。
- 外部网页内容视为不可信输入，防止 prompt injection。
- HTML 使用组件模板和转义后的结构化字段渲染，不执行模型提供的 HTML/JavaScript。
- 外部链接使用允许的 `https` 协议并进行域名策略校验。
- 本地导出不默认包含用户姓名、证件号或支付信息。

## 13. 测试策略

### 13.1 单元测试

- 槽位提取结果归并和缺失槽位优先级。
- 状态机合法与非法跃迁。
- `TripBrief` 和 `ItineraryDelivery` schema 校验。
- 日期、预算和每日时间窗校验。
- 地图节点、路线段和行程项引用完整性。
- 深链构建与输入转义。
- HTML renderer 不执行或透传任意脚本。

### 13.2 集成测试

- Pi Durable SQLite 创建、提交、重启和任务恢复。
- 相同 request ID 不产生重复消息或重复规划。
- 高德 adapter 的成功、超时、配额和无结果响应。
- SSE snapshot、增量事件和断线重连。
- 规划未通过校验时不会发布 `ready` 版本。

### 13.3 浏览器端到端测试

- 从“下个月去北京”开始完成逐步问询和简报确认。
- 规划完成前没有行程面板或空地图。
- 交付卡片点击后打开 50% 面板，再次点击、关闭按钮和 `Esc` 均能收起。
- 地图、时间线和聊天地点引用同步选择同一节点。
- 多会话切换不会串用消息、brief 或行程。
- 后台规划在切换会话后继续，并在完成时更新侧栏状态。
- HTML 页与指定行程版本的数据一致。

## 14. 验收标准

1. 用户输入“我想下个月去北京旅游”后，系统逐步补齐信息并让用户确认具体简报。
2. 未确认简报时不能开始正式规划；未完成并校验行程时不能发送交付卡片。
3. 规划完成后交付卡片能够稳定展开和收起右侧面板。
4. 地图、时间线、聊天卡片和 HTML 的地点、日期、顺序和费用来自同一个版本。
5. 地图节点全部具有来自高德的合法 GCJ-02 坐标。
6. 高德地点与路线事实带来源和抓取时间；价格、开放和预约信息在每个景点明确标为待核实。
7. 多个会话可以分别等待回答、后台规划或查看结果，且上下文互不污染。
8. 规划期间退出并重启应用后，任务能够恢复或呈现明确的可恢复暂停状态。
9. 第三方预订入口不自动提交订单，不收集支付信息。
10. 核心单元、集成和端到端测试通过。

## 15. 开源参考与复用边界

- [`@earendil-works/pi-durable`](https://github.com/earendil-works/pi/tree/main/packages/durable)：MIT；用于持久会话、任务、documents、events 和恢复。
- [`JourneyPilot`](https://github.com/Lagom-TA/JourneyPilot)：MIT；参考结构化行程、事实证据和地图/报告同源设计。
- [`MyTripPlanner`](https://github.com/Prot10/MyTripPlanner)：参考对话采访、地图/行程联动和工具化编辑理念；实际复用前逐文件核验许可证边界。
- [`Prism Travel Agent`](https://github.com/Prism-Shadow/travel-agent)：Apache-2.0；参考可见预订流程和支付前停止的边界，MVP 不移植其 Electron 浏览器控制。
- [`WanderAI`](https://github.com/dimkail551/wander-ai-travel-agent)：仓库未展示明确许可证；只参考“一次一问 + 动态组件”的产品思想，不复制源码。

完整调研见 [`docs/research/travel-agent-github-research.md`](../../research/travel-agent-github-research.md)。

## 16. 后续实施分解

MVP 适合拆成五个可独立验收的增量：

1. 本地应用骨架、多会话、IM 与 Pi Durable 持久恢复。
2. 旅行简报、逐问状态机与确认流程。
3. 高德检索与路线工具、规划任务与结构化行程生成；官网/文旅研究另行决策。
4. 交付卡片、按需 50% 行程地图面板和 HTML 渲染。
5. 预订深链、故障恢复、端到端测试与本地打包。
