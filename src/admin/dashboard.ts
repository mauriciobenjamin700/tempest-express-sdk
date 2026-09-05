/**
 * Business-metric cards for the admin dashboard, mirroring `admin.dashboard`.
 *
 * Distinct from the system panel (CPU/memory): these are value / trend /
 * partition cards computed from the application's own data — "orders today",
 * "revenue vs last week", "users by plan". Register them on the
 * {@link AdminSite} and they render above the model cards.
 *
 * ```ts
 * const site = new AdminSite({
 *   title: "Shop",
 *   dashboardCards: [
 *     metricCard("Orders today", async (session) => ({
 *       kind: "value",
 *       value: await new BaseRepository(OrderModel, session).count(),
 *       unit: "orders",
 *     })),
 *   ],
 * });
 * ```
 */

import type { AsyncSession } from "@/db";

/** A single headline number. */
export interface MetricValue {
  kind: "value";
  /** The value to show — a number, or a preformatted string. */
  value: number | string;
  /** Optional unit suffix (`"orders"`, `"BRL"`). */
  unit?: string;
}

/** A number compared against a previous period. */
export interface MetricTrend {
  kind: "trend";
  /** The current value. */
  value: number;
  /** The value for the comparison period. */
  previous: number;
  /** Optional unit suffix. */
  unit?: string;
}

/** A breakdown of a total across labeled segments. */
export interface MetricPartition {
  kind: "partition";
  /** `(label, value)` pairs. */
  segments: { label: string; value: number }[];
}

/** What a card's `compute` returns. */
export type CardData = MetricValue | MetricTrend | MetricPartition;

/** Async function computing one card from a DB session. */
export type CardCompute = (session: AsyncSession) => Promise<CardData>;

/** A dashboard business-metric card. */
export interface MetricCard {
  /** The card heading. */
  label: string;
  /** Async function returning the card data. */
  compute: CardCompute;
  /** Optional sub-label shown under the value. */
  helpText?: string;
}

/**
 * Describe a dashboard card.
 *
 * @param label - The card heading.
 * @param compute - Async function returning the card data.
 * @param helpText - Optional sub-label.
 * @returns The card descriptor to pass to `new AdminSite({ dashboardCards })`.
 */
export function metricCard(
  label: string,
  compute: CardCompute,
  helpText?: string,
): MetricCard {
  return helpText === undefined ? { label, compute } : { label, compute, helpText };
}

/**
 * Return the percentage change a trend represents.
 *
 * @param trend - The computed trend.
 * @returns `delta / previous * 100`, or `null` when there is no baseline to
 *   divide by — a percentage against zero is undefined, not infinite.
 */
export function trendPercent(trend: MetricTrend): number | null {
  if (trend.previous === 0) return null;
  return ((trend.value - trend.previous) / trend.previous) * 100;
}

/**
 * Return which way a trend moved.
 *
 * @param trend - The computed trend.
 * @returns `"up"`, `"down"` or `"flat"`.
 */
export function trendDirection(trend: MetricTrend): "up" | "down" | "flat" {
  if (trend.value > trend.previous) return "up";
  if (trend.value < trend.previous) return "down";
  return "flat";
}

/**
 * Return the sum of a partition's segment values.
 *
 * @param partition - The computed partition.
 * @returns The total across segments.
 */
export function partitionTotal(partition: MetricPartition): number {
  return partition.segments.reduce((total, segment) => total + segment.value, 0);
}
