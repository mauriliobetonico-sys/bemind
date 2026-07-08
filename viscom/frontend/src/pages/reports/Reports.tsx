import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { formatCurrency, downloadBlob } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { FileDown, FileSpreadsheet } from 'lucide-react'

const now = new Date()
const DEFAULT_FROM = `${now.getFullYear()}-01-01`
const DEFAULT_TO = now.toISOString().slice(0, 10)

function useReport(endpoint: string, params: Record<string, string | undefined>, enabled: boolean) {
  return useQuery({
    queryKey: ['report', endpoint, params],
    queryFn: async () => (await api.get(`/reports/${endpoint}`, { params })).data,
    enabled,
  })
}

function ReportToolbar({ onPdf, onExcel }: { onPdf: () => void; onExcel: () => void }) {
  return (
    <div className="flex gap-2 mb-4">
      <Button variant="outline" size="sm" onClick={onPdf}><FileDown className="mr-2 h-4 w-4" />PDF</Button>
      <Button variant="outline" size="sm" onClick={onExcel}><FileSpreadsheet className="mr-2 h-4 w-4" />Excel</Button>
    </div>
  )
}

function DateFilter({ from, to, setFrom, setTo, onSubmit }: any) {
  return (
    <div className="flex gap-4 mb-4 items-end">
      <div className="space-y-1"><Label className="text-xs">De</Label><Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div className="space-y-1"><Label className="text-xs">Até</Label><Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      <Button size="sm" onClick={onSubmit}>Buscar</Button>
    </div>
  )
}

type Tab = 'periodo' | 'vendedor' | 'cliente' | 'material' | 'inadimplencia' | 'produtos'
const TABS: { id: Tab; label: string }[] = [
  { id: 'periodo', label: 'Por Período' },
  { id: 'vendedor', label: 'Por Vendedor' },
  { id: 'cliente', label: 'Por Cliente' },
  { id: 'material', label: 'Por Material' },
  { id: 'inadimplencia', label: 'Inadimplência' },
  { id: 'produtos', label: 'Top Produtos' },
]

export function Reports() {
  const [tab, setTab] = useState<Tab>('periodo')
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const [submitted, setSubmitted] = useState(false)

  const params = { date_from: from, date_to: to }
  const enabled = submitted

  const periodData = useReport('sales-by-period', params, enabled && tab === 'periodo')
  const sellerData = useReport('by-seller', params, enabled && tab === 'vendedor')
  const clientData = useReport('by-client', params, enabled && tab === 'cliente')
  const materialData = useReport('by-material', params, enabled && tab === 'material')
  const delinqData = useReport('delinquency', {}, enabled && tab === 'inadimplencia')
  const topProdData = useReport('top-products', params, enabled && tab === 'produtos')

  async function handleDownload(format: 'pdf' | 'xlsx') {
    try {
      const endpointMap: Record<Tab, string> = {
        periodo: 'sales-by-period', vendedor: 'by-seller', cliente: 'by-client',
        material: 'by-material', inadimplencia: 'delinquency', produtos: 'top-products',
      }
      const res = await api.get(`/reports/${endpointMap[tab]}/${format}`, { params, responseType: 'blob' })
      downloadBlob(res.data, `relatorio-${tab}.${format === 'pdf' ? 'pdf' : 'xlsx'}`)
    } catch { toast({ title: 'Erro ao gerar arquivo', variant: 'destructive' }) }
  }

  return (
    <div>
      <PageHeader title="Relatórios" />

      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map((t) => (
          <Button key={t.id} variant={tab === t.id ? 'default' : 'outline'} size="sm" onClick={() => { setTab(t.id); setSubmitted(false) }}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab !== 'inadimplencia' && (
        <DateFilter from={from} to={to} setFrom={setFrom} setTo={setTo} onSubmit={() => setSubmitted(true)} />
      )}
      {tab === 'inadimplencia' && <Button size="sm" className="mb-4" onClick={() => setSubmitted(true)}>Carregar</Button>}

      <ReportToolbar onPdf={() => handleDownload('pdf')} onExcel={() => handleDownload('xlsx')} />

      <Card>
        <CardContent className="p-0">
          {tab === 'periodo' && (
            <Table>
              <TableHeader><TableRow><TableHead>Período</TableHead><TableHead>Qtd OS</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {!periodData.data ? <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Sem dados no período</TableCell></TableRow>
                  : <TableRow><TableCell>{from} → {to}</TableCell><TableCell>{periodData.data.total_orders}</TableCell><TableCell className="text-right">{formatCurrency(periodData.data.total_value)}</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
          {tab === 'vendedor' && (
            <Table>
              <TableHeader><TableRow><TableHead>Vendedor</TableHead><TableHead>Qtd OS</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {!sellerData.data?.length ? <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Sem dados</TableCell></TableRow>
                  : sellerData.data.map((r: any, i: number) => <TableRow key={i}><TableCell>{r.seller_name}</TableCell><TableCell>{r.count}</TableCell><TableCell className="text-right">{formatCurrency(r.total)}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          )}
          {tab === 'cliente' && (
            <Table>
              <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Qtd OS</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {!clientData.data?.length ? <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Sem dados</TableCell></TableRow>
                  : clientData.data.map((r: any, i: number) => <TableRow key={i}><TableCell>{r.client_name}</TableCell><TableCell>{r.count}</TableCell><TableCell className="text-right">{formatCurrency(r.total)}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          )}
          {tab === 'material' && (
            <Table>
              <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Qtd Itens</TableHead><TableHead>Área Total (m²)</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {!materialData.data?.length ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Sem dados</TableCell></TableRow>
                  : materialData.data.map((r: any, i: number) => <TableRow key={i}><TableCell>{r.material_type || 'Não especificado'}</TableCell><TableCell>{r.count}</TableCell><TableCell>{r.area_total?.toFixed(2) ?? '-'}</TableCell><TableCell className="text-right">{formatCurrency(r.total)}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          )}
          {tab === 'inadimplencia' && (
            <Table>
              <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Total em Aberto</TableHead><TableHead className="text-right">Vencido</TableHead></TableRow></TableHeader>
              <TableBody>
                {!delinqData.data?.length ? <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Sem inadimplentes</TableCell></TableRow>
                  : delinqData.data.map((r: any, i: number) => <TableRow key={i}><TableCell>{r.client_name}</TableCell><TableCell>{formatCurrency(r.total_debt)}</TableCell><TableCell className="text-right text-red-600">{formatCurrency(r.overdue_amount)}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          )}
          {tab === 'produtos' && (
            <Table>
              <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Qtd Vendida</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {!topProdData.data?.length ? <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Sem dados</TableCell></TableRow>
                  : topProdData.data.map((r: any, i: number) => <TableRow key={i}><TableCell>{r.product_name}</TableCell><TableCell>{r.quantity}</TableCell><TableCell className="text-right">{formatCurrency(r.total)}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
