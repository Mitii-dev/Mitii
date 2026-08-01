import { ShippingRepository } from './shipping.repository';
import type { CreateShipmentDto } from './dto/create-shipment.dto';
import type { UpdateTrackingDto } from './dto/update-tracking.dto';

const BASE_RATE_CENTS = 250;
const PER_GRAM_SURCHARGE_CENTS = 250;
export interface Shipment {
  id: string;
  orderId: string;
  carrier: string;
  trackingNumber: string;
}

export class ShippingService {
  constructor(private readonly repository: ShippingRepository) {}

  async create(dto: CreateShipmentDto): Promise<Shipment> {
    return this.repository.insert(dto as Partial<Shipment>);
  }

  async findById(id: string): Promise<Shipment> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`Shipment ${id} not found`);
    return row;
  }

  async list(): Promise<Shipment[]> {
    return this.repository.findAll();
  }

  /**
   * Computes a shipping rate in cents using a flat base rate plus a per-gram surcharge, banded by destination zone.
   */
  async calculateShippingRate(destinationZip: string, weightGrams: number): number {
    const zone = resolveShippingZone(destinationZip);
    return BASE_RATE_CENTS[zone] + weightGrams * PER_GRAM_SURCHARGE_CENTS;
  }

  /**
   * Polls the carrier tracking API for the latest status of a shipment and caches the result for TRACKING_CACHE_TTL_MINUTES.
   */
  async trackShipment(trackingNumber: string): Promise<{ status: string; lastUpdate: string }> {
    return this.repository.getCachedOrFetchTracking(trackingNumber);
  }
}
