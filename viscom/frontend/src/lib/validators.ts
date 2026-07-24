import { z } from 'zod'

function validateCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i)
  let d1 = 11 - (sum % 11)
  if (d1 >= 10) d1 = 0
  if (d1 !== parseInt(digits[9])) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i)
  let d2 = 11 - (sum % 11)
  if (d2 >= 10) d2 = 0
  return d2 === parseInt(digits[10])
}

function validateCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  let sum = 0
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * weights1[i]
  let d1 = sum % 11 < 2 ? 0 : 11 - (sum % 11)
  if (d1 !== parseInt(digits[12])) return false
  sum = 0
  for (let i = 0; i < 13; i++) sum += parseInt(digits[i]) * weights2[i]
  let d2 = sum % 11 < 2 ? 0 : 11 - (sum % 11)
  return d2 === parseInt(digits[13])
}

// Inputs numéricos vazios com valueAsNumber:true produzem NaN.
// Zod z.number() rejeita NaN silenciosamente. Este helper converte NaN → undefined.
const nanToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'number' && isNaN(v) ? undefined : v), schema)

const optionalNum = nanToUndefined(z.number().optional().nullable())
const requiredNum = (min = 0, fallback?: number) =>
  z.preprocess(
    (v) => (typeof v === 'number' && isNaN(v) ? (fallback ?? undefined) : v),
    z.number().min(min),
  )

export const cpfCnpjSchema = z.string().refine((val) => {
  const digits = val.replace(/\D/g, '')
  return digits.length === 11 || digits.length === 14
}, 'CPF deve ter 11 dígitos ou CNPJ 14 dígitos')

export const clientSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  person_type: z.enum(['PF', 'PJ'], { required_error: 'Selecione o tipo de pessoa' }),
  cpf_cnpj: cpfCnpjSchema,
  ie: z.string().optional(),
  phone: z.string().min(10, 'Telefone inválido').max(20),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().max(2).optional(),
  observations: z.string().optional(),
  is_reseller: z.boolean().default(false),
  reseller_discount_pct: nanToUndefined(z.number().min(0).max(100).optional().nullable()),
})

export const productSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  unit: z.enum(['m2', 'unidade', 'metro_linear'], { required_error: 'Selecione a unidade' }),
  price_client: requiredNum(0),
  price_reseller: requiredNum(0),
  is_active: z.boolean().default(true),
})

export const quoteItemSchema = z.object({
  product_id: z.string().min(1, 'Selecione um produto'),
  material_type: z.string().optional(),
  installation_type: z.string().optional(),
  finishing: z.string().optional(),
  width_m: optionalNum,
  height_m: optionalNum,
  quantity: requiredNum(1, 1),
  unit_price: requiredNum(0, 0),
  discount_pct: z.preprocess(
    (v) => (typeof v === 'number' && isNaN(v) ? 0 : v),
    z.number().min(0).max(100).default(0),
  ),
})

export const quoteSchema = z.object({
  client_id: z.string().min(1, 'Selecione um cliente'),
  valid_until: z.string().optional(),
  installation_deadline: z.string().optional(),
  discount_general: z.preprocess(
    (v) => (typeof v === 'number' && isNaN(v) ? 0 : v),
    z.number().min(0).max(100).default(0),
  ),
  notes: z.string().optional(),
  status: z.enum(['aberto', 'aprovado', 'recusado', 'expirado']).default('aberto'),
  items: z.array(quoteItemSchema).min(1, 'Adicione ao menos um item'),
})

export const serviceOrderItemSchema = z.object({
  product_id: z.string().min(1, 'Selecione um produto'),
  material_type: z.string().optional(),
  installation_type: z.string().optional(),
  finishing: z.string().optional(),
  width_m: optionalNum,
  height_m: optionalNum,
  quantity: requiredNum(1, 1),
  unit_price: requiredNum(0, 0),
})

export const serviceOrderSchema = z.object({
  client_id: z.string().min(1, 'Selecione um cliente'),
  quote_id: z.string().optional().nullable(),
  deadline: z.string().optional(),
  production_notes: z.string().optional(),
  installation_notes: z.string().optional(),
  payment_method: z.string().optional(),
  payment_conditions: z.string().optional(),
  items: z.array(serviceOrderItemSchema).min(1, 'Adicione ao menos um item'),
})

export const receiptSchema = z.object({
  client_id: z.string().min(1, 'Selecione um cliente'),
  os_id: z.string().optional().nullable(),
  payer_name: z.string().min(2, 'Nome do pagador obrigatório'),
  amount: requiredNum(0.01),
  reference: z.string().min(2, 'Referência obrigatória'),
  payment_method: z.string().min(1, 'Forma de pagamento obrigatória'),
  receipt_date: z.string().min(1, 'Data obrigatória'),
})

export const paymentSchema = z.object({
  amount: requiredNum(0.01),
  payment_date: z.string().min(1, 'Data obrigatória'),
  payment_method: z.string().min(1, 'Forma de pagamento obrigatória'),
  notes: z.string().optional(),
})

export const cashFlowSchema = z.object({
  type: z.enum(['entrada', 'saida']),
  category: z.string().min(1, 'Categoria obrigatória'),
  description: z.string().min(2, 'Descrição obrigatória'),
  amount: requiredNum(0.01),
  date: z.string().min(1, 'Data obrigatória'),
})

export const userSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  email: z.string().email('E-mail inválido'),
  role: z.enum(['admin', 'vendedor']),
  password: z.string().min(6, 'Senha deve ter ao menos 6 caracteres').optional(),
  is_active: z.boolean().default(true),
})

export type ClientFormData = z.infer<typeof clientSchema>
export type ProductFormData = z.infer<typeof productSchema>
export type QuoteFormData = z.infer<typeof quoteSchema>
export type ServiceOrderFormData = z.infer<typeof serviceOrderSchema>
export type ReceiptFormData = z.infer<typeof receiptSchema>
export type PaymentFormData = z.infer<typeof paymentSchema>
export type CashFlowFormData = z.infer<typeof cashFlowSchema>
export type UserFormData = z.infer<typeof userSchema>
