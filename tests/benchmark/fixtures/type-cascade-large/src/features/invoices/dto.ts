import type { Order } from '../../types/domain.js';

export interface InvoicesResponseDto {
  id: string;
  total: number;
}

export function toInvoicesResponseDto(order: Order): InvoicesResponseDto {
  return { id: order.id, total: order.total };
}
