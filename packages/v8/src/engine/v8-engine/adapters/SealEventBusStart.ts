import { AgentEngineError } from "../contracts";
import type { MitiiAgentEngine } from "./composeAgentEngine";

/**
 * Product hard-delete of event-bus start/resume: restore stays; start/resume throw.
 * Direct `new V8EnginePipeline` remains for internal goldens only.
 */
export function sealEventBusStart(engine: MitiiAgentEngine): MitiiAgentEngine {
  return {
    start() {
      throw new AgentEngineError(
        "misconfigured_ports",
        "event_bus_start_deleted: use composeAgentEngine().engine (runtime shell).",
        { reasonCode: "event_bus_start_deleted" },
      );
    },
    resume() {
      throw new AgentEngineError(
        "misconfigured_ports",
        "event_bus_resume_deleted: use composeAgentEngine().engine (runtime shell).",
        { reasonCode: "event_bus_resume_deleted" },
      );
    },
    restore: (input) => engine.restore(input),
    listRestorePoints: (runId) => engine.listRestorePoints(runId),
  };
}
