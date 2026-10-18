import { useEffect, useState } from "react";

/**
 * Return `value` after it has stopped changing for `delayMs`.
 *
 * Used to keep the search filter from firing a request on every keystroke,
 * which avoids both request storms and stale responses racing each other.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
