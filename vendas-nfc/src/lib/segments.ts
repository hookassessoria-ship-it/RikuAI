import { norm } from "./utils";

/** Macro-segmentos usados nas análises (a categoria original é preservada). */
export const SEGMENTS = ["Barbearia", "Beleza e estética", "Alimentação", "Pet e veterinária", "Automotivo", "Saúde", "Academia e fitness", "Varejo", "Outros"] as const;

const RULES: [string, string[]][] = [
  ["Barbearia", ["barbearia", "barber"]],
  ["Pet e veterinária", ["pet", "veterin", "agropecuar"]],
  ["Automotivo", ["oficina", "mecanic", "automecanic", "funilaria", "lanternagem", "lava jato", "lava motos", "auto center", "automotiv"]],
  ["Academia e fitness", ["academia", "crossfit", "pilates", "fitness", "funcional", "treino", "box de"]],
  ["Saúde", ["clinica", "odonto", "dent", "farmac", "medic", "fisioter"]],
  ["Beleza e estética", ["salao", "esmalteria", "estetica", "cabelei", "nails", "unha", "beleza", "maquiagem", "cachos", "sobrancelha"]],
  ["Alimentação", ["restaurante", "lanchonete", "pizzaria", "hamburgueria", "bar", "acai", "sorvete", "padaria", "pao", "esfiha", "pastel", "jantinha", "espetinho", "sanduich", "steakhouse", "japones", "churrascaria", "cafeteria", "lanche", "confeitaria"]],
  ["Varejo", ["loja", "roupa", "moda", "calcado", "utilidade", "papelaria", "presente", "chocolate", "chaveiro", "carimbo", "otica", "cosmetic", "variedade"]],
];

export function segmentOf(category: string): string {
  const c = ` ${norm(category)} `;
  for (const [seg, keys] of RULES) if (keys.some((k) => c.includes(` ${k}`))) return seg;
  return "Outros";
}
