import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { IdempotencyStore } from './idempotency.store';
import { ResponseRecord } from '../interfaces/idempotency-options.interface';

@Injectable()
export class RedisStore extends IdempotencyStore {
  constructor(private readonly redis: Redis) {
    super();
  }

  async setInProgress(key: string, ttl: number): Promise<boolean> {
    const result = await this.redis.set(key, 'IN_PROGRESS', 'EX', ttl, 'NX');
    return result === 'OK';
  }

  async saveResponse(
    key: string,
    response: ResponseRecord,
    ttl: number,
  ): Promise<void> {
    const serialized = JSON.stringify(response);

    // Lua script: Only save the response if the current value is 'IN_PROGRESS'
    // This prevents overwriting if a concurrent request already finished or if the lock expired.
    const script = `
      local current = redis.call("GET", KEYS[1])
      if current == "IN_PROGRESS" or not current then
        return redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
      end
      return nil
    `;

    await this.redis.eval(script, 1, key, serialized, ttl);
  }

  async getResponse(key: string): Promise<ResponseRecord | string | null> {
    const result = await this.redis.get(key);
    if (!result) return null;

    if (result === 'IN_PROGRESS') return 'IN_PROGRESS';

    try {
      return JSON.parse(result) as ResponseRecord;
    } catch {
      return null;
    }
  }

  async clear(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
