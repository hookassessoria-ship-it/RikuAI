import { useState } from "react";
import type { PeriodKey } from "@/lib/dates";

const KEY = "vendas-nfc:period";
export function usePeriod(initial: PeriodKey = "semana") {
  const [p, setP] = useState<PeriodKey>(() => {
    try {
      return (localStorage.getItem(KEY) as PeriodKey) || initial;
    } catch {
      return initial;
    }
  });
  const set = (k: PeriodKey) => {
    setP(k);
    try {
      localStorage.setItem(KEY, k);
    } catch {
      /* preferência de interface apenas */
    }
  };
  return [p, set] as const;
}
