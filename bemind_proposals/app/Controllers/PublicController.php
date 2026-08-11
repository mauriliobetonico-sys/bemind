<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Controller;
use App\Core\Request;
use App\Core\Response;

/**
 * Placeholders para as rotas públicas (proposta e briefing).
 * Ganham corpo real nos passos 4 e 6 da ordem de implementação.
 */
final class PublicController extends Controller
{
    public function proposal(Request $req, array $params): void
    {
        Response::abort(501, 'Proposta pública será implementada no passo 4.');
    }

    public function accept(Request $req, array $params): void
    {
        Response::abort(501, 'Aceite digital será implementado no passo 4.');
    }

    public function requestChange(Request $req, array $params): void
    {
        Response::abort(501, 'Solicitação de alteração será implementada no passo 4.');
    }

    public function decline(Request $req, array $params): void
    {
        Response::abort(501, 'Recusa será implementada no passo 4.');
    }

    public function briefing(Request $req, array $params): void
    {
        Response::abort(501, 'Briefing público será implementado no passo 6.');
    }

    public function briefingSave(Request $req, array $params): void
    {
        Response::abort(501, 'Autosave de briefing será implementado no passo 6.');
    }

    public function briefingSubmit(Request $req, array $params): void
    {
        Response::abort(501, 'Envio de briefing será implementado no passo 6.');
    }
}
