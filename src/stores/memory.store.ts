import { Injectable, OnModuleDestroy, Optional, Inject } from '@nestjs/common';
import { IdempotencyStore } from './idempotency.store';
import { ResponseRecord } from '../interfaces/idempotency-options.interface';

interface MemoryEntry {
  data: ResponseRecord | string; // ResponseRecord or Fencing Token
  expiresAt: number;
}

@Injectable()
export class MemoryStore extends IdempotencyStore implements OnModuleDestroy {
  private readonly store = new Map<string, MemoryEntry>();
  private readonly cleanupInterval: NodeJS.Timeout;
  private readonly maxKeys: number;

  /**
   * Creates a MemoryStore instance.
   * Use the static `withMaxKeys()` factory when registering as a custom provider
   * to configure the capacity limit.
   */
  constructor(@Optional() @Inject('MEMORY_STORE_MAX_KEYS') maxKeys: number = 10_000) {
    super();
    this.maxKeys = maxKeys;
    this.cleanupInterval = setInterval(() => this.backgroundCleanup(), 5 * 60 * 1000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Returns a NestJS provider definition that creates a MemoryStore
   * with a custom capacity limit.
   *
   * @example
   * // In your module:
   * store: MemoryStore.withMaxKeys(50_000)
   */
  static withMaxKeys(maxKeys: number): { provide: typeof IdempotencyStore; useFactory: () => MemoryStore } {
    return {
      provide: IdempotencyStore,
      useFactory: () => new MemoryStore(maxKeys),
    };
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  async setInProgress(
    key: string,
    ttl: number,
    token: string,
    fingerprint: string,
  ): Promise<boolean> {
    const existing = this.store.get(key);

    if (existing && existing.expiresAt <= Date.now()) {
      this.store.delete(key);
    } else if (existing) {
      // LRU: Refresh position on access attempt (even if failed)
      this.store.delete(key);
      this.store.set(key, existing);
      return false;
    }

    if (this.store.size >= this.maxKeys) {
      this.performEviction();
      // If still full, evict the oldest (first key in Map)
      if (this.store.size >= this.maxKeys) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey) this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      data: `TOK:${token}:${fingerprint}`,
      expiresAt: Date.now() + ttl * 1000,
    });
    return true;
  }

  async saveResponse(
    key: string,
    response: ResponseRecord,
    ttl: number,
    token: string,
  ): Promise<void> {
    const existing = this.store.get(key);

    if (
      existing &&
      typeof existing.data === 'string' &&
      existing.data.startsWith(`TOK:${token}:`)
    ) {
      // Deep clone to ensure immutability
      const clonedResponse = JSON.parse(JSON.stringify(response));
      this.store.set(key, {
        data: clonedResponse,
        expiresAt: Date.now() + ttl * 1000,
      });
    }
  }

  async getResponse(key: string): Promise<ResponseRecord | { token: string; fingerprint: string } | null> {
    const entry = this.store.get(key);

    if (entry && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    if (!entry) return null;

    // LRU: Move to end on access
    this.store.delete(key);
    this.store.set(key, entry);

    if (typeof entry.data === 'string' && entry.data.startsWith('TOK:')) {
      const parts = entry.data.split(':');
      return {
        token: parts[1],
        fingerprint: parts[2],
      };
    }

    // Deep clone on retrieval to prevent downstream mutation affecting cache
    return JSON.parse(JSON.stringify(entry.data));
  }

  async clear(key: string, token?: string): Promise<void> {
    const existing = this.store.get(key);
    if (!existing) return;

    if (!token || (typeof existing.data === 'string' && existing.data.startsWith(`TOK:${token}:`))) {
      this.store.delete(key);
    }
  }

  private backgroundCleanup() {
    this.performEviction();
  }

  private performEviction() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }
}
