# TripWeave Completion Implementation Plan

> **For agentic workers:** Execute inline in this session; do not dispatch subagents. Every code change follows a failing test, implementation, and fresh verification.

**Goal:** Close the approved MVP spec gaps and add recoverable per-session deletion.

**Architecture:** Keep the existing React/Fastify/Pi Durable boundary. Add a recycle-bin state in the session projection, structured sourced facts and booking actions on the versioned delivery, then strengthen planning validation and UI/HTTP tests. Do not present unknown prices or provider availability as verified.

**Tech Stack:** Node 22.19+, TypeScript, React, Fastify, Pi Durable 1.1.0, AMap Web/JS APIs, Vitest.

## Global Constraints

- Local single-user application and Chinese domestic city trips.
- No order submission, payment, or personal identity data in booking links.
- Model API and AMap Web keys stay server-side; AMap JS credentials are browser-visible.
- The `ItineraryDelivery` is the sole source for card, map, timeline, and HTML.
- Delete means move one session to a recoverable recycle bin; no automatic permanent purge.
- User-selected source policy (2026-10-09): AMap only for POI facts, coordinates, routes and available images. Ticket prices, opening hours, reservations and full budget feasibility remain unverified; do not add a web-search or pricing provider.

---

### Task 1: Recoverable single-session deletion

**Files:** `src/shared/trip.ts`, `src/server/session-store.ts`, `src/server/trip-service.ts`, `src/server/api.ts`, `src/client/App.tsx`, `src/client/styles.css`, `tests/session-store.test.ts`, `tests/api.test.ts`.

**Interface:** `SessionStore.trash(id): Promise<TripSession>`, `restore(id): Promise<TripSession>`, `listTrashed(): TripSession[]`; HTTP `DELETE /api/sessions/:id`, `GET /api/trash`, `POST /api/trash/:id/restore`.

- [ ] Write tests that show deleting one of two sessions removes it from active list, preserves its transcript and deliveries, and restoration returns it unchanged.
- [ ] Verify tests fail because trash/restore methods and endpoints are absent.
- [ ] Add `trashedAt` and `trashed` state; reject messages and planning on trashed sessions; add delete confirmation, recycle-bin view, and restore button.
- [ ] Run focused tests, typecheck and build; manually verify active selection falls back after deletion.

### Task 2: Booking actions and source-safe HTML

**Files:** `src/server/bookings.ts`, `src/shared/trip.ts`, `src/server/planner.ts`, `src/server/html.ts`, `src/client/DeliveryPanel.tsx`, tests.

**Interface:** `buildBookingActions(brief): BookingAction[]` with provider URL, label, kind, and copyable criteria.

- [ ] Write tests for flight/rail/hotel search conditions and no leaked API key or identity data; HTML test must escape condition text.
- [ ] Verify red, implement actions using stable HTTPS provider entry pages when query parameters are undocumented.
- [ ] Render actions in HTML and panel; explicitly label links as searches, not reservations.
- [ ] Run focused tests, typecheck and build.

### Task 3: Evidence and feasibility gates

**Files:** `src/server/amap.ts`, `src/server/research.ts`, `src/server/planner.ts`, `src/shared/itinerary.ts`, `src/shared/trip.ts`, tests.

**Interface:** typed `ResearchFact[]` and item references; `validateDelivery` rejects invalid route/time/budget claims.

- [ ] Write tests proving unknown ticket prices stay unverified, every mutable fact has source and retrieval time, and over-budget known costs cannot publish ready.
- [ ] Verify red, implement first-party/AMap evidence capture and strict validation without synthesizing unavailable values.
- [ ] Improve geographical clustering and fallback when a route is unreachable; keep old delivery version visible on failed revision.
- [ ] Run focused tests, typecheck and build.

### Task 4: Durable command/recovery and browser acceptance

**Files:** `src/server/durable.ts`, `src/server/trip-service.ts`, `src/server/api.ts`, `src/client/App.tsx`, browser tests, README.

**Interface:** request IDs on commands, replay-safe responses, planning progress snapshots/reconnect.

- [ ] Write failing duplicate-command and restart tests.
- [ ] Verify red, implement idempotency and resumable projection updates.
- [ ] Add browser tests for clarification, delivery toggle, multi-session isolation, deletion/restoration and mobile switch.
- [ ] Run all tests, typecheck, build and browser acceptance. Report any provider-dependent checks blocked by absent credentials.
