import { ChevronDown, Circle, Footprints, Eye, UserX, MessagesSquare, Star, CalendarClock, BadgeCheck, ThumbsDown, DoorClosed } from "lucide-react";
import type { StopStatus } from "@/db/types";
import { STATUS_LABEL } from "@/db/types";
import { cn } from "@/lib/utils";

export const STATUS_META: { key: StopStatus; Icon: typeof Circle; bg: string; fg: string }[] = [
  { key: "pendente", Icon: Circle, bg: "bg-neutral-soft", fg: "text-neutral" },
  { key: "a_caminho", Icon: Footprints, bg: "bg-primary-soft", fg: "text-primary" },
  { key: "visitado", Icon: Eye, bg: "bg-primary-soft", fg: "text-primary" },
  { key: "ausente", Icon: UserX, bg: "bg-warn-soft", fg: "text-warn" },
  { key: "conversa", Icon: MessagesSquare, bg: "bg-primary-soft", fg: "text-primary" },
  { key: "interessado", Icon: Star, bg: "bg-ok-soft", fg: "text-ok" },
  { key: "retornar", Icon: CalendarClock, bg: "bg-warn-soft", fg: "text-warn" },
  { key: "venda", Icon: BadgeCheck, bg: "bg-ok-soft", fg: "text-ok" },
  { key: "sem_interesse", Icon: ThumbsDown, bg: "bg-bad-soft", fg: "text-bad" },
  { key: "fechado", Icon: DoorClosed, bg: "bg-bad-soft", fg: "text-bad" },
];
export const statusMeta = (s: StopStatus) => STATUS_META.find((m) => m.key === s)!;

export function StatusPill({ status, onClick, className }: { status: StopStatus; onClick?: () => void; className?: string }) {
  const m = statusMeta(status);
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={onClick ? `Status: ${STATUS_LABEL[status]}. Toque para alterar` : undefined}
      className={cn("press inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold", m.bg, m.fg, className)}
    >
      <m.Icon className="h-4 w-4" aria-hidden />
      {STATUS_LABEL[status]}
      {onClick && <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />}
    </Comp>
  );
}
