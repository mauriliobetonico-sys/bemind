<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Money;
use App\Core\Request;
use App\Core\Response;
use App\Core\Sanitize;
use App\Core\Session;
use App\Core\Url;
use App\Core\View;
use App\Models\ActivityLog;
use App\Models\Client;
use App\Models\CompanySettings;
use App\Models\Notification;
use App\Models\Proposal;
use App\Models\Service;
use App\Services\Mailer;
use App\Services\Numbering;
use App\Services\Pdf;
use App\Services\Totals;
use App\Services\Whatsapp;

final class ProposalsController extends Controller
{
    /* -------------------- Lista -------------------- */

    public function index(Request $req): void
    {
        Acl::require('proposals.view');
        $status = (string)($req->query['status'] ?? '');
        $q      = trim((string)($req->query['q'] ?? ''));
        $items  = Proposal::all($status ?: null, $q ?: null);
        $this->view('proposals.index', [
            'items'=>$items,'status'=>$status,'q'=>$q,'user'=>Session::user(),
        ], 'layout.app');
    }

    /* -------------------- Express -------------------- */

    public function express(Request $req): void
    {
        Acl::require('proposals.create');
        $clientId = isset($req->query['client_id']) ? (int)$req->query['client_id'] : null;
        $this->view('proposals.express', [
            'clients'    => Client::all(null, 200),
            'services'   => Service::byCategory(null),
            'categories' => Service::categories(),
            'selectedClient' => $clientId,
            'user'       => Session::user(),
        ], 'layout.app');
    }

    public function expressStore(Request $req): void
    {
        Acl::require('proposals.create');
        $this->assertCsrf($req);

        $clientId = (int)($req->post['client_id'] ?? 0);
        $serviceId= (int)($req->post['service_id'] ?? 0);
        $valor    = Money::parse((string)($req->post['valor'] ?? '0'));
        $validity = (int)($req->post['validity'] ?? 15);
        $cond     = (string)($req->post['condition'] ?? '50/50');

        if ($clientId <= 0 || $valor <= 0) {
            $this->redirect('/proposals/express');
        }
        $service = $serviceId ? Service::find($serviceId) : null;
        $number  = Numbering::proposal();
        $token   = Numbering::publicToken();

        $id = Proposal::create([
            'number'=>$number,'public_token'=>$token,
            'client_id'=>$clientId,'user_id'=>Session::user()['id']??null,
            'title'=>'Proposta Express',
            'project'=>$service['name'] ?? null,
            'summary'=>$service['short_description'] ?? null,
            'status'=>'rascunho','issue_date'=>date('Y-m-d'),
            'valid_until'=>date('Y-m-d', strtotime("+{$validity} days")),
            'payment_terms'=>$cond,
            'terms_text'=>null,'discount_percent'=>0,
        ]);

        Proposal::addItem($id, [
            'service_id'=>$service['id'] ?? null,
            'name'=>$service['name'] ?? 'Serviço',
            'description'=>$service['short_description'] ?? null,
            'quantity'=>1,'unit_price'=>$valor,'discount_percent'=>0,
            'recurrence'=>$service['recurrence'] ?? 'unico','sort_order'=>0,
        ]);
        Totals::recompute($id);
        ActivityLog::log('created', 'proposal', $id, ['channel'=>'express']);

        $this->redirect('/proposals/' . $id . '/done');
    }

    public function done(Request $req, array $p): void
    {
        Acl::require('proposals.view');
        $prop = Proposal::find((int)$p['id']);
        if (!$prop) $this->redirect('/proposals');
        $this->view('proposals.done', [
            'p'=>$prop, 'link'=>Url::proposal($prop['public_token']),
            'wa'=>Whatsapp::proposalMessage($prop, Url::proposal($prop['public_token'])),
            'user'=>Session::user(),
        ], 'layout.app');
    }

    /* -------------------- Wizard -------------------- */

    public function wizard(Request $req, array $p = []): void
    {
        Acl::require('proposals.create');
        $id = isset($p['id']) ? (int)$p['id'] : null;
        $proposal = $id ? Proposal::find($id) : null;
        if ($id && !$proposal) $this->redirect('/proposals');

        $this->view('proposals.wizard', [
            'proposal'   => $proposal,
            'items'      => $proposal ? Proposal::items((int)$proposal['id']) : [],
            'clients'    => Client::all(null, 200),
            'services'   => Service::byCategory(null),
            'categories' => Service::categories(),
            'step'       => (int)($req->query['step'] ?? 0),
            'user'       => Session::user(),
        ], 'layout.app');
    }

