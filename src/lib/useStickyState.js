import { useState, useEffect } from "react";

// useState that persists to localStorage under `key`, so a user's choice
// (e.g. a sort selection) survives a page refresh.
export function useStickyState(defaultValue, key) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore (e.g. storage disabled) */
    }
  }, [key, value]);

  return [value, setValue];
}
