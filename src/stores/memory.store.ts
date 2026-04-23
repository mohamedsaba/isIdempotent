import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { IdempotencyStore } from './idempotency.store';
import { ResponseRecord } from '../interfaces/idempotency-options.interface';

interface MemoryEntry {
  data: ResponseRecord | 'IN_PROGRESS';
  expiresAt: number;
}

@Injectable()
export class MemoryStore extends IdempotencyStore implements OnModuleDestroy {
  private readonly store = new Map<string, MemoryEntry>();
  private readonly cleanupInterval: NodeJS.Timeout;
  private readonly maxKeys = 10000; // Default safety limit

  constructor() {
    super();
    // Run background cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.backgroundCleanup(), 5 * 60 * 1000);
    // Unref allows the process to exit if only the interval is remaining
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  async setInProgress(key: string, ttl: number): Promise<boolean> {
    const existing = this.store.get(key);
    
    // Lazy expiration
    if (existing && existing.expiresAt <= Date.now()) {
      this.store.delete(key);
    } else if (existing) {
      return false;
    }

    // Capacity safety check
    if (this.store.size >= this.maxKeys) {
      this.backgroundCleanup(); // Urgent cleanup
      if (this.store.size >= this.maxKeys) {
        return false; // Still full
      }
    }

    this.store.set(key, {
      data: 'IN_PROGRESS',
      expiresAt: Date.now() + ttl * 1000,
    });
    return true;
  }

  async saveResponse(
    key: string,
    response: ResponseRecord,
    ttl: number,
  ): Promise<void> {
    this.store.set(key, {
      data: response,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  async getResponse(key: string): Promise<ResponseRecord | string | null> {
    const entry = this.store.get(key);
    
    // Lazy expiration
    if (entry && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry ? entry.data : null;
  }

  async clear(key: string): Promise<void> {
    this.store.delete(key);
  }

  private backgroundCleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }
}
