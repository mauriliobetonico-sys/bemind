import { Badge } from '@/components/ui/badge'
import { osStatusLabel, quoteStatusLabel, receivableStatusLabel } from '@/lib/utils'
import type { BadgeProps } from '@/components/ui/badge'

type Variant = BadgeProps['variant']

export function OSStatusBadge({ status }: { status: string }) {
  const map: Record<string, Variant> = {
    aberta: 'info',
    em_producao: 'warning',
    pronta: 'orange',
    instalada: 'purple',
    finalizada: 'success',
  }
  return <Badge variant={map[status] ?? 'outline'}>{osStatusLabel(status)}</Badge>
}

export function QuoteStatusBadge({ status }: { status: string }) {
  const map: Record<string, Variant> = {
    aberto: 'warning',
    aprovado: 'success',
    recusado: 'destructive',
    expirado: 'gray',
  }
  return <Badge variant={map[status] ?? 'outline'}>{quoteStatusLabel(status)}</Badge>
}

export function ReceivableStatusBadge({ status }: { status: string }) {
  const map: Record<string, Variant> = {
    pending: 'warning',
    partial: 'info',
    paid: 'success',
    overdue: 'destructive',
  }
  return <Badge variant={map[status] ?? 'outline'}>{receivableStatusLabel(status)}</Badge>
}
