import { AnalyticsService } from './analytics.service';
import type { TrackEventDto } from './dto/track-event.dto';

/** HTTP entry points for the Analytics module, mounted at /analytics. */
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  async create(req: { body: TrackEventDto }) {
    return this.analyticsService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.analyticsService.findById(req.params.id);
  }

  async findAll() {
    return this.analyticsService.list();
  }

  async computeDailyActiveUsersRoute(req: { params: { id?: string }; body: unknown }) {
    return this.analyticsService.computeDailyActiveUsers(req.params.id as string, req.body as never);
  }

  async computeConversionFunnelRoute(req: { params: { id?: string }; body: unknown }) {
    return this.analyticsService.computeConversionFunnel(req.params.id as string, req.body as never);
  }
}
