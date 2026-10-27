import { useMemo, useState } from "react";
import { Plus, Search, Store, Check } from "lucide-react";
import { toast } from "sonner";
import type { Establishment } from "@/db/types";
import { addEstablishment, PossibleDuplicateError, ValidationError } from "@/db/actions";
import { norm, cn } from "@/lib/utils";
import { Button, Field, Input } from "../ui";

/** Busca rápida + cadastro mínimo (nome e endereço) sem sair do fluxo. */
export function EstablishmentPicker({
  establishments, value, onChange, isDemo, allowFreeName, freeName, onFreeName,
}: {
  establishments: Establishment[];
  value: string | null;
  onChange: (id: string | null) => void;
  isDemo: boolean;
  allowFreeName?: boolean;
  freeName?: string;
  onFreeName?: (v: string) => void;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [addr, setAddr] = useState("");
  const [cat, setCat] = useState("");
  const selected = establishments.find((e) => e.id === value);
  const results = useMemo(() => {
    const n = norm(q);
    if (!n) return [];
    return establishments.filter((e) => norm(`${e.name} ${e.address} ${e.category}`).includes(n)).slice(0, 8);
  }, [q, establishments]);

  if (selected)
    return (
      <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary-soft p-3">
        <Store className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{selected.name}</div>
          <div className="truncate text-xs text-muted">{selected.address}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Trocar</Button>
      </div>
    );

  const create = async () => {
    try {
      const e = await addEstablishment({ name: q, address: addr, category: cat || undefined }, isDemo);
      onChange(e.id);
      setCreating(false);
      toast.success("Estabelecimento cadastrado");
    } catch (err) {
      if (err instanceof PossibleDuplicateError) {
        onChange(err.existingId);
        toast.info("Já estava cadastrado: selecionei o existente.");
      } else if (err instanceof ValidationError) toast.error(err.message);
      else toast.error("Não foi possível cadastrar.");
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onFreeName?.(e.target.value);
          }}
          placeholder="Buscar estabelecimento ou digitar o nome"
          className="pl-10"
          aria-label="Buscar estabelecimento"
        />
      </div>
      {results.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-border">
          {results.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onChange(e.id)} className="press flex w-full items-center gap-3 border-b border-border bg-surface-raised px-3 py-2.5 text-left last:border-0 hover:bg-surface-overlay">
                <Store className="h-4 w-4 shrink-0 text-subtle" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{e.name}</span>
                  <span className="block truncate text-xs text-muted">{e.category} · {e.address}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !creating && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="soft" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Cadastrar “{q.trim()}”</Button>
          {allowFreeName && freeName && <span className={cn("inline-flex items-center gap-1 text-xs text-subtle")}><Check className="h-3.5 w-3.5" />ou siga só com o nome</span>}
        </div>
      )}
      {creating && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <Field label="Endereço"><Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Rua, número, quadra/lote" /></Field>
          <Field label="Categoria (opcional)"><Input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Ex.: Barbearia" /></Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button size="sm" variant="primary" onClick={create}>Salvar estabelecimento</Button>
          </div>
        </div>
      )}
    </div>
  );
}
