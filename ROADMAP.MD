# Roadmap: `@mohamedsaba/idempotent`

**Vision:** Become the standard idempotency primitive for the NestJS ecosystem — the library every backend engineer reaches for before writing their first retry handler.

---

## Current State (v1.1.1 — "The Rock-Solid Foundation")

The library is production-ready. Core primitives are bulletproof:

- ✅ Fencing tokens for lock-hijacking prevention
- ✅ Cycle-safe request fingerprinting
- ✅ LRU eviction for MemoryStore
- ✅ Typed observability event stream
- ✅ Strict TypeScript compiler settings
- ✅ Atomic Lua scripts in Redis (no race conditions)
- ✅ 26 passing tests across 4 test suites

---

## Version 1.2.0 · "Enterprise Storage" 

**Target:** Q3 2026  
**Theme:** Expand the addressable market by removing the Redis dependency requirement.

### Features

#### 1. PostgreSQL Adapter (`@mohamedsaba/idempotent-postgres`)
```typescript
import { PostgresStore } from '@mohamedsaba/idempotent-postgres';

IdempotencyModule.forRoot({
  store: {
    provide: IdempotencyStore,
    useFactory: (prisma: PrismaClient) => new PostgresStore(prisma),
    inject: [PrismaClient],
  },
});
```
- Implements `SELECT ... FOR UPDATE SKIP LOCKED` for atomic lock acquisition
- No Redis cluster to manage — ideal for teams already on Postgres
- Compatible with Prisma, TypeORM, and raw `pg`

#### 2. MongoDB Adapter (`@mohamedsaba/idempotent-mongo`)
```typescript
import { MongoStore } from '@mohamedsaba/idempotent-mongo';
```
- Uses MongoDB's `findOneAndUpdate` with `$setOnInsert` for atomic locking
- TTL index for automatic expiration (no cron jobs needed)
- Compatible with Mongoose and the native MongoDB driver

#### 3. OpenTelemetry Integration
```typescript
IdempotencyModule.forRoot({
  telemetry: true, // Automatic span creation
});
```
- Automatic spans for `cache_hit`, `lock_acquired`, `cache_miss`
- Attributes: `idempotency.key`, `idempotency.ttl_remaining_ms`, `idempotency.replayed`
- Works with Datadog, Grafana Tempo, Jaeger, and AWS X-Ray out of the box

#### 4. Custom Conflict Resolvers
```typescript
@Idempotent({
  onConflict: async (req, inProgressRecord) => ({
    statusCode: 202,
    body: { status: 'processing', requestId: inProgressRecord.token },
  }),
})
```
- Instead of a hard `409 Conflict`, return a custom "still processing" response
- Enables polling patterns where clients can check back

### Marketing Strategy for v1.2.0

**Narrative:** "Idempotency without Redis — bring your own database."

| Channel | Action |
|:---|:---|
| **Product Hunt** | Launch on a Tuesday at 00:01 PST. Headline: *"Stop processing duplicate payments. Works with Postgres, MongoDB, and Redis."* |
| **Blog (DEV.to + Medium)** | Article: *"Why you don't need Redis for idempotency (and what you actually need instead)"* |
| **YouTube** | 5-minute tutorial: *"Zero-duplicate payments in NestJS with Postgres — no Redis required"* |
| **GitHub** | Submit to `awesome-nestjs` repo under Distributed Systems |
| **Twitter/X** | Carbon.sh code snippet: before/after of a payment controller |
| **Tagline** | *"Enterprise-grade idempotency. Bring your own database."* |

---

## Version 1.3.0 · "Webhook Native" 

**Target:** Q4 2026  
**Theme:** Become the definitive solution for handling third-party webhooks (Stripe, GitHub, Shopify, Svix).

### Features

#### 1. Webhook Guard (`@WebhookIdempotent`)
```typescript
@Post('stripe/webhook')
@WebhookIdempotent({
  signatureHeader: 'stripe-signature',
  secret: process.env.STRIPE_WEBHOOK_SECRET,
  provider: 'stripe', // 'stripe' | 'github' | 'shopify' | 'svix' | 'generic-hmac'
})
async handleStripeEvent(@Body() event: Stripe.Event) {
  // Idempotency + signature verification in one decorator
}
```
- Combines cryptographic signature verification with idempotency in a single decorator
- Prevents both replay attacks and duplicate deliveries simultaneously
- Built-in providers for Stripe, GitHub, and Shopify