    public function wizardStep(Request $req): void
    {
        Acl::require('proposals.create');
        $this->assertCsrf($req);

        $step     = (int)($req->post['step'] ?? 0);
        $id       = (int)($req->post['proposal_id'] ?? 0);
        $clientId = (int)($req->post['client_id'] ?? 0);
        $discount = (float)($req->post['discount_percent'] ?? 0);
        $terms    = trim((string)($req->post['terms_text'] ?? ''));
        $pay      = trim((string)($req->post['payment_terms'] ?? ''));
        $validity = (int)($req->post['validity_days'] ?? 15);
        $projTitle= trim((string)($req->post['project'] ?? ''));

        if (!$id && $clientId) {
            $id = Proposal::create([
                'number'=>Numbering::proposal(),'public_token'=>Numbering::publicToken(),
                'client_id'=>$clientId,'user_id'=>Session::user()['id']??null,
                'title'=>$projTitle ?: 'Proposta comercial','project'=>$projTitle ?: null,
                'summary'=>null,'status'=>'rascunho','issue_date'=>date('Y-m-d'),
                'valid_until'=>date('Y-m-d', strtotime("+{$validity} days")),
                'payment_terms'=>$pay ?: null,'terms_text'=>$terms ?: null,
                'discount_percent'=>$discount,
            ]);
            ActivityLog::log('created', 'proposal', $id, ['channel'=>'wizard']);
        } elseif ($id) {
            Proposal::update($id, [
                'client_id'=>$clientId ?: null,
                'project'=>$projTitle ?: null,
                'title'=>$projTitle ?: 'Proposta comercial',
                'discount_percent'=>$discount,
                'payment_terms'=>$pay ?: null,
                'terms_text'=>$terms ?: null,
                'valid_until'=>date('Y-m-d', strtotime("+{$validity} days")),
            ]);
        }

        if ($id) Totals::recompute($id);

        if ($step >= 3 && $id) $this->redirect('/proposals/' . $id);
        $next = min(3, $step + 1);
        $this->redirect('/proposals/' . ($id ?: '') . '/wizard?step=' . $next);
    }

    /* -------------------- Detalhe / update -------------------- */

    public function show(Request $req, array $p): void
    {
        Acl::require('proposals.view');
        $id   = (int)$p['id'];
        $prop = Proposal::find($id);
        if (!$prop) $this->redirect('/proposals');

        $this->view('proposals.show', [
            'p'         => $prop,
            'items'     => Proposal::items($id),
            'views'     => Proposal::views($id, 10),
            'acceptance'=> Proposal::acceptance($id),
            'schedule'  => Proposal::schedule($id),
            'link'      => Url::proposal($prop['public_token']),
            'wa'        => Whatsapp::proposalMessage($prop, Url::proposal($prop['public_token'])),
            'user'      => Session::user(),
        ], 'layout.app');
    }

    public function update(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $this->assertCsrf($req);
        $id = (int)$p['id'];
        Proposal::update($id, [
            'title'           => trim((string)($req->post['title'] ?? '')),
            'project'         => trim((string)($req->post['project'] ?? '')) ?: null,
            'summary'         => trim((string)($req->post['summary'] ?? '')) ?: null,
            'valid_until'     => $req->post['valid_until'] ?? null,
            'payment_terms'   => trim((string)($req->post['payment_terms'] ?? '')) ?: null,
            'terms_text'      => Sanitize::html((string)($req->post['terms_text'] ?? '')),
            'discount_percent'=> (float)($req->post['discount_percent'] ?? 0),
        ]);
        Totals::recompute($id);
        ActivityLog::log('updated', 'proposal', $id);
        $this->redirect('/proposals/' . $id);
    }

    /* -------------------- Autosave (JSON) -------------------- */

