import { describe, expect, it } from "vitest";

import {
  TASK_LIST_SCHEMA_VERSION,
  TASK_LIST_STAGES,
  TaskListPipeline,
  type ModuleLoggerPort,
} from "../../index";

describe("TaskListPipeline", () => {
  it("emits logger stage events on apply", () => {
    const stages: string[] = [];
    const log: ModuleLoggerPort = {
      stage(event) {
        stages.push(event.stage);
      },
    };
    const result = new TaskListPipeline({ log }).apply({
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "agent",
      operation: {
        type: "replace",
        items: [
          {
            id: "inspect-login",
            title: "Inspect src/LoginForm.tsx",
            status: "active",
          },
        ],
      },
    });
    expect(result.status).toBe("applied");
    expect(stages).toEqual([TASK_LIST_STAGES.apply]);
  });

  it("emits logger stage events on createDiscoveryList", () => {
    const stages: string[] = [];
    const log: ModuleLoggerPort = {
      stage(event) {
        stages.push(event.stage);
      },
    };
    const list = new TaskListPipeline({ log }).createDiscoveryList();
    expect(list.purpose).toBe("discovery");
    expect(stages).toEqual([TASK_LIST_STAGES.createDiscovery]);
  });
});
