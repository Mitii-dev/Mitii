import type { Order } from '../../types/domain.js';
import { recordCustomersEvent } from './repository.js';

export function processCustomers(order: Order): void {
  recordCustomersEvent(order.id, order);
}
