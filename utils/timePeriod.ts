export type PeriodKey =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | '90d'
  | 'mtd'
  | 'lastMonth'
  | 'qtd'
  | 'lastQuarter'
  | 'fytd'
  | 'lastFy'
  | 'ytd'
  | 'lastYear'
  | 'custom';

export interface PeriodOption {
  key: PeriodKey;
  label: string;
  shortLabel: string;
  group: 'quick' | 'calendar' | 'financial' | 'custom';
  description?: string;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: 'today', label: 'Today', shortLabel: 'Today', group: 'quick' },
  { key: 'yesterday', label: 'Yesterday', shortLabel: 'Yesterday', group: 'quick' },
  { key: '7d', label: 'Last 7 Days', shortLabel: '7D', group: 'quick' },
  { key: '30d', label: 'Last 30 Days', shortLabel: '30D', group: 'quick' },
  { key: '90d', label: 'Last 90 Days', shortLabel: '90D', group: 'quick' },
  { key: 'mtd', label: 'Month to Date', shortLabel: 'MTD', group: 'calendar', description: '1st of this month → today' },
  { key: 'lastMonth', label: 'Last Month', shortLabel: 'Last Month', group: 'calendar' },
  { key: 'qtd', label: 'Quarter to Date', shortLabel: 'QTD', group: 'calendar', description: 'Calendar quarter to today' },
  { key: 'lastQuarter', label: 'Last Quarter', shortLabel: 'Last Quarter', group: 'calendar' },
  { key: 'ytd', label: 'Calendar YTD', shortLabel: 'YTD', group: 'calendar', description: 'Jan 1 → today' },
  { key: 'lastYear', label: 'Last Calendar Year', shortLabel: 'Last Year', group: 'calendar' },
  { key: 'fytd', label: 'Financial YTD', shortLabel: 'FYTD', group: 'financial', description: 'Apr 1 → today (Indian FY)' },
  { key: 'lastFy', label: 'Last Financial Year', shortLabel: 'Last FY', group: 'financial', description: 'Apr → Mar' },
  { key: 'custom', label: 'Custom Range', shortLabel: 'Custom', group: 'custom' },
];

export interface PeriodRange {
  key: PeriodKey;
  label: string;
  startDate: string;
  endDate: string;
}

const IST_TZ = 'Asia/Kolkata';

function istCivilToday(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

const fmt = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

const fyStartYear = (d: Date) => (d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);

const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function computePeriodRange(
  key: PeriodKey,
  customStart?: string,
  customEnd?: string,
): PeriodRange {
  const today = istCivilToday();
  const opt = PERIOD_OPTIONS.find((o) => o.key === key) || PERIOD_OPTIONS[3];

  let startDate: string;
  let endDate: string;

  switch (key) {
    case 'today':
      startDate = endDate = fmt(today);
      break;
    case 'yesterday': {
      const y = new Date(today);
      y.setUTCDate(y.getUTCDate() - 1);
      startDate = endDate = fmt(y);
      break;
    }
    case '7d': {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 6);
      startDate = fmt(s);
      endDate = fmt(today);
      break;
    }
    case '30d': {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 29);
      startDate = fmt(s);
      endDate = fmt(today);
      break;
    }
    case '90d': {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 89);
      startDate = fmt(s);
      endDate = fmt(today);
      break;
    }
    case 'mtd': {
      const s = utcDate(today.getUTCFullYear(), today.getUTCMonth(), 1);
      startDate = fmt(s);
      endDate = fmt(today);
      break;
    }
    case 'lastMonth': {
      const s = utcDate(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
      const e = utcDate(today.getUTCFullYear(), today.getUTCMonth(), 0);
      startDate = fmt(s);
      endDate = fmt(e);
      break;
    }
    case 'qtd': {
      const q = Math.floor(today.getUTCMonth() / 3);
      const s = utcDate(today.getUTCFullYear(), q * 3, 1);
      startDate = fmt(s);
      endDate = fmt(today);
      break;
    }
    case 'lastQuarter': {
      const q = Math.floor(today.getUTCMonth() / 3);
      const lastQ = q - 1;
      const y = lastQ < 0 ? today.getUTCFullYear() - 1 : today.getUTCFullYear();
      const m = lastQ < 0 ? 9 : lastQ * 3;
      const s = utcDate(y, m, 1);
      const e = utcDate(y, m + 3, 0);
      startDate = fmt(s);
      endDate = fmt(e);
      break;
    }
    case 'fytd': {
      const fy = fyStartYear(today);
      const s = utcDate(fy, 3, 1);
      startDate = fmt(s);
      endDate = fmt(today);
      break;
    }
    case 'lastFy': {
      const fy = fyStartYear(today);
      const s = utcDate(fy - 1, 3, 1);
      const e = utcDate(fy, 2, 31);
      startDate = fmt(s);
      endDate = fmt(e);
      break;
    }
    case 'ytd': {
      const s = utcDate(today.getUTCFullYear(), 0, 1);
      startDate = fmt(s);
      endDate = fmt(today);
      break;
    }
    case 'lastYear': {
      const s = utcDate(today.getUTCFullYear() - 1, 0, 1);
      const e = utcDate(today.getUTCFullYear() - 1, 11, 31);
      startDate = fmt(s);
      endDate = fmt(e);
      break;
    }
    case 'custom': {
      startDate = customStart && YMD_RE.test(customStart) ? customStart : fmt(today);
      endDate = customEnd && YMD_RE.test(customEnd) ? customEnd : fmt(today);
      if (startDate > endDate) {
        const tmp = startDate;
        startDate = endDate;
        endDate = tmp;
      }
      break;
    }
    default: {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 29);
      startDate = fmt(s);
      endDate = fmt(today);
    }
  }

  return { key, label: opt.label, startDate, endDate };
}

export function formatPeriodLabel(p: PeriodRange): string {
  const opt = PERIOD_OPTIONS.find((o) => o.key === p.key);
  if (!opt) return `${p.startDate} → ${p.endDate}`;
  if (p.key === 'custom') return `${p.startDate} → ${p.endDate}`;
  return opt.label;
}

function parseYmdUtc(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function daysBetween(startDate: string, endDate: string): number {
  const s = parseYmdUtc(startDate);
  const e = parseYmdUtc(endDate);
  return Math.max(1, Math.floor((e.getTime() - s.getTime()) / 86400000) + 1);
}

export function eachDayInRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = parseYmdUtc(startDate);
  const end = parseYmdUtc(endDate);
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(fmt(d));
  }
  return out;
}
