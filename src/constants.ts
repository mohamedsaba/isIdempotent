export const IDEMPOTENCY_OPTIONS = 'IDEMPOTENCY_OPTIONS';
export const IDEMPOTENT_METADATA_KEY = 'idempotent:idempotent';

export const DEFAULT_IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAY_HEADER = 'x-idempotency-replayed';

export const HEADER_BLACKLIST = [
  'set-cookie',
  'date',
  'request-id',
  'link',
  'x-request-id',
  'x-amzn-trace-id',
  'cf-ray',
  'x-cloud-trace-context',
  'x-b3-traceid',
  'x-b3-spanid',
  'x-b3-parentspanid',
  'x-b3-sampled',
  'x-b3-flags',
];
