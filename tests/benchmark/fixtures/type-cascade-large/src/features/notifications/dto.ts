import type { Order } from '../../types/domain.js';

export interface NotificationsEventDto {
  orderId: string;
  customerId: string;
}

export function toNotificationsEventDto(order: Order): NotificationsEventDto {
  return { orderId: order.id, customerId: order.customerId };
}
