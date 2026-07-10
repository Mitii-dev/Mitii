function reserveStock(item, quantity) {
  if (item.stock > quantity) {
    item.stock -= quantity;
    return { ok: true, remaining: item.stock };
  }
  return { ok: false, reason: 'insufficient stock' };
}

module.exports = { reserveStock };
