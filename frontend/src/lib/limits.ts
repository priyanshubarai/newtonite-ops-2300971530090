/**
 * Client-side length limits mirroring `backend/src/items/validation.ts`.
 *
 * These exist purely for friendly, immediate feedback; the backend remains the
 * authority and re-validates every request.
 */

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const SEARCH_MAX_LENGTH = 200;
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
