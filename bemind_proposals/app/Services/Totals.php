<?php
declare(strict_types=1);

namespace App\Services;

use App\Models\Proposal;

/**
 * Recalcula todos os totais no servidor (fonte de verdade).
 *  subtotal_monthly = Σ itens (unit_price * qty) onde recurrence = mensal
 *  subtotal_once    = Σ demais
 *  desconto geral   = discount_percent da proposta (%) aplicado a AMBOS
 *  total_monthly    = subtotal_monthly * (1 - disc/100)
 *  total_once       = subtotal_once    * (1 - disc/100)
 *  discount_value   = (subtotal_monthly + subtotal_once) * disc/100
 */
final class Totals
{
    public static function recompute(int $proposalId): array
    {
        $p     = Proposal::find($proposalId);
        if (!$p) throw new \RuntimeException('Proposta não encontrada.');
        $items = Proposal::items($proposalId);

        $subMon = 0.0; $subOnce = 0.0;
        foreach ($items as $it) {
            $line = (float)$it['unit_price'] * max(1, (int)$it['quantity']);
            $iDisc = (float)$it['discount_percent'];
            if ($iDisc > 0) $line *= (1 - $iDisc / 100);
            if ($it['recurrence'] === 'mensal') $subMon  += $line;
            else                                 $subOnce += $line;
        }

        $disc     = max(0.0, min(100.0, (float)$p['discount_percent']));
        $factor   = (100 - $disc) / 100;
        $totMon   = round($subMon  * $factor, 2);
        $totOnce  = round($subOnce * $factor, 2);
        $discValue= round(($subMon + $subOnce) - ($totMon + $totOnce), 2);

        Proposal::updateTotals($proposalId, round($subMon,2), round($subOnce,2), $totMon, $totOnce, $discValue);

        return compact('subMon','subOnce','totMon','totOnce','discValue');
    }
}
