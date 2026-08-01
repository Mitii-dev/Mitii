import { AnalyticsRepository } from './analytics.repository';
import type { TrackEventDto } from './dto/track-event.dto';
import type { ReportQueryDto } from './dto/report-query.dto';

export interface AnalyticsEvent {
  id: string;
  userId: string;
  eventName: string;
  properties: string;
}

export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}

  async create(dto: TrackEventDto): Promise<AnalyticsEvent> {
    return this.repository.insert(dto as Partial<AnalyticsEvent>);
  }

  async findById(id: string): Promise<AnalyticsEvent> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`AnalyticsEvent ${id} not found`);
    return row;
  }

  async list(): Promise<AnalyticsEvent[]> {
    return this.repository.findAll();
  }

  /**
   * Computes daily active user counts over a rolling window by counting distinct userIds per calendar day from the raw event stream.
   */
  async computeDailyActiveUsers(rangeDays: number): Promise<number[]> {
    return this.repository.countDistinctUsersPerDay(rangeDays);
  }

  /**
   * Computes drop-off counts across an ordered sequence of funnel steps (e.g. view -> add_to_cart -> checkout -> purchase).
   */
  async computeConversionFunnel(steps: string[]): Promise<number[]> {
    return this.repository.countUsersCompletingEachStep(steps);
  }
}
