import type { Order } from '../../types/domain.js';
import { recordShipmentsEvent } from './repository.js';

export function processShipments(order: Order): void {
  recordShipmentsEvent(order.id, order);
}
