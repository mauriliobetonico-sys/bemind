import type { Tx } from '../../db/pool';

export interface AgencySettings {
  agencyName: string;
  agencyDocument: string | null;
  agencyAddress: string | null;
  agencyEmail: string | null;
  agencyPhone: string | null;
  paymentInstructions: string | null;
  proposalFooter: string | null;
  marginAlertPercent: number;
  invoiceLeadDays: number;
}

/**
 * Lê as configurações da agência. A tabela só é visível em escopo
 * system/global (RLS), então quem chama em escopo de tenant recebe os padrões —
 * por isso os fluxos públicos e o worker usam escopo system.
 */
export async function getAgencySettings(tx: Tx): Promise<AgencySettings> {
  const r = (
    await tx.query(
      `SELECT agency_name AS "agencyName", agency_document AS "agencyDocument", agency_address AS "agencyAddress",
              agency_email AS "agencyEmail", agency_phone AS "agencyPhone", payment_instructions AS "paymentInstructions",
              proposal_footer AS "proposalFooter", margin_alert_percent::float8 AS "marginAlertPercent", invoice_lead_days AS "invoiceLeadDays"
         FROM agency_settings WHERE id = 1`,
    )
  ).rows[0];
  return (
    r ?? {
      agencyName: 'Agência',
      agencyDocument: null,
      agencyAddress: null,
      agencyEmail: null,
      agencyPhone: null,
      paymentInstructions: null,
      proposalFooter: null,
      marginAlertPercent: 30,
      invoiceLeadDays: 10,
    }
  );
}
