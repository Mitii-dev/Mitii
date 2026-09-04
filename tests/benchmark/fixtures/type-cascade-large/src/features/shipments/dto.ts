import type { Order } from '../../types/domain.js';

export interface ShipmentsEventDto {
  orderId: string;
  customerId: string;
}

export function toShipmentsEventDto(order: Order): ShipmentsEventDto {
  return { orderId: order.id, customerId: order.customerId };
}
