import type { TelemetryEventSinkContribution } from '../../interfaces/telemetry';
import { ContributionRegistry } from './ContributionRegistry';

export class EventSinkRegistry {
  private readonly registry = new ContributionRegistry<TelemetryEventSinkContribution>('EventSinkRegistry');

  register(contribution: TelemetryEventSinkContribution): void {
    this.registry.register(contribution);
  }

  get(id: string): TelemetryEventSinkContribution | undefined {
    return this.registry.get(id);
  }

  list(): readonly TelemetryEventSinkContribution[] {
    return this.registry.list();
  }

  freeze(): void {
    this.registry.freeze();
  }
}
