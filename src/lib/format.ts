import { format, formatDistanceToNowStrict } from "date-fns";
import { de } from "date-fns/locale";

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number, digits?: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exp;
  const fractionDigits = digits ?? (exp === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: fractionDigits, minimumFractionDigits: 0 })} ${UNITS[exp]}`;
}

const numberFormat = new Intl.NumberFormat("de-DE");
const currency0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const currency2 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1.540 €" – cents only for small amounts */
export function formatCurrency(value: number): string {
  return Math.abs(value) < 100 ? currency2.format(value) : currency0.format(value);
}

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toLocaleString("de-DE", { maximumFractionDigits: digits })} %`;
}

export function formatDate(iso: string): string {
  return format(new Date(iso), "dd.MM.yyyy", { locale: de });
}

export function formatRelative(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { locale: de, addSuffix: true });
}

export function ageInYears(iso: string, now = Date.now()): number {
  return (now - new Date(iso).getTime()) / (365.25 * 24 * 3600 * 1000);
}

export function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
