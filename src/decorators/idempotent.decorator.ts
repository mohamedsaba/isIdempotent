import { SetMetadata } from '@nestjs/common';
import { IDEMPOTENT_METADATA_KEY } from '../constants';
import { IdempotencyOptions } from '../interfaces/idempotency-options.interface';

/**
 * Marks a route as idempotent.
 * Requires an idempotency key to be provided in the request headers (or via custom extractor).
 */
export const Idempotent = (options: IdempotencyOptions = {}) =>
  SetMetadata(IDEMPOTENT_METADATA_KEY, options);
