<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Sanitize;

final class Whatsapp
{
    public static function link(string $phone, string $message): string
    {
        $digits = Sanitize::digits($phone);
        return 'https://wa.me/' . $digits . '?text=' . rawurlencode($message);
    }

    public static function proposalMessage(array $proposal, string $publicUrl): string
    {
        $client = $proposal['client_name'] ?? 'Olá';
        return "Olá, {$client}! Segue nossa proposta {$proposal['number']} para o projeto \""
             . ($proposal['project'] ?? $proposal['title']) . "\": {$publicUrl}\n\n"
             . "Fico à disposição para qualquer dúvida.\nBe Mind Marketing";
    }

    public static function briefingMessage(array $briefing, string $publicUrl): string
    {
        $to = $briefing['contact_name'] ?? $briefing['client_name'] ?? 'Olá';
        return "Olá, {$to}! Antes de montarmos sua proposta, precisamos conhecer melhor o seu projeto.\n"
             . "São 12 perguntas rápidas: {$publicUrl}";
    }
}
