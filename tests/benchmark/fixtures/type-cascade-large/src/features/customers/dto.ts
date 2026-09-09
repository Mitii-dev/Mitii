import type { Order } from '../../types/domain.js';

export interface CustomersEventDto {
  orderId: string;
  customerId: string;
}

export function toCustomersEventDto(order: Order): CustomersEventDto {
  return { orderId: order.id, customerId: order.customerId };
}
