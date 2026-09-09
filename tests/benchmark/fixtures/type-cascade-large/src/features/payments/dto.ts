import type { Order } from '../../types/domain.js';

export interface PaymentsResponseDto {
  id: string;
  total: number;
}

export function toPaymentsResponseDto(order: Order): PaymentsResponseDto {
  return { id: order.id, total: order.total };
}
