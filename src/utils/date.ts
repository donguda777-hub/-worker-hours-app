export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISODate(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatMonthLabel(year: number, month0: number): string {
  return `${year}�� ${month0 + 1}��`;
}

export function getMonthGrid(year: number, month0: number): { date: Date; inMonth: boolean }[] {
  const first = new Date(year, month0, 1);
  const last = new Date(year, month0 + 1, 0);
  const startWeekday = first.getDay();
  const daysInMonth = last.getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];

  for (let i = 0; i < startWeekday; i++) {
    const d = new Date(year, month0, -startWeekday + i + 1);
    cells.push({ date: d, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month0, d), inMonth: true });
  }
  while (cells.length < 42) {
    const lastCell = cells[cells.length - 1];
    const next = new Date(lastCell.date);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, inMonth: false });
  }
  while (cells.length % 7 !== 0) {
    const lastCell = cells[cells.length - 1];
    const next = new Date(lastCell.date);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, inMonth: false });
  }
  return cells;
}
