import {
  z,
} from "zod";

import {
  AGENT_MODES,
} from "./constants";

export const agentModeSchema =
  z.enum(
    AGENT_MODES,
  );