    public function autosave(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        // aceita PATCH pelo header X-CSRF-Token
        $t = $req->post['_csrf'] ?? $req->server['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!\App\Core\Csrf::check((string)$t)) $this->json(['ok'=>false,'error'=>'csrf'], 419);
        $id = (int)$p['id'];
        $data = [];
        foreach (['title','project','summary','payment_terms','terms_text','valid_until','discount_percent'] as $f) {
            if (array_key_exists($f, $req->post)) $data[$f] = $req->post[$f];
        }
        if (isset($data['discount_percent'])) $data['discount_percent'] = (float)$data['discount_percent'];
        if (isset($data['terms_text']))        $data['terms_text']       = Sanitize::html((string)$data['terms_text']);
        if ($data) Proposal::update($id, $data);
        $t = Totals::recompute($id);
        $this->json(['ok'=>true,'saved_at'=>date('c'),'totals'=>$t]);
    }

    /* -------------------- Envio / duplicar / arquivar / renovar -------------------- */

    public function send(Request $req, array $p): void
    {
        Acl::require('proposals.send');
        $this->assertCsrf($req);
        $id = (int)$p['id'];
        $channel = (string)($req->post['channel'] ?? 'link');
        $prop = Proposal::find($id);
        if (!$prop) $this->redirect('/proposals');

        Proposal::markSent($id);
        ActivityLog::log('sent', 'proposal', $id, ['channel'=>$channel]);
        Notification::create(Session::user()['id']??null, 'envio',
            'Proposta enviada', $prop['number'] . ' → ' . $prop['client_name'],
            'proposal', $id);

        if ($channel === 'email' && !empty($prop['client_email'])) {
            $link = Url::proposal($prop['public_token']);
            $body = '<p>Olá, ' . htmlspecialchars($prop['client_name']) . '.</p>'
                  . '<p>Segue nossa proposta ' . htmlspecialchars($prop['number']) . ':</p>'
                  . '<p><a href="' . $link . '">Abrir proposta</a></p>'
                  . '<p>— Be Mind Marketing</p>';
            Mailer::send($prop['client_email'], 'Sua proposta ' . $prop['number'], $body);
        }
        $this->redirect('/proposals/' . $id);
    }

    public function duplicate(Request $req, array $p): void
    {
        Acl::require('proposals.create');
        $this->assertCsrf($req);
        $newId = Proposal::duplicate((int)$p['id'], Numbering::proposal(), Numbering::publicToken());
        \App\Services\Totals::recompute($newId);
        ActivityLog::log('duplicated', 'proposal', $newId, ['from'=>(int)$p['id']]);
        $this->redirect('/proposals/' . $newId);
    }

    public function archive(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $this->assertCsrf($req);
        Proposal::archive((int)$p['id'], true);
        ActivityLog::log('archived', 'proposal', (int)$p['id']);
        $this->redirect('/proposals');
    }

    public function renew(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $this->assertCsrf($req);
        $days = (int)($req->post['days'] ?? 15);
        Proposal::renewValidity((int)$p['id'], $days);
        ActivityLog::log('renewed', 'proposal', (int)$p['id'], ['days'=>$days]);
        $this->redirect('/proposals/' . (int)$p['id']);
    }

    /* -------------------- PDF / Preview -------------------- */

    public function preview(Request $req, array $p): void
    {
        Acl::require('proposals.view');
        $prop = Proposal::find((int)$p['id']);
        if (!$prop) Response::abort(404);
        // Reaproveita a view pública com "preview_mode" (não registra view).
        $this->renderPublic($prop, previewMode: true);
    }

    public function pdf(Request $req, array $p): void
    {
        Acl::require('proposals.view');
        $prop = Proposal::find((int)$p['id']);
        if (!$prop) Response::abort(404);

        ob_start();
        $this->renderPublic($prop, previewMode: true, printMode: true);
        $html = (string)ob_get_clean();

        $out = Pdf::fromHtml($html, 'proposta-' . preg_replace('/[^\w-]+/', '', $prop['number']));
        header('Content-Type: ' . $out['mime']);
        header('Content-Disposition: inline; filename="' . $out['name'] . '"');
        echo $out['bytes'];
    }

    /**
     * Renderiza a view pública (também usada pelo PublicController).
     * Centralizada aqui para reutilizar do PDF e preview interno.
     */
    private function renderPublic(array $prop, bool $previewMode = false, bool $printMode = false): void
    {
        $items    = Proposal::items((int)$prop['id']);
        $schedule = Proposal::schedule((int)$prop['id']);
        $settings = CompanySettings::get();

        $data = compact('prop','items','schedule','settings','previewMode','printMode');
        \App\Core\View::display('public.proposal', $data, 'layout.public');
    }
}
