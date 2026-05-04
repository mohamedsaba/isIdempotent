import { ResponseRecord } from '../interfaces/idempotency-options.interface';

export interface InProgressRecord {
  token: string;
  fingerprint: string;
}

export abstract class IdempotencyStore {
  /**
   * Attempts to set an in-progress lock for the given key.
   * @param key The idempotency key
   * @param ttl Time-to-live in seconds
   * @param token The fencing token (unique for this request)
   * @param fingerprint The request fingerprint to detect collisions early
   * @returns true if the lock was acquired, false otherwise.
   */
  abstract setInProgress(
    key: string,
    ttl: number,
    token: string,
    fingerprint: string,
  ): Promise<boolean>;

  /**
   * Saves the final response record to the store.
   * @param key The idempotency key
   * @param response The response record to save
   * @param ttl Time-to-live in seconds
   * @param token The fencing token to verify ownership
   */
  abstract saveResponse(
    key: string,
    response: ResponseRecord,
    ttl: number,
    token: string,
  ): Promise<void>;

  /**
   * Retrieves the cached response record for the given key.
   * Returns ResponseRecord, an InProgressRecord, or null.
   */
  abstract getResponse(key: string): Promise<ResponseRecord | InProgressRecord | null>;

  /**
   * Clears the entry for the given key.
   * @param key The idempotency key
   * @param token Optional fencing token. If provided, only clears if the token matches.
   */
  abstract clear(key: string, token?: string): Promise<void>;
}
