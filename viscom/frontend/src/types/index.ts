export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'vendedor'
  is_active: boolean
  created_at: string
}

export interface Client {
  id: string
  name: string
  person_type: 'PF' | 'PJ'
  cpf_cnpj: string
  ie?: string
  phone: string
  email?: string
  cep?: string
  logradouro?: string
  numero?: string
  bairro?: string
  cidade?: string
  uf?: string
  observations?: string
  is_reseller: boolean
  reseller_discount_pct?: number
  is_deleted: boolean
  created_at: string
}

export interface Product {
  id: string
  name: string
  unit: 'm2' | 'unidade' | 'metro_linear'
  price_client: number
  price_reseller: number
  is_active: boolean
  created_at: string
}

export interface ConfigList {
  id: string
  category: 'material_type' | 'installation_type' | 'finishing' | 'payment_method'
  value: string
  is_active: boolean
}

export interface QuoteItem {
  id?: string
  product_id: string
  product?: Product
  width_m?: number
  height_m?: number
  area_m2?: number
  quantity: number
  unit_price: number
  discount_pct: number
  subtotal: number
}

export interface Quote {
  id: string
  number: number
  client_id: string
  client?: Client
  created_by_id: string
  created_by?: User
  status: 'aberto' | 'aprovado' | 'recusado' | 'expirado'
  valid_until?: string
  discount_general: number
  notes?: string
  items: QuoteItem[]
  total: number
  created_at: string
  updated_at: string
}

export interface ServiceOrderItem {
  id?: string
  product_id: string
  product?: Product
  material_type?: string
  installation_type?: string
  finishing?: string
  width_m?: number
  height_m?: number
  area_m2?: number
  quantity: number
  unit_price: number
  subtotal: number
}

export type OSStatus = 'aberta' | 'em_producao' | 'pronta' | 'instalada' | 'finalizada'

export interface StatusHistory {
  id: string
  old_status: OSStatus
  new_status: OSStatus
  changed_by?: User
  changed_at: string
  notes?: string
}

export interface ServiceOrder {
  id: string
  number: number
  quote_id?: string
  client_id: string
  client?: Client
  created_by_id: string
  created_by?: User
  status: OSStatus
  opened_at: string
  deadline?: string
  production_notes?: string
  installation_notes?: string
  total_value: number
  payment_method?: string
  payment_conditions?: string
  items: ServiceOrderItem[]
  status_history: StatusHistory[]
  created_at: string
  updated_at: string
}

export interface Receivable {
  id: string
  os_id?: string
  os?: ServiceOrder
  client_id: string
  client?: Client
  description: string
  total_value: number
  due_date: string
  paid_amount: number
  status: 'pending' | 'partial' | 'paid' | 'overdue'
  installment_number: number
  total_installments: number
  interest_rate: number
  fine_rate: number
  created_at: string
  payments?: Payment[]
}

export interface Payment {
  id: string
  receivable_id: string
  amount: number
  payment_date: string
  payment_method: string
  notes?: string
  created_by?: User
  created_at: string
}

export interface CashFlow {
  id: string
  type: 'entrada' | 'saida'
  category: string
  description: string
  amount: number
  date: string
  created_by?: User
  created_at: string
}

export interface Receipt {
  id: string
  number: number
  os_id?: string
  client_id: string
  client?: Client
  payer_name: string
  amount: number
  amount_words: string
  reference: string
  payment_method: string
  receipt_date: string
  created_by?: User
  created_at: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface DashboardData {
  os_abertas: number
  os_em_producao: number
  clientes_total: number
  faturamento_mes: number
  inadimplencia_total?: number
  os_prontas: number
}

export interface ClientDebt {
  client: Client
  total_debt: number
  overdue_amount: number
  receivables: Receivable[]
}

export interface ReportSalesPeriod {
  period: string
  total: number
  count: number
}

export interface ReportBySeller {
  seller: User
  total: number
  count: number
}

export interface ReportByClient {
  client: Client
  total: number
  count: number
}

export interface ReportByMaterial {
  material_type: string
  total: number
  count: number
  area_total: number
}

export interface ReportTopProducts {
  product: Product
  quantity: number
  total: number
}

export interface Company {
  id?: string
  name: string
  cnpj: string
  address: string
  phone: string
  email: string
  logo_path?: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  user: User
}
