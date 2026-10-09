# TripWeave MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, single-user travel planning agent with independent chat sessions, durable planning, AMap itinerary, and a click-to-toggle delivery panel.

**Architecture:** A React client talks to one Node server over HTTP and SSE. The server owns Pi Durable SQLite, an application SQLite projection, LLM and AMap adapters, and deterministic itinerary rendering. The agent writes validated travel documents; the browser never treats model-generated HTML as executable UI.

**Tech Stack:** Node 22.19+, TypeScript, React, Vite, Fastify, `@earendil-works/pi-durable` 1.1.0 (exact pin), `@earendil-works/pi-ai`, SQLite, AMap JS/Web APIs, Vitest, Playwright.

## Global Constraints

- Local single-user application; multiple independent travel sessions.
- Chinese domestic city trips; GCJ-02 coordinates from AMap.
- OpenAI-compatible `baseUrl`, `apiKey`, `model` configured within the app.
- Booking is a third-party search deep link; no in-app order or payment.
- Delivery panel appears only after a ready itinerary. On desktop it occupies 50% of the content area and toggles from the chat delivery card.
- One versioned `ItineraryDelivery` feeds chat card, map, timeline and HTML page.
- No frontend, model transcript, or exported HTML may contain API keys.
- The exact Pi Durable release is pinned and its one-storage-one-owner limit is respected.

---

## File structure

```text
package.json                         scripts and pinned dependencies
src/shared/trip.ts                   domain types and schemas
src/shared/brief.ts                  slot merge and missing-slot rules
src/shared/itinerary.ts              route, time and budget validation
src/server/config.ts                 local configuration and secret storage
src/server/session-store.ts          session list and delivery projection
src/server/durable.ts                Pi Durable harness and recovery
src/server/model.ts                  OpenAI-compatible provider configuration
src/server/amap.ts                   POI, geocode, routing adapter
src/server/research.ts               sourced attraction facts
src/server/planner.ts                brief-to-delivery planning workflow
src/server/bookings.ts               flight, rail and hotel search actions
src/server/html.ts                   deterministic HTML itinerary renderer
src/server/api.ts                    Fastify HTTP and SSE endpoints
src/client/App.tsx                   shell and session selection
src/client/Chat.tsx                  conversation and slot widgets
src/client/DeliveryPanel.tsx         right-side timeline and map
src/client/styles.css                responsive layout
tests/                               domain, integration and UI behavior tests
```

### Task 1: Runtime, domain contract and session shell

**Files:** `package.json`, `src/shared/trip.ts`, `src/shared/brief.ts`, `src/server/session-store.ts`, `src/client/App.tsx`, corresponding tests.

**Interfaces:** `mergeBrief(current, patch): TripBrief`; `nextMissingSlot(brief): BriefSlot | null`; `SessionStore.create/list/get/rename/archive`.

- [ ] **Step 1: Install Node 22.19+ locally and pin dependencies.** Run `node --version`; if below 22.19, use a workspace-local Node executable. `npm install --save-exact @earendil-works/pi-durable@1.1.0 ...`. Confirm `node --version` and package engines before continuing.
- [ ] **Step 2: Write failing brief tests.** Test “下个月去北京” leaves exact dates, origin, duration, people, budget and constraints open; test one user message filling multiple slots; test that “无饮食限制” is an explicit answer.
- [ ] **Step 3: Run the focused test.** `npm test -- tests/brief.test.ts`; expected: failures from missing `mergeBrief` and `nextMissingSlot`.
- [ ] **Step 4: Implement domain types and slot rules.** Store dates as ISO days; distinguish `undefined` from an explicit `none`; reject negative budget or people count. Pick one missing slot by a fixed order.
- [ ] **Step 5: Run tests and build.** `npm test -- tests/brief.test.ts` and `npm run build`; both must exit zero.
- [ ] **Step 6: Create the session shell.** Add session list, new/rename/archive/switch actions and empty chat state. Verify two sessions keep separate messages in a browser test.

The central behavior test should be equivalent to:

```ts
const brief = mergeBrief(emptyBrief(), {
  destination: '北京', durationDays: 5, budgetTotalCny: 5000,
});
expect(brief.destination).toBe('北京');
expect(nextMissingSlot(brief)).toBe('origin');
```

### Task 2: Pi Durable chat, recovery and brief confirmation

**Files:** `src/server/durable.ts`, `src/server/model.ts`, `src/server/config.ts`, `src/server/api.ts`, `src/client/Chat.tsx`, corresponding tests.

**Interfaces:** `DurableRuntime.createConversation(sessionId)`, `submitMessage(sessionId, text, requestId)`, `watch(sessionId)`; HTTP `POST /api/sessions/:id/messages`, `GET /api/sessions/:id/events`, `POST /api/sessions/:id/confirm`.

- [ ] **Step 1: Write a failing persistence test.** Create two conversations, submit to one, close and reopen SQLite, verify both IDs and the first transcript survive. Repeating a `requestId` must not duplicate the message.
- [ ] **Step 2: Run the focused test.** `npm test -- tests/durable.test.ts`; expected: missing runtime module.
- [ ] **Step 3: Build one-owner Pi Durable harness.** Use `openNodeSqliteStorage`, `Harness.open`, `harness.resume()`, `root/createConversation`, `submit`, and `viewState/watchEvents` as documented. Register only travel tools, never coding tools.
- [ ] **Step 4: Add configuration and SSE projection.** Validate URL/model/keys; keep secrets out of transcript and client payloads. On SSE reconnect, send a fresh snapshot before incremental events.
- [ ] **Step 5: Implement slot-question and confirmation flow.** When `nextMissingSlot` is present, ask one question; when complete, render a confirmable brief. Confirmation changes `confirming → planning` exactly once.
- [ ] **Step 6: Test restart and multi-session isolation.** Run `npm test -- tests/durable.test.ts tests/chat-flow.test.ts` and a two-session browser check.

