import { useEffect, useState } from "react";

/** Roteamento por hash (#/rota/123): funciona em qualquer hospedagem estática, sem configurar servidor. */
export function useHashRoute(): string[] {
  const read = () => (window.location.hash.replace(/^#\/?/, "") || "inicio").split("/").filter(Boolean);
  const [parts, setParts] = useState<string[]>(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parts;
}

export function go(path: string) {
  const h = "#/" + path.replace(/^\/+/, "");
  if (window.location.hash !== h) window.location.hash = h;
  window.scrollTo({ top: 0 });
}
