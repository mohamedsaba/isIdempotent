import * as crypto from 'crypto';

/**
 * Robust hashing utility that handles circular references, Dates, RegExps, and Buffers.
 */
export class SafeHash {
  private static readonly MAX_DEPTH = 10;
  private static readonly MAX_LENGTH = 10000;

  /**
   * Generates a stable SHA-256 hash for any JS value.
   */
  static hash(val: any): string {
    const canonical = this.serialize(val, new WeakSet(), 0);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  private static serialize(val: any, visited: WeakSet<any>, depth: number): string {
    if (depth > this.MAX_DEPTH) return '[MaxDepth]';
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';

    const type = typeof val;

    if (type === 'number' || type === 'boolean') {
      return `${type}:${val}`;
    }

    if (type === 'string') {
      return val.length > this.MAX_LENGTH ? `string:${val.substring(0, this.MAX_LENGTH)}...` : `string:${val}`;
    }

    if (val instanceof Date) {
      return `date:${val.toISOString()}`;
    }

    if (val instanceof RegExp) {
      return `regexp:${val.toString()}`;
    }

    if (Buffer.isBuffer(val)) {
      return `buffer:${val.length > this.MAX_LENGTH ? val.toString('base64', 0, this.MAX_LENGTH) : val.toString('base64')}`;
    }

    if (type === 'object') {
      if (visited.has(val)) {
        return '[Circular]';
      }
      visited.add(val);

      if (Array.isArray(val)) {
        const parts = val.map((item) => this.serialize(item, visited, depth + 1));
        return `array:[${parts.join(',')}]`;
      }

      const keys = Object.keys(val).sort();
      const parts = keys.map((key) => {
        return `${key}:${this.serialize(val[key], visited, depth + 1)}`;
      });
      return `object:{${parts.join(',')}}`;
    }

    return `unknown:${String(val)}`;
  }
}
