# 旅游规划 Agent GitHub 调研

> 调研日期：2026-10-07
> 范围：优先核查项目自己的 GitHub 仓库、README、源码与许可证；不以聚合文章作为结论依据。

## 结论摘要

建议不要 fork 一个项目后整体改造，而是采用“运行时 + 旅行领域工作流 + 独立交互层”的组合：

1. 用 [`@earendil-works/pi-durable`](https://github.com/earendil-works/pi/tree/main/packages/durable) 承担持久会话、任务、工具调用、断点恢复和流式事件。它正是“Pi Durable”最准确的官方指代，并非独立仓库。
2. 以 [`JourneyPilot`](https://github.com/Lagom-TA/JourneyPilot) 的结构化行程、证据绑定、地图/报告同源数据设计为主要旅行领域参考；以 LangChain 官方示例的 interrupt/HITL、并行研究和长期偏好模式作为工作流参考。
3. IM 客户端与地图不要耦合进 agent 内核。前端订阅 Pi Durable 的 committed view/events；行程用稳定的结构化 schema 渲染聊天消息、日程页和地图。
4. 预订功能建议 MVP 先做“检索/比价/深链或受控浏览器填表，停在支付前”。真实出票、下单、退款和支付属于高风险副作用，必须有人类确认、幂等键、审计日志及供应商合规方案。

## 1. Pi Durable：准确身份与能力边界

### 项目身份

- 官方仓库：[`earendil-works/pi`](https://github.com/earendil-works/pi)
- 包：[`packages/durable`](https://github.com/earendil-works/pi/tree/main/packages/durable)，npm 名为 `@earendil-works/pi-durable`
- 官方说明：[`packages/durable/README.md`](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)
- 许可证：仓库 [`LICENSE`](https://github.com/earendil-works/pi/blob/main/LICENSE) 为 MIT
- 运行要求：[`package.json`](https://github.com/earendil-works/pi/blob/main/packages/durable/package.json) 显示 TypeScript ESM、Node `>=22.19`；调研时包版本为 `1.0.4`
- 活跃度：[`main commits`](https://github.com/earendil-works/pi/commits/main/) 在 2026 年 9 月仍有密集提交；同时官方 README 明示 durable 为 **Experimental**，API 可能无预警变化。活跃不等于接口稳定。

### Runtime / persistence / tool 模型

Pi Durable 的中心不是一个传统的“聊天记录表”，而是 Harness 上的持久对象模型：不可变 conversation entries、atomic commits、typed JSON documents、checkpointed tasks 和 exactly-once submission。conversation 会持久保存模型、thinking、扩展、工具、instructions 与 cwd 的选择；重启时再从 registry 解析这些名字。概念与 quick start 均见[官方 README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#concepts)。

官方提供三类 storage：

- Memory：测试用，不跨进程持久化。
- SQLite：单文件，WAL + `synchronous=NORMAL`；适合 MVP 单实例，进程崩溃后可恢复已经提交的状态，但宿主/断电时最新提交仍可能丢失。
- JSONL：append-only，可选择 fsync。

`resume()` 会恢复未完成任务，`requestId` 用于重试去重。关键限制是：**一个 storage 同时只能由一个进程拥有，框架没有跨进程锁**。横向扩展时需要“一个会话/存储一个 owner”的分片或 actor 路由，不能让多个 Web 实例直接共用同一 SQLite 文件。详见 [Storage](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#storage)。

模型通过 `@earendil-works/pi-ai` 的 provider/model registry 接入；总仓说明支持 OpenAI、Anthropic、Google 等供应商。每个 conversation 有持久 UUIDv7 provider session id，便于 provider prompt cache/session affinity。见[仓库 packages 总览](https://github.com/earendil-works/pi#packages)与[quick start](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#quick-start)。

工具与扩展模型：

- `defineExtension` 可组合工具、system prompt sections、hooks、wrappers 与 durable tasks。
- `defineTool` 使用 TypeBox 校验参数。
- 工具调用本身也是 durable task：执行意图先落盘。崩溃后只有声明为 `replay: "safe"` 的工具才自动重跑；其他工具会向模型返回 interrupted 结果。
- 内置能力主要是 read/write/edit/bash；旅行搜索、地图、定价与预订都要自建 extension/tool。

因此“查询景点”可以是 replay-safe；“锁价、创建订单、支付”必须是非安全重放工具，并带供应商幂等键与显式人工确认。详见 [Tools](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#tools)。

### 与 IM 前端的契合点

[`viewState()/watch()`](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#watching-a-conversation) 提供完整已提交视图和增量 operations，`watchEvents()` 提供 message/tool start/update 类型事件。慢客户端落后超过 100 帧时会收到最新 snapshot；partial answer/tool output 默认至多每 100ms 提交。这很适合在服务端桥接成 WebSocket 或 SSE，让聊天气泡、工具状态、行程卡片持续更新。

官方例子目录包含 restart-safe background subagents、child tasks、compaction、plan mode、reviewer 和 per-conversation sandbox 等模式，见 [`packages/durable/README.md#examples`](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#examples)。可将旅行任务拆为需求澄清、地点研究、交通/住宿搜索、路线优化、预算校验、交付渲染，但这些业务 agent 并非框架自带。

### 必须正视的限制

- API 仍是 Experimental，建议固定精确版本，并在升级前跑自己的恢复/重放测试。
- registry 本身不持久化；重启必须安装同名 extension。缺少定义的 pending task 会等待定义恢复，见 [Reload](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#reload)。
- Pi 总仓明确说明没有内建 filesystem/process/network/credential 权限系统，默认继承宿主进程权限；生产部署必须容器化、收紧网络出口、把票务凭证放在独立 secret/服务边界，见 [Permissions & containerization](https://github.com/earendil-works/pi#permissions--containerization)。
- SQLite 模式不适合多个副本无协调共享；生产多实例需要单 owner 路由、远程 storage facade，或在应用层建立 actor tenancy。

## 2. 值得复用或参考的旅游 Agent 项目

### A. JourneyPilot：最接近目标产品的数据与交付模型

- 仓库：[`Lagom-TA/JourneyPilot`](https://github.com/Lagom-TA/JourneyPilot)
- License：[`MIT`](https://github.com/Lagom-TA/JourneyPilot/blob/main/LICENSE)
- 活跃度信号：调研时仓库页面显示 0 stars/0 forks，无正式 releases；属于非常新的项目，采用前应审代码和测试，而不能只看功能清单。

它把交通、地点、天气、路线和网页研究聚合成结构化逐日行程、交互地图、报告和 PDF，并强调每个事实保留来源、路线/时刻/价格/供应商与来源链接紧邻行程项；支持研究计划审阅、中断恢复、局部编辑、撤销、取消、个人偏好与知识库。项目技术方向是 LangGraph + MCP + PostgreSQL/pgvector + FastAPI + React，见[官方 README](https://github.com/Lagom-TA/JourneyPilot#readme)。

最值得移植的是概念与 schema，而非整套 LangGraph runtime：

- 单一 delivery record 同时驱动日程、地图、来源、报告和 PDF，避免 LLM 分别生成互相矛盾的 HTML/文本。
- itinerary item 包含时间窗、时长、费用、坐标、连接交通、证据来源和替代方案。
- long-running plan 的可恢复/可撤销/可局部改写语义可映射到 Pi documents + tasks。
- MCP provider adapter 的分层可借鉴到 Pi extensions/tools。

注意官方明确说预订与购买仍留在相关供应商处；它不是出票引擎。README 展示了大量能力，但仓库极新，建议只提取明确测试覆盖的模块。

### B. Prism Travel Agent：浏览器预订与“支付前停下”的最佳参考

- 仓库：[`Prism-Shadow/travel-agent`](https://github.com/Prism-Shadow/travel-agent)
- License：[`Apache-2.0`](https://github.com/Prism-Shadow/travel-agent/blob/main/LICENSE)
- 活跃度信号：调研时 GitHub 页面显示 464 commits、67 stars、6 forks，且仓库有 changelog、测试/格式检查与桌面发行说明。

这个项目把聊天和可见浏览器放在同一窗口，支持内嵌浏览器或用户自己的 Chrome profile；示例包括携程机票/酒店、读取小红书并生成高德行程，并明确在支付页停下让用户完成最终支付。其 packages 清晰拆为产品 UI、desktop/visible browser、agent runtime/API、browser CLI/extension 与 skills，见[官方 README 的 architecture/package 导航](https://github.com/Prism-Shadow/travel-agent#contributing)。

建议复用/参考：

- browser-control + Chrome bridge 的边界设计；
- 每个 trip 下多个 conversation，共享目的地、日期、旅客、预算和 shared notes，但聊天历史分离；
- 用户可观察的浏览器自动化、任务前选浏览器、关键动作停在支付前；
- Apache-2.0 模块可在保留声明和 NOTICE 要求的前提下再利用。

集成 caveat：这是 Electron/desktop 产品，直接搬入纯 Web 应用会带来较重的 browser-control 与账户登录安全问题。仓库也指出高级 secret 输入仍等待 runtime isolation 决策；不要让通用 LLM/浏览器工具直接读取支付凭证。

### C. LangChain 官方 demo：需求追问/HITL 的干净参考

- 仓库：[`langchain-samples/demos-travel-planner-agent`](https://github.com/langchain-samples/demos-travel-planner-agent)
- License：README 只说参考组织 repository policy，**没有给出可直接复用的标准开源许可证**；因此适合学习模式，不建议复制代码，除非另行取得许可。

工作流先并行规范化目的地/日期和推断出发地，通过 barrier 汇合，再研究天气，通过 `interrupt()` 询问偏好，之后地理编码、交通摘要、景点研究和逐日装配；同时提供 React + Tailwind 的聊天 UI、streaming interrupt/resume 测试。见[官方 README](https://github.com/langchain-samples/demos-travel-planner-agent/blob/main/README.md)。

适合映射到 Pi Durable 的模式是：

- 需求槽位规范化和“还缺哪些关键条件”的确定性判断；
- 并行做不互相依赖的准备工作；
- 用 durable task/document 表示等待用户回答，而不是在一个长模型调用里阻塞；
- 以同一个状态对象继续被中断的计划。

### D. LangChain 官方 Deep Agents workshop：并行研究、记忆与确认

- 仓库：[`langchain-samples/travel-planner-deepagents-workshop`](https://github.com/langchain-samples/travel-planner-deepagents-workshop)
- License：[`MIT`](https://github.com/langchain-samples/travel-planner-deepagents-workshop/blob/main/LICENSE)

它演示酒店、航班、活动三个 subagent 并行扇出，Human-in-the-Loop middleware 在“预订”前暂停，用户偏好跨 thread 存入独立 namespace，并为 itinerary/budget/packing/travel brief 使用技能文件；还包含 trajectory、constraint、efficiency 与 LLM judge 评测。见[官方 README](https://github.com/langchain-samples/travel-planner-deepagents-workshop#readme)。

它的 travel APIs 是 deterministic stubs，不是生产数据接入。最值得移植的是 agent 分工、确认点和评测集设计，而非工具实现。

### E. WanderAI：聊天逐问 + 动态 widget + 地图的直接 UI 参考

- 仓库：[`dimkail551/wander-ai-travel-agent`](https://github.com/dimkail551/wander-ai-travel-agent)
- 许可证：仓库页面和 README 未展示 LICENSE；在确认授权前只能阅读其设计，不应复制代码。

它的聊天端一次问一个问题，覆盖出发地、目的地、人数、预算、时长、兴趣和特殊要求；返回严格 JSON 中的 `ui` 字段，告诉客户端渲染预算选择器、天数计数器等 widget；目的地一旦确定，地图就提前 fly-to，最终结构化结果包含酒店、逐日行程和坐标，保存到 PostgreSQL JSON。前端为 Next.js、Zustand、Mapbox GL/react-map-gl。见[官方 README 架构段](https://github.com/dimkail551/wander-ai-travel-agent#architecture--request-flow)。

这个交互非常贴合需求，建议重新实现其协议思想：`assistant_message + requested_slot + ui_component + validation_schema`，不要复制未授权代码。

### F. Trip Planner Agent：简单的 React 流式 Agent 面板

- 仓库：[`AbhinavCoder-14/Trip-Planner-Agent`](https://github.com/AbhinavCoder-14/Trip-Planner-Agent)
- License：[`MIT`](https://github.com/AbhinavCoder-14/Trip-Planner-Agent#license)
- 活跃度信号：调研时 GitHub 页面显示 0 stars/0 forks，适合当样例而非生产基座。

它将 Python/LangGraph agent 与 React + TypeScript/Vite 前端拆成 HTTP 服务，UI 展示 agent reasoning/streaming 状态，后端组合 web search、预算计算和 itinerary structuring。见[官方 README](https://github.com/AbhinavCoder-14/Trip-Planner-Agent#readme)。可参考其简单前后端协议，但在生产 UI 中不应暴露私有 chain-of-thought；只展示可审计的工具进度、来源和简短状态。

## 3. 地图、路径与预订模块

### 地图显示：MapLibre GL JS + react-map-gl

- [`maplibre/maplibre-gl-js`](https://github.com/maplibre/maplibre-gl-js)：WebGL 地图引擎，BSD-3-Clause；官方 Marker 源码支持绑定 Popup、点击切换，并处理键盘可达性，见 [`marker.ts`](https://github.com/maplibre/maplibre-gl-js/blob/main/src/ui/marker.ts)。
- [`visgl/react-map-gl`](https://github.com/visgl/react-map-gl)：React wrapper，可选 MapLibre backend，提供 `Marker`、`Popup`、`Source`、`Layer` 等组件；许可证见 [`LICENSE`](https://github.com/visgl/react-map-gl/blob/master/LICENSE)。

推荐做法：用 GeoJSON `FeatureCollection` 表示每日 stop 和 leg；地图 marker 点击只更新前端 `selectedStopId`，右侧/底部用 React 卡片展示图片、攻略、营业时间、费用、来源和预订入口。路线 geometry 用 `Source + Layer`，不要把 HTML 直接塞进地图 popup；这样移动端可以用 bottom sheet，桌面端用侧卡，共用同一状态。

中国大陆落地要额外处理地图供应商合规、底图许可与坐标系（WGS-84/GCJ-02）转换。OSM 公共 tile/Nominatim 服务不能默认当作无限量生产服务；需自托管或签约供应商并遵守 attribution/usage policy。

### 路线计算：OSRM

- 仓库：[`Project-OSRM/osrm-backend`](https://github.com/Project-OSRM/osrm-backend)
- License：[`BSD-2-Clause`](https://github.com/Project-OSRM/osrm-backend/blob/master/LICENSE.TXT)
- 官方 HTTP API 提供 route、nearest、table、match、trip 和 tile；`Trip` 可求近似访问顺序，`Table` 可生成时距矩阵，见 [`docs/http.md`](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/http.md)。

OSRM 适合道路/步行/骑行段的几何和时距，不等价于旅行行程优化器：它不了解景点开放时间、预约时段、用餐、预算、室内/天气偏好或公交班次。建议先用规则/约束优化产生 stop 顺序，再调用 route/table 验证；公共交通和中国铁路需单独 provider。

### 航班搜索/下单：Amadeus Node SDK

- 仓库：[`amadeus4dev/amadeus-node`](https://github.com/amadeus4dev/amadeus-node)
- License：[`MIT`](https://github.com/amadeus4dev/amadeus-node/blob/master/LICENSE)

官方 SDK 覆盖 Flight Offers Search、pricing 和 Flight Create Orders；官方教程给出“搜索 → branded fare → 确认最终价格 → 创建订单”的流程，见[Flights tutorial](https://github.com/amadeus4dev/developer-guides/blob/master/docs/resources/flights.md)。

限制：Self-Service 内容不覆盖所有航空公司/低成本航司，测试环境和生产商业权限不同；创建订单不等于可以无条件出票/收款。中国国内机票/火车票的覆盖、商户资质和 API 授权需要另谈，不能靠爬虫模拟成稳定生产预订接口。

### 浏览器式预订：优先受控流程而非通用“自动支付”

如果没有供应商正式 API，可参考 Prism Travel Agent 的 visible browser/Chrome bridge：搜索、比较、填表，并在最终支付前停下。每个副作用步骤要显示目标网站、商品、价格、退改条件和将要提交的数据；用户确认后才执行。登录态、验证码、实名信息、支付信息应留在用户浏览器或隔离的 provider service，避免进入模型上下文和 agent transcript。

## 4. 推荐架构

```text
React / Next.js IM client
  ├─ message timeline + dynamic slot widgets
  ├─ itinerary workspace (day/stop cards)
  ├─ MapLibre map (GeoJSON route + selected stop)
  └─ booking/browser pane
              │ WebSocket/SSE + commands
Application gateway / projection layer
  ├─ auth, tenant, trip/conversation IDs
  ├─ maps Pi view/events -> client events
  └─ serves a stable ItineraryDelivery read model
              │
Pi Durable single-owner runtime
  ├─ conversation + committed entries
  ├─ trip/profile/delivery typed documents
  ├─ clarification task / approval task
  └─ restart-safe subagents
       ├─ destination research
       ├─ transport & lodging search
       ├─ attraction verification
       ├─ route/constraint optimizer
       └─ evidence & budget reviewer
              │ typed extensions/tools
Provider adapters
  ├─ web/places/weather
  ├─ geocoder + OSRM/transit routing
  ├─ flight/hotel/rail APIs
  └─ visible browser automation (payment gated)
```

核心文档建议至少有：

- `TravelerProfile`：常用出发地、饮食、行动能力、住宿偏好、风险偏好。
- `TripBrief`：目的地、日期/天数、人数、预算、节奏、兴趣、硬限制和仍缺槽位。
- `ResearchFact`：字段、值、来源 URL、抓取时间、适用日期、置信度。
- `ItineraryDelivery`：days → items；每项含稳定 id、类型、时间窗、坐标、费用、证据 refs、booking action、备选项。
- `Approval`：动作摘要、价格/货币、供应商、幂等键、状态和用户确认记录。

“详细 HTML 页面”应是 `ItineraryDelivery` 的确定性渲染结果，而不是让模型自由生成任意 HTML。这样聊天、地图、打印页和分享页始终一致，并避免脚本注入。LLM 只产生通过 JSON Schema 校验的领域数据和说明文本。

## 5. 建议的 MVP 顺序

1. 对话澄清：一次一个关键问题，但允许用户一次补齐多个槽位；槽位完整性由确定性规则判断。
2. 研究与证据：地点、开放时间、交通、天气、住宿和预算都保存来源及抓取时间。
3. 路线与约束：先做逐日聚类、开放时间与预算校验，再用 OSRM/地图供应商计算路线。
4. 结构化交付：IM 中显示摘要和 agent 进度；独立行程页渲染时间线、地图、节点卡片和分享/打印。
5. 预订第一阶段只做 provider deep link、搜索结果和支付前浏览器流程；第二阶段再评估正式供应商 API、出票资质与售后。
6. 在接真实下单前，建立重启/重复提交/价格变化/供应商超时/用户撤回的故障测试，验证 Pi Durable 的 replay 与幂等策略。

## 6. 最终选择建议

| 层 | 首选 | 原因 | 不应直接照搬的部分 |
|---|---|---|---|
| durable runtime | Pi Durable | committed state、tasks、resume、events、subagents | 实验性 API、单 owner storage、无内建权限隔离 |
| 旅行领域模型 | JourneyPilot | 结构化行程、证据、地图/报告同源 | 项目极新；LangGraph runtime 不必一起迁移 |
| 对话/HITL | LangChain 官方两个示例的模式 | interrupt、并行研究、长期偏好、评测 | demo 中的 runtime 与 stub tools |
| IM/widget 协议 | 重新实现 WanderAI 的协议思想 | 一次一问、动态控件、地图提前响应 | 仓库未显示许可证，不复制源码 |
| 预订体验 | Prism Travel Agent | 可见浏览器、用户登录态、支付前停止 | Electron 整体、未隔离的 secret 流程 |
| 地图 | MapLibre GL JS + react-map-gl | 开源、marker/popup/GeoJSON 能力完整 | 生产 tile/geocoder 与中国合规需另配 |
| 道路路线 | OSRM | route/table/trip API，易自托管 | 不负责景点约束、公交与铁路 |
| 航班 | Amadeus SDK（海外 MVP） | 正式搜索/价格/订单 API | 内容覆盖、生产授权、中国市场适配 |
