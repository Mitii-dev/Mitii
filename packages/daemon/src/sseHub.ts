import type { ServerResponse } from 'http';
import type { MitiiEvent } from '../../../src/adapters/node/events';

export interface BufferedSseEvent {
  id: number;
  event: string;
  data: MitiiEvent;
  at: number;
}

interface Subscriber {
  res: ServerResponse;
}

export class SseHub {
  private readonly buffers = new Map<string, BufferedSseEvent[]>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private nextId = 1;

  constructor(private readonly maxEvents = 500) {}

  publish(sessionId: string, event: MitiiEvent): BufferedSseEvent {
    const framed: BufferedSseEvent = {
      id: this.nextId++,
      event: event.type,
      data: event,
      at: Date.now(),
    };
    const buffer = [...(this.buffers.get(sessionId) ?? []), framed].slice(-this.maxEvents);
    this.buffers.set(sessionId, buffer);
    for (const subscriber of this.subscribers.get(sessionId) ?? []) {
      writeFrame(subscriber.res, framed);
    }
    return framed;
  }

  subscribe(sessionId: string, res: ServerResponse, lastEventId?: number): () => void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');

    for (const event of this.replay(sessionId, lastEventId)) {
      writeFrame(res, event);
    }

    const subscriber: Subscriber = { res };
    const set = this.subscribers.get(sessionId) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(sessionId, set);

    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(sessionId);
      res.end();
    };
  }

  replay(sessionId: string, lastEventId?: number): BufferedSseEvent[] {
    const buffer = this.buffers.get(sessionId) ?? [];
    if (!lastEventId || Number.isNaN(lastEventId)) return buffer;
    return buffer.filter((event) => event.id > lastEventId);
  }

  clear(sessionId: string): void {
    this.buffers.delete(sessionId);
    for (const subscriber of this.subscribers.get(sessionId) ?? []) {
      subscriber.res.end();
    }
    this.subscribers.delete(sessionId);
  }
}

function writeFrame(res: ServerResponse, event: BufferedSseEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.event}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}
