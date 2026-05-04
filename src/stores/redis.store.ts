import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { IdempotencyStore } from './idempotency.store';
import { ResponseRecord } from '../interfaces/idempotency-options.interface';

@Injectable()
export class RedisStore extends IdempotencyStore {
  constructor(private readonly redis: Redis) {
    super();
  }

  async setInProgress(
    key: string,
    ttl: number,
    token: string,
    fingerprint: string,
  ): Promise<boolean> {
    const result = await this.redis.set(key, `TOK:${token}:${fingerprint}`, 'EX', ttl, 'NX');
    return result === 'OK';
  }

  async saveResponse(
    key: string,
    response: ResponseRecord,
    ttl: number,
    token: string,
  ): Promise<void> {
    const serialized = JSON.stringify(response);

    /**
     * Lua script: Only save the response if the current value matches the fencing token pattern.
     * KEYS[1]: key
     * ARGV[1]: serialized response with REC: prefix
     * ARGV[2]: ttl
     * ARGV[3]: fencing token pattern (TOK:token:*)
     */
    const script = `
      local current = redis.call("GET", KEYS[1])
      if current and string.find(current, ARGV[3]) == 1 then
        return redis.call("SET", KEYS[1], ARGV[1], "EX", tonumber(ARGV[2]))
      end
      return nil
    `;

    await this.redis.eval(script, 1, key, `REC:${serialized}`, ttl, `TOK:${token}:`);
  }

  async getResponse(key: string): Promise<ResponseRecord | { token: string; fingerprint: string } | null> {
    const result = await this.redis.get(key);
    if (!result) return null;

    if (result.startsWith('TOK:')) {
      const parts = result.split(':');
      return {
        token: parts[1],
        fingerprint: parts[2],
      };
    }

    if (result.startsWith('REC:')) {
      try {
        return JSON.parse(result.substring(4)) as ResponseRecord;
      } catch {
        return null;
      }
    }

    return null;
  }

  async clear(key: string, token?: string): Promise<void> {
    if (!token) {
      await this.redis.del(key);
      return;
    }

    /**
     * Lua script: Only delete if the current value matches the token pattern.
     */
    const script = `
      local current = redis.call("GET", KEYS[1])
      if current and string.find(current, ARGV[1]) == 1 then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `;
    await this.redis.eval(script, 1, key, `TOK:${token}:`);
  }
}
