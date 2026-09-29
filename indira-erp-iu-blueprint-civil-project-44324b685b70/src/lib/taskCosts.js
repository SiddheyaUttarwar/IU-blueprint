export function computeTaskCosts(indentItems) {
  const byTask = new Map();
  for (const it of indentItems ?? []) {
    if (!it.mapped_task_id) continue;
    const buy = Number(it.buy_qty || 0);
    const rec = Number(it.received_qty || 0);
    const price = Number(it.unit_price || 0);
    const entry = byTask.get(it.mapped_task_id) ?? { estimated: 0, received: 0, itemCount: 0 };
    entry.estimated += buy * price;
    entry.received += rec * price;
    entry.itemCount += 1;
    byTask.set(it.mapped_task_id, entry);
  }
  return byTask;
}

export function fmtRupee(n) {
  if (!n) return '₹0';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
