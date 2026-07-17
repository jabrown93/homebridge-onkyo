/**
 Minimal ambient types for the untyped 'polling-to-event' package.
 See node_modules/polling-to-event/index.js for the real (JS) implementation.
 */
declare module 'polling-to-event' {
  import type { EventEmitter } from 'node:events';

  type PollingToEventOptions = {
    interval?: number;
    eventName?: string;
    longpollEventName?: string;
    longpolling?: boolean;
  };

  type PollingToEventEmitter = EventEmitter & {
    pause(): void;
    resume(): void;
    clear(): void;
  };

  type PollDone = (error: unknown, ...parameters: unknown[]) => void;
  type PollFunction = (done: PollDone) => void;

  function pollingToEvent(
    func: PollFunction,
    options?: PollingToEventOptions
  ): PollingToEventEmitter;

  export default pollingToEvent;
}
