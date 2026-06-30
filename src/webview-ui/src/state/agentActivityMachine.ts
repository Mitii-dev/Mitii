import { createMachine } from 'xstate';

export type ActivityPhase = 'idle' | 'working' | 'waiting' | 'complete' | 'error';

type ActivityEvent =
  | { type: 'START' }
  | { type: 'WAIT' }
  | { type: 'DONE' }
  | { type: 'FAIL' }
  | { type: 'RESET' };

export const agentActivityMachine = createMachine({
  id: 'agentActivity',
  initial: 'idle' as ActivityPhase,
  states: {
    idle: {
      on: {
        START: 'working',
        WAIT: 'waiting',
        DONE: 'complete',
        FAIL: 'error',
      },
    },
    working: {
      on: {
        WAIT: 'waiting',
        DONE: 'complete',
        FAIL: 'error',
        RESET: 'idle',
      },
    },
    waiting: {
      on: {
        START: 'working',
        DONE: 'complete',
        FAIL: 'error',
        RESET: 'idle',
      },
    },
    complete: {
      on: {
        START: 'working',
        WAIT: 'waiting',
        RESET: 'idle',
      },
    },
    error: {
      on: {
        START: 'working',
        RESET: 'idle',
      },
    },
  },
});

export type { ActivityEvent };
