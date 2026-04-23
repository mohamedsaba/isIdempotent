# NestJS Idempotency

A production-grade idempotency library for NestJS. This package provides a declarative way to handle duplicate requests in distributed systems, ensuring that non-idempotent operations (like payments or order creation) are only executed once.

## Features

- **Distributed Locking**: Uses Redis with atomic operations (Lua scripts) to prevent race conditions across multiple server instances.
- **Request Fingerprinting**: Automatically generates a unique hash of the request body to prevent key collisions when the same idempotency key is used with different data.
- **Pluggable Storage**: Includes a high-performance in-memory store for local development and a Redis store for production.
- **Safety Limits**: Built-in protection against storage exhaustion with configurable body size limits and status code filtering.
- **Observability**: Standardized logging for cache hits, conflicts, and storage health.
- **Tenant Isolation**: Optional namespacing to keep idempotency keys unique across different users or tenants.

## Installation

```bash
npm install @nestjs-idempotency/core ioredis
```

## Quick Start

### 1. Register the Module

```typescript
import { IdempotencyModule } from '@nestjs-idempotency/core';
import { Redis } from 'ioredis';

@Module({
  imports: [
    IdempotencyModule.forRoot({
      store: {
        provide: IdempotencyStore,
        useFactory: (redis: Redis) => new RedisStore(redis),
        inject: ['REDIS_CLIENT'],
      },
      ttl: 86400, // Cache for 24 hours
    }),
  ],
})
export class AppModule {}
```

### 2. Protect Routes

Add the `@Idempotent()` decorator to any controller method that requires idempotency protection.

```typescript
import { Idempotent } from '@nestjs-idempotency/core';

@Controller('orders')
export class OrderController {
  @Post()
  @Idempotent()
  async createOrder(@Body() dto: CreateOrderDto) {
    // This logic will only run once per Idempotency-Key
    return this.orderService.create(dto);
  }
}
```

## Configuration

| Option | Description | Default |
| :--- | :--- | :--- |
| `headerName` | Header to read the key from | `idempotency-key` |
| `ttl` | Expiration time in seconds | `86400` |
| `lockTtl` | How long to hold the 'in-progress' lock | `60` |
| `maxBodySize` | Maximum response size to cache (bytes) | `undefined` |
| `cacheableStatuses` | HTTP statuses that should be cached | `[200, 201, 202, 204]` |
| `storageFailureStrategy` | What to do if Redis is down (`fail-open` or `fail-closed`) | `fail-closed` |

## How it Works

1. **Check**: When a request arrives, the interceptor checks if the idempotency key exists in the store.
2. **Replay**: If a completed response is found, it is immediately replayed to the client with an `x-idempotency-replayed` header.
3. **Lock**: If no response is found, it attempts to acquire an atomic `IN_PROGRESS` lock. If another request is already processing the same key, it returns a `409 Conflict`.
4. **Execute**: The controller logic runs.
5. **Save**: The response is hashed and saved to the store, and the lock is released.

## License

MIT
