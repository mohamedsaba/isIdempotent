# Changelog

All notable changes to `@mohamedsaba/idempotent` are documented in this file.

This project follows [Semantic Versioning](https://semver.org/) and the format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.1.1] – 2026-05-04

### Fixed
- **Bug:** `IdempotencyInterceptor` was instantiated **twice** inside `IdempotencyModule` — once as a named provider and once via `APP_INTERCEPTOR` with `useClass`. Changed `APP_INTERCEPTOR` to `useExisting` so both references share a single DI-managed instance.
- **Bug:** `IdempotencyEventEmitter` and `IdempotencyEvent` types were not exported from the public `index.ts` API surface. Consumers subscribing to the observability stream had to import from internal paths.
- **Bug:** `jest.config.js` `collectCoverageFrom` glob `**/*.(t|j)s` was anchored to the project root, causing Jest to crawl `node_modules` and `dist` directories during coverage collection. Corrected to `src/**/*.(t|j)s`.
- **Bug:** Redis `saveResponse` Lua script passed TTL as a raw argument without explicit `tonumber()` cast. Added `tonumber(ARGV[2])` to guarantee correct integer semantics in all Redis cluster configurations.

### Improved
- **Type Safety:** Enabled `strictNullChecks`, `strictBindCallApply`, `forceConsistentCasingInFileNames`, and `noFallthroughCasesInSwitch` in `tsconfig.json`.
- **Type Safety:** `getResponse()` return type in both `MemoryStore` and `RedisStore` changed from `Promise<ResponseRecord | any | null>` to the precise union `Promise<ResponseRecord | { token: string; fingerprint: string } | null>`, matching the abstract contract.
- **Configurability:** `MemoryStore` `maxKeys` limit is now configurable. Pass a custom limit via the new `MemoryStore.withMaxKeys(n)` static factory provider helper.
- **ESLint:** Added `eslint.config.mjs` (ESLint 9 flat config) so `npm run lint` now works out of the box.

---

## [1.1.0] – 2026-05-03

### Added
- **Fencing Tokens:** Each request now generates a unique UUID token stored alongside the lock. `saveResponse` and `clear` verify token ownership before mutating state, preventing lock-hijacking in high-concurrency or slow-request scenarios.
- **Robust Fingerprinting:** Replaced the custom `deepSort` implementation (which crashed on circular references and lacked Date/Buffer support) with `SafeHash` — a cycle-safe, type-aware SHA-256 hashing utility.
- **LRU Eviction for MemoryStore:** The in-memory store now implements Least Recently Used eviction capped at 10,000 keys, preventing unbounded memory growth.
- **Observability Events:** `IdempotencyEventEmitter` exposes an RxJS `events$` observable stream with typed `cache_hit`, `cache_miss`, `collision`, `lock_acquired`, `store_error`, and `request_too_large` events.
- **Stream Detection:** Automatic detection of `StreamableFile`, `Buffer`, and Node.js stream responses — these are bypassed without caching to prevent data corruption.
- **Key Isolation:** `enforceKeyIsolation` option (default `true`) namespaces idempotency keys by HTTP method and path, preventing cross-endpoint key collisions.
- **Tenant Namespacing:** `tenantExtractor` option and robust key format `idempotency:t:{tenant}:k:{key}` to prevent tenant/key concatenation collisions.
- **Vary Header Injection:** Replayed responses now correctly set the `Vary` header to include the idempotency header name, enabling correct cache behaviour in downstream proxies.

### Fixed
- **Race Condition:** Lock cleanup on request failure now uses RxJS `from()` pipeline instead of a floating `.catch(() => {})` promise, ensuring the `DEL` command reaches the store before a racing retry can acquire the lock.
- **Stream Corruption:** Replaced synchronous body serialization in the critical path with a size check guard that is skipped for streams and buffers.

---

## [1.0.0] – 2026-04-28

### Added
- Initial public release of `@mohamedsaba/idempotent`.
- `IdempotencyModule.forRoot()` and `forRootAsync()` dynamic module registration.
- `@Idempotent()` route decorator.
- `MemoryStore` for local development.
- `RedisStore` with atomic Lua scripts for production use.
- Configurable TTL, lock TTL, header name, and `storageFailureStrategy`.
