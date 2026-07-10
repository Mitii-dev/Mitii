import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository } from './analytics.repository';

/** Wires the Analytics controller/service/repository together for the app module. */
export class AnalyticsModule {
  readonly repository = new AnalyticsRepository();
  readonly service = new AnalyticsService(this.repository);
  readonly controller = new AnalyticsController(this.service);
}
