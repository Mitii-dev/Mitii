export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function applyTax(amount: number, rate: number): number {
  return amount + amount * rate;
}
