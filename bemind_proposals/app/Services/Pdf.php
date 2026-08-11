<?php
declare(strict_types=1);

namespace App\Services;

/**
 * Geração de PDF a partir do HTML da proposta pública.
 *
 * Sem dependência obrigatória: se Dompdf estiver instalado via Composer
 * em /vendor, gera o PDF real. Caso contrário devolve o próprio HTML
 * com CSS de impressão (o navegador consegue "Salvar como PDF") e o
 * header aponta application/pdf apenas quando é PDF de verdade.
 */
final class Pdf
{
    public static function fromHtml(string $html, string $filenameBase = 'proposta'): array
    {
        if (class_exists('\\Dompdf\\Dompdf')) {
            $opts = new \Dompdf\Options();
            $opts->set('isRemoteEnabled', true);
            $opts->set('defaultFont', 'DejaVu Sans');
            $dompdf = new \Dompdf\Dompdf($opts);
            $dompdf->loadHtml($html, 'UTF-8');
            $dompdf->setPaper('a4');
            $dompdf->render();
            return [
                'mime'    => 'application/pdf',
                'bytes'   => $dompdf->output(),
                'name'    => $filenameBase . '.pdf',
                'isReal'  => true,
            ];
        }

        // Fallback: HTML com estilo de impressão (Ctrl/Cmd + P → PDF).
        return [
            'mime'    => 'text/html; charset=utf-8',
            'bytes'   => $html,
            'name'    => $filenameBase . '.html',
            'isReal'  => false,
        ];
    }
}
