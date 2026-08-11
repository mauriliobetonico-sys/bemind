<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Controller;
use App\Core\Csrf;
use App\Core\RateLimit;
use App\Core\Request;
use App\Core\Response;
use App\Core\Sanitize;
use App\Core\View;
use App\Models\ActivityLog;
use App\Models\Briefing;
use App\Models\CompanySettings;
use App\Models\Notification;
use App\Models\Proposal;
use App\Services\Mailer;
use App\Services\Tracking;

final class PublicController extends Controller
{
    /* -------------------- Proposta pública -------------------- */

    public function proposal(Request $req, array $params): void
    {
        $prop = Proposal::findByToken((string)$params['token']);
        if (!$prop) Response::abort(404, 'Proposta não encontrada.');

        // Expira somente na apresentação; aceite/negocia checa novamente.
        $expired = $prop['valid_until'] && $prop['valid_until'] < date('Y-m-d');

        Tracking::registerView((int)$prop['id'], $req->ip(), $req->userAgent(),
            (string)($req->server['HTTP_REFERER'] ?? ''));

        $items    = Proposal::items((int)$prop['id']);
        $schedule = Proposal::schedule((int)$prop['id']);
        $settings = CompanySettings::get();
        $acceptance = Proposal::acceptance((int)$prop['id']);

        View::display('public.proposal', [
            'prop'=>$prop,'items'=>$items,'schedule'=>$schedule,'settings'=>$settings,
            'expired'=>$expired,'acceptance'=>$acceptance,'previewMode'=>false,'printMode'=>false,
        ], 'layout.public');
    }

    /* -------------------- Aceite -------------------- */

    public function accept(Request $req, array $params): void
    {
        RateLimit::hit('accept', 10, 60);
        if (!Csrf::check((string)($req->post['_csrf'] ?? ''))) Response::abort(419);

        $prop = Proposal::findByToken((string)$params['token']);
        if (!$prop) Response::abort(404);
        if ($prop['valid_until'] && $prop['valid_until'] < date('Y-m-d'))
            Response::abort(409, 'Esta proposta expirou.');
        if (empty($req->post['terms'])) Response::abort(422, 'É necessário concordar com os termos.');

        $name  = trim((string)($req->post['name']  ?? ''));
        $email = Sanitize::email((string)($req->post['email'] ?? ''));
        $doc   = Sanitize::digits((string)($req->post['doc']   ?? ''));
        if ($name === '' || !$email || $doc === '') Response::abort(422, 'Preencha nome, e-mail e CPF/CNPJ.');

        Proposal::recordAcceptance((int)$prop['id'], [
            'name'=>$name,'email'=>$email,'doc'=>$doc,
            'ip'=>$req->ip(),'user_agent'=>$req->userAgent(),
            'terms_version'=>'v1',
        ]);
        Proposal::setStatus((int)$prop['id'], 'aprovada');
        Notification::create($prop['user_id']??null, 'aprovacao',
            'Proposta aprovada!',
            sprintf('%s aceitou a proposta %s.', $name, $prop['number']),
            'proposal', (int)$prop['id']);
        ActivityLog::log('accepted', 'proposal', (int)$prop['id'], ['name'=>$name,'email'=>$email,'ip'=>$req->ip()]);

        $cfg = CompanySettings::get();
        if (!empty($cfg['email'])) {
            Mailer::send($cfg['email'], 'Proposta aprovada: ' . $prop['number'],
                "<p>Boa notícia: <strong>{$name}</strong> aceitou a proposta <strong>{$prop['number']}</strong>.</p>"
                . "<p>Cliente: {$prop['client_name']} · IP: {$req->ip()}</p>");
        }
        if ($email) {
            Mailer::send($email, 'Registro do aceite — ' . $prop['number'],
                "<p>Olá, {$name}. Recebemos o aceite da proposta {$prop['number']}.</p>"
                . "<p>Data: " . date('d/m/Y H:i') . "</p>"
                . "<p>Obrigado — Be Mind Marketing</p>");
        }

        View::display('public.accepted', [
            'prop'=>$prop,'settings'=>CompanySettings::get(),
            'name'=>$name,'email'=>$email,'doc'=>$doc,'ip'=>$req->ip(),
        ], 'layout.public');
    }

