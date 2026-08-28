const SMALL_COST_THRESHOLD_USD = 0.01;
const SMALL_COST_DECIMAL_PLACES = 4;
const COST_DECIMAL_PLACES = 2;
const TOKEN_UNIT = 1_000;
const TOKEN_DECIMAL_PLACES = 1;
const MILLISECONDS_PER_SECOND = 1_000;
const DURATION_DECIMAL_PLACES = 1;

export function formatUsd(value: number): string {
  if (value > 0 && value < SMALL_COST_THRESHOLD_USD) {
    return `$${value.toFixed(SMALL_COST_DECIMAL_PLACES)}`;
  }
  return `$${value.toFixed(COST_DECIMAL_PLACES)}`;
}

export function formatTokens(value: number): string {
  if (value < TOKEN_UNIT) {
    return `${value}`;
  }
  return `${(value / TOKEN_UNIT).toFixed(TOKEN_DECIMAL_PLACES)}k`;
}

export function formatDuration(milliseconds: number): string {
  return `${(milliseconds / MILLISECONDS_PER_SECOND).toFixed(DURATION_DECIMAL_PLACES)}s`;
}
