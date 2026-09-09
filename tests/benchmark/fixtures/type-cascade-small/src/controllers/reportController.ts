import { listOrders } from '../repositories/orderRepository.js';
import { invoiceSummary } from '../services/invoiceService.js';

export function handleRevenueReport(): { orderCount: number; summary: string } {
  const orders = listOrders();
  return { orderCount: orders.length, summary: invoiceSummary(orders) };
}
