export interface Order {
  id: string;
  customerId: string;
  total: { amount: number; currency: string };
  createdAt: string;
}

export interface LineItem {
  orderId: string;
  sku: string;
  quantity: number;
  unitPrice: number;
}
