import { ResponseRecord } from '../interfaces/idempotency-options.interface';

export abstract class IdempotencyStore {
  /**
   * Attempts to set an 'IN_PROGRESS' lock for the given key.
   * Returns true if the lock was acquired, false otherwise.
   */
  abstract setInProgress(key: string, ttl: number): Promise<boolean>;

  /**
   * Saves the final response record to the store.
   */
  abstract saveResponse(
    key: string,
    response: ResponseRecord,
    ttl: number,
  ): Promise<void>;

  /**
   * Retrieves the cached response record for the given key.
   */
  abstract getResponse(key: string): Promise<ResponseRecord | string | null>;

  /**
   * Clears the entry for the given key (e.g., on execution failure).
   */
  abstract clear(key: string): Promise<void>;
}
