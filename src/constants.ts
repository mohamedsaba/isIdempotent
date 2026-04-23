export const IDEMPOTENCY_OPTIONS = 'IDEMPOTENCY_OPTIONS';
export const IDEMPOTENT_METADATA_KEY = 'nestjs-idempotency:idempotent';

export const DEFAULT_IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAY_HEADER = 'x-idempotency-replayed';

export const HEADER_BLACKLIST = [
  'set-cookie',
  'date',
  'request-id',
  'link',
  'x-request-id',
];