    public function requestChange(Request $req, array $params): void
    {
        RateLimit::hit('request-change', 10, 60);
        if (!Csrf::check((string)($req->post['_csrf'] ?? ''))) Response::abort(419);
        $prop = Proposal::findByToken((string)$params['token']);
        if (!$prop) Response::abort(404);

        Proposal::recordRequest((int)$prop['id'], 'alteracao', [
            'name'=>trim((string)($req->post['name'] ?? '—')),
            'email'=>Sanitize::email((string)($req->post['email'] ?? '')),
            'message'=>trim((string)($req->post['message'] ?? '')),
        ]);
        Proposal::setStatus((int)$prop['id'], 'alteracao');
        Notification::create($prop['user_id']??null, 'alteracao',
            'Cliente pediu alteração', $prop['number'] . ' — ' . ($prop['client_name']),
            'proposal', (int)$prop['id']);
        ActivityLog::log('change_requested', 'proposal', (int)$prop['id']);

        View::display('public.ack', [
            'title'=>'Recebemos seu pedido',
            'message'=>'Vamos ajustar e enviar uma nova versão em breve.',
        ], 'layout.public');
    }

    public function decline(Request $req, array $params): void
    {
        RateLimit::hit('decline', 10, 60);
        if (!Csrf::check((string)($req->post['_csrf'] ?? ''))) Response::abort(419);
        $prop = Proposal::findByToken((string)$params['token']);
        if (!$prop) Response::abort(404);

        Proposal::recordRequest((int)$prop['id'], 'recusa', [
            'name'=>trim((string)($req->post['name'] ?? '—')),
            'email'=>Sanitize::email((string)($req->post['email'] ?? '')),
            'message'=>trim((string)($req->post['message'] ?? '')),
        ]);
        Proposal::setStatus((int)$prop['id'], 'recusada');
        Notification::create($prop['user_id']??null, 'recusa',
            'Proposta recusada', $prop['number'],
            'proposal', (int)$prop['id']);
        ActivityLog::log('declined', 'proposal', (int)$prop['id']);

        View::display('public.ack', [
            'title'=>'Registrado',
            'message'=>'Obrigado pelo retorno. Se quiser retomar, é só chamar por WhatsApp.',
        ], 'layout.public');
    }

    /* -------------------- Briefing público -------------------- */

    public function briefing(Request $req, array $params): void
    {
        $br = Briefing::findByToken((string)$params['token']);
        if (!$br) Response::abort(404, 'Briefing não encontrado.');
        Briefing::markViewed((int)$br['id']);

        View::display('public.briefing', [
            'br'=>$br,'questions'=>Briefing::questions(),
            'answers'=>Briefing::answers((int)$br['id']),
            'step'=>max(0, min(3, (int)($req->query['step'] ?? 0))),
            'settings'=>CompanySettings::get(),
        ], 'layout.public');
    }

    public function briefingSave(Request $req, array $params): void
    {
        RateLimit::hit('briefing-save', 60, 60);
        if (!Csrf::check((string)($req->post['_csrf'] ?? ''))) $this->json(['ok'=>false,'error'=>'csrf'], 419);
        $br = Briefing::findByToken((string)$params['token']);
        if (!$br) $this->json(['ok'=>false], 404);

        $answers = $req->post['a'] ?? [];
        foreach ((array)$answers as $qid => $value) Briefing::saveAnswer((int)$br['id'], (int)$qid, $value);
        $this->json(['ok'=>true,'saved_at'=>date('c')]);
    }

    public function briefingSubmit(Request $req, array $params): void
    {
        RateLimit::hit('briefing-submit', 5, 300);
        if (!Csrf::check((string)($req->post['_csrf'] ?? ''))) Response::abort(419);
        $br = Briefing::findByToken((string)$params['token']);
        if (!$br) Response::abort(404);

        $answers = $req->post['a'] ?? [];
        foreach ((array)$answers as $qid => $value) Briefing::saveAnswer((int)$br['id'], (int)$qid, $value);
        Briefing::submit((int)$br['id'], count(Briefing::answers((int)$br['id'])));
        Notification::create(null, 'info',
            'Briefing respondido', $br['number'],
            'briefing', (int)$br['id']);
        ActivityLog::log('briefing_submitted', 'briefing', (int)$br['id']);

        View::display('public.ack', [
            'title'=>'Briefing recebido ✓',
            'message'=>'Obrigado! Vamos montar a sua proposta com base nas respostas.',
        ], 'layout.public');
    }
}
