export const PRODUCT_TOUR_VERSION = 1;
export type ProductTourStatus = 'completed' | 'skipped';
export interface ProductTourState {
  version: number;
  accountScope: string;
  status: ProductTourStatus | null;
}

export function isProductTourState(value: unknown): value is ProductTourState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ProductTourState;
  return (
    state.version === PRODUCT_TOUR_VERSION &&
    typeof state.accountScope === 'string' &&
    /^[a-f0-9]{64}$/.test(state.accountScope) &&
    (state.status === null || state.status === 'completed' || state.status === 'skipped')
  );
}
