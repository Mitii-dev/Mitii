export interface TelemetryEvent {
  type: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface TelemetryEventSink {
  append(event: TelemetryEvent): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface TelemetryEventSinkContribution {
  id: string;
  owner: string;
  create(): TelemetryEventSink;
}
