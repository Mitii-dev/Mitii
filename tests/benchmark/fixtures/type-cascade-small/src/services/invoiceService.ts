import type { Order } from '../types/domain.js';
import { formatCurrency } from '../utils/currency.js';

export function renderInvoiceLine(order: Order): string {
  return `Order ${order.id}: ${formatCurrency(order.total)}`;
}

export function invoiceSummary(orders: Order[]): string {
  const grandTotal = orders.reduce((sum, order) => sum + order.total, 0);
  return `${orders.length} orders, total ${formatCurrency(grandTotal)}`;
}
