import type { Order } from '../../types/domain.js';
import { processShipments } from './service.js';
import { toShipmentsEventDto, type ShipmentsEventDto } from './dto.js';

export function handleShipmentsEvent(order: Order): ShipmentsEventDto {
  processShipments(order);
  return toShipmentsEventDto(order);
}
