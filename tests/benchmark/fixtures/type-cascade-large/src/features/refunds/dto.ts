import type { Order } from '../../types/domain.js';

export interface RefundsResponseDto {
  id: string;
  total: number;
}

export function toRefundsResponseDto(order: Order): RefundsResponseDto {
  return { id: order.id, total: order.total };
}
