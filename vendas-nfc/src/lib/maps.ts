/** Links do Google Maps (API pública de URLs; não requer chave e não calcula rotas no app). */
export function mapsSearchUrl(query: string): string {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
}
/** Navegação até o destino a partir da localização atual do celular. */
export function mapsNavUrl(destination: string, mode: "walking" | "driving" = "walking"): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${mode}`;
}
export function mapsDirUrl(origin: string, destination: string, mode: "walking" | "driving" = "walking"): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${mode}`;
}
export function placeQuery(e: { name: string; address: string; bairro?: string; city?: string }): string {
  const name = e.name.split(" / ")[0].split(" (")[0];
  return [name, e.address.split(" (")[0], e.bairro, e.city ? `${e.city.replace(/ \(.*/, "")} - GO` : ""].filter(Boolean).join(", ");
}
export function telUrl(phone: string): string | null {
  const m = phone.match(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/);
  if (!m) return null;
  return "tel:+55" + m[0].replace(/\D/g, "");
}
