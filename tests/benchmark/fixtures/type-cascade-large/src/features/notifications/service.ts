import type { Order } from '../../types/domain.js';
import { recordNotificationsEvent } from './repository.js';

export function processNotifications(order: Order): void {
  recordNotificationsEvent(order.id, order);
}