#### 2. Dynamic TTL by Response
```typescript
@Idempotent({
  ttlByStatus: {
    200: 86400,  // Cache successes for 24h
    201: 86400,
    400: 3600,   // Cache client errors for 1h (not forever)
    409: 300,    // Cache conflicts for 5 minutes
  },
})
```

#### 3. Edge Runtime Compatibility
- Verify and support Cloudflare Workers, Vercel Edge, and AWS Lambda@Edge
- Ship a separate `@mohamedsaba/idempotent-edge` package using the Web Fetch API
- D1 (Cloudflare KV + SQLite) adapter for fully edge-native deployments

#### 4. Idempotency Key Validation
```typescript
@Idempotent({
  keyValidator: (key) => /^[0-9a-f-]{36}$/.test(key), // UUID only
  keyValidationError: 'Idempotency-Key must be a valid UUID v4.',
})
```

### Marketing Strategy for v1.3.0

**Narrative:** "The only correct way to handle Stripe Webhooks in NestJS."

| Channel | Action |
|:---|:---|
| **Documentation** | Dedicated recipe page: *"Stripe Webhook Integration"* with complete code sample |
| **Stripe Community** | Post in Stripe Developer Discord and the official Stripe GitHub discussion board |
| **Twitter/X** | Thread: *"3 ways duplicate webhooks silently corrupt your database (and one library that stops all of them)"* |
| **Partnership** | Reach out to Svix for co-marketing: they handle delivery, we handle idempotency |
| **Newsletter** | Submit to Bytes (bytes.dev) and This Week in NestJS |
| **Tagline** | *"Never process a webhook twice. Built for the Edge."* |

---

## Version 2.0.0 · "The Protocol" 

**Target:** 2027  
**Theme:** Graduate from a NestJS utility to a framework-agnostic TypeScript standard.

### Features

#### 1. Framework Adapters (Beyond NestJS)
```typescript
// Express
app.use(idempotencyMiddleware({ store: redisStore }));

// Fastify
fastify.register(fastifyIdempotency, { store: redisStore });

// Hono (Edge)
app.use('*', idempotency({ store: kvStore }));
```

#### 2. Distributed Tracing Integration
- First-class `@opentelemetry/api` span propagation
- Idempotency context propagated through distributed trace headers

#### 3. Idempotency Dashboard (OSS)
- Lightweight web UI for visualizing cache hits, key collision rates, lock wait times
- Ships as a separate package: `@mohamedsaba/idempotent-dashboard`
- Built on React + Recharts, embeds in any Express/Fastify app

#### 4. Formal Specification
- Publish an RFC-style document defining the idempotency protocol for HTTP APIs
- Aiming for compatibility with the Stripe and Adyen idempotency specifications

### Marketing Strategy for v2.0.0

**Narrative:** "The idempotency standard for TypeScript APIs."

| Channel | Action |
|:---|:---|
| **Conference Talks** | Submit to NestConf, Node.js Interactive, and JSNation with a live-coded race condition demo |
| **Enterprise Outreach** | Publish a white paper: *"Idempotency in Financial Systems: A Practitioner's Guide"* |
| **OSS Sponsorship** | Apply to GitHub Sponsors and Open Collective to fund the dashboard and documentation |
| **Tagline** | *"The idempotency standard for TypeScript APIs."* |

---

## Non-Versioned Continuous Work

These items are ongoing regardless of version milestone:

| Item | Priority | Notes |
|:---|:---|:---|
| Update `Architecture.MD` to match current method signatures | High | N-01 from FLAWS.md |
| Archive or replace `PROJECT_ANALYSIS.md` | Medium | N-02 from FLAWS.md |
| Expand README config table with all options | High | N-03 from FLAWS.md |
| Add integration test with real Redis (testcontainers) | High | Currently mocked only |
| Add `test:e2e` script with full NestJS app bootstrap | Medium | True end-to-end coverage |
| Add `CONTRIBUTING.md` | Low | Community health |
| Add GitHub Actions CI workflow | High | Auto-test on PR + auto-publish on tag |
| Publish to `awesome-nestjs` | Medium | Community discovery |

---

## Version Summary

| Version | Theme | ETA | Key Feature |
|:---|:---|:---|:---|
| **1.1.1** | Rock-Solid Foundation | ✅ Done | All audit fixes applied |
| **1.2.0** | Enterprise Storage | Q3 2026 | Postgres + MongoDB + OpenTelemetry |
| **1.3.0** | Webhook Native | Q4 2026 | Webhook Guard + Edge compatibility |
| **2.0.0** | The Protocol | 2027 | Framework-agnostic, OSS Dashboard |
