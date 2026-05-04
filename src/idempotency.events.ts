import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export type IdempotencyEvent =
  | { type: 'cache_hit'; key: string }
  | { type: 'cache_miss'; key: string }
  | { type: 'collision'; key: string; message: string }
  | { type: 'lock_acquired'; key: string }
  | { type: 'store_error'; key: string; error: string }
  | { type: 'request_too_large'; key: string; size: number };

@Injectable()
export class IdempotencyEventEmitter {
  private readonly eventSubject = new Subject<IdempotencyEvent>();

  /**
   * Observable stream of all idempotency events.
   */
  readonly events$ = this.eventSubject.asObservable();

  /**
   * Internal method to emit events.
   */
  emit(event: IdempotencyEvent) {
    this.eventSubject.next(event);
  }
}
