export interface IdempotencyOptions {
  /**
   * The name of the HTTP header containing the idempotency key.
   * @default 'idempotency-key'
   */
  headerName?: string;

  /**
   * Time-to-live for the cached response in seconds.
   * @default 86400 (24 hours)
   */
  ttl?: number;

  /**
   * Time-to-live for the in-progress lock in seconds.
   * @default 60
   */
  lockTtl?: number;

  /**
   * Strategy when the storage backend is unavailable.
   * 'fail-closed': Reject with 503 (Default)
   * 'fail-open': Proceed without idempotency protection
   */
  storageFailureStrategy?: 'fail-closed' | 'fail-open';

  /**
   * Optional function to extract the idempotency key from the request.
   * If provided, this takes precedence over the header-based key.
   */
  keyExtractor?: (req: any) => string | Promise<string>;

  /**
   * Optional function to extract the tenant/user ID from the request.
   * Used for namespacing the idempotency key.
   */
  tenantExtractor?: (req: any) => string | Promise<string>;

  /**
   * Value for the 'Retry-After' header in 409 Conflict responses.
   * @default 10
   */
  retryAfter?: number;

  /**
   * Maximum size of the response body to cache in bytes.
   * If exceeded, the response is not cached.
   * @default undefined (no limit)
   */
  maxBodySize?: number;

  /**
   * List of HTTP status codes that are allowed to be cached.
   * @default [200, 201, 202, 204]
   */
  cacheableStatuses?: number[];
}

export interface ResponseRecord {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: any;
  fingerprint: string;
}
