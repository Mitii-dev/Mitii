# Interaction Mode

This module owns one contract: the interaction boundary selected by the user.

```text
Input:  "ask" | "plan" | "agent"
Output: validated AgentMode
```

It does not classify task intent or authorize tools. Those decisions belong to
intent and Engine policy respectively.