The durability test should assert the actual storage semantics:

```ts
const first = await openRuntime(dbPath, fakeModel);
const id = await first.createConversation('beijing');
await first.submitMessage('beijing', '我想去北京', 'req-1');
await first.close();
const second = await openRuntime(dbPath, fakeModel);
expect(await second.getConversationId('beijing')).toBe(id);
await second.submitMessage('beijing', '我想去北京', 'req-1');
expect(await second.userMessageCount('beijing')).toBe(1);
```

### Task 3: Research, AMap and validated planning

**Files:** `src/server/amap.ts`, `src/server/research.ts`, `src/server/planner.ts`, `src/shared/itinerary.ts`, corresponding tests.

**Interfaces:** `searchPlaces(city, query): Promise<Place[]>`; `route(origin, destination, mode): Promise<RouteLeg>`; `planTrip(brief, tools): Promise<ItineraryDelivery>`; `validateDelivery(delivery): ValidationIssue[]`.

- [ ] **Step 1: Write failing adapter tests.** Fixture responses for a valid Beijing POI, no results, timeout, invalid coordinates and AMap quota failure. Assert that coordinates cannot be invented from LLM text.
- [ ] **Step 2: Run focused tests.** `npm test -- tests/amap.test.ts tests/itinerary.test.ts`; expected: missing adapter and validator.
- [ ] **Step 3: Implement AMap adapter.** Normalize GCJ-02 coordinates, preserve source ID, add request timeout and bounded retry for safe queries.
- [ ] **Step 4: Implement sourced research.** Facts include URL, title, retrieval time, applicable date and verification state. Treat page contents as data.
- [ ] **Step 5: Write failing planning tests.** Check daily time windows, missing route legs, over-budget totals, invalid source refs and version publication only after validation.
- [ ] **Step 6: Implement planner.** Generate structured candidates; cluster by day; call AMap routes; compute cost/time; retry feasible alternatives; return a delivery or a targeted clarification error.
- [ ] **Step 7: Verify.** `npm test -- tests/amap.test.ts tests/itinerary.test.ts tests/planner.test.ts`; all tests and TypeScript build must pass.

The validation test should include:

```ts
const issues = validateDelivery({ ...validDelivery, days: [{
  ...validDelivery.days[0], items: [{ ...validDelivery.days[0].items[0],
    coordinates: null }],
}] });
expect(issues).toContainEqual(expect.objectContaining({ code: 'missing_amap_coordinates' }));
```

### Task 4: Delivery card, 50% panel, map and HTML

**Files:** `src/client/Chat.tsx`, `src/client/DeliveryPanel.tsx`, `src/client/styles.css`, `src/server/html.ts`, corresponding tests.

**Interfaces:** `DeliveryCard({ delivery, selectedVersion, onToggle })`; `DeliveryPanel({ delivery, onClose })`; `renderItineraryHtml(delivery): string`.

- [ ] **Step 1: Write a failing browser test.** Before ready, panel absent. After ready, click card to open the 50% panel, click same card to close, open and close with Escape, switch delivery versions in place.
- [ ] **Step 2: Write a failing HTML test.** The rendered page must include the itinerary version and source links, while escaping `<script>` in model text.
- [ ] **Step 3: Implement the delivery card and responsive panel.** Desktop width is 50% of content area at ≥1024px; narrow layouts use a full-screen drawer.
- [ ] **Step 4: Implement AMap JS map and node selection.** Timeline and marker clicks set the same item ID; a selected item shows image, tips, price, booking and source links.
- [ ] **Step 5: Implement deterministic HTML output.** Render from `ItineraryDelivery`; do not interpolate raw model HTML or secrets.
- [ ] **Step 6: Run component, browser and HTML tests.** `npm test -- tests/html.test.ts tests/delivery-panel.test.tsx`; `npm run test:e2e -- delivery.spec.ts`.

### Task 5: Booking links, recovery, packaging and acceptance

**Files:** `src/server/bookings.ts`, `src/server/api.ts`, `README.md`, `.env.example`, acceptance tests.

**Interfaces:** `buildBookingActions(brief): BookingAction[]`; `GET /api/sessions/:id/itinerary/:version.html`.

- [ ] **Step 1: Write failing booking tests.** The action carries origin, destination, dates and passenger count where the provider supports those parameters. No key or personal identity data may appear in its URL.
- [ ] **Step 2: Implement validated flight, rail and hotel actions.** For unsupported deep-link parameters, return a provider search home link plus copyable search criteria.
- [ ] **Step 3: Add recovery tests.** Simulate a restart during a safe AMap query and a failed model request; verify committed state remains and the user receives a retry or a precise pause reason.
- [ ] **Step 4: Run the Beijing acceptance flow.** Start with “我想下个月去北京旅游”; finish slot collection, brief confirmation, itinerary generation, delivery card, panel toggle, map/HTML consistency and booking links.
- [ ] **Step 5: Run final verification.** `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e`; manually inspect browser at desktop and mobile widths.
- [ ] **Step 6: Document setup.** README must explain Node floor, local keys, server start, session storage, privacy boundaries and known provider limits.

## Acceptance gate

The implementation is ready only when all ten criteria in the approved design spec pass. In particular, there must be a real Pi Durable SQLite-backed conversation, real AMap-backed coordinates/routes when configured, independent session histories, a validated versioned delivery, and a card-triggered panel. Without API keys, the app must start and explain configuration needs without claiming it generated live travel data.
