<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Request;
use App\Core\Sanitize;
use App\Core\Session;
use App\Core\Url;
use App\Models\ActivityLog;
use App\Models\Briefing;
use App\Models\Client;
use App\Models\Proposal;
use App\Models\Service;
use App\Services\Numbering;
use App\Services\Totals;
use App\Services\Whatsapp;

final class BriefingsController extends Controller
{
    public function index(Request $req): void
    {
        Acl::require('briefings.view');
        $status = (string)($req->query['status'] ?? '');
        $this->view('briefings.index', [
            'items'=>Briefing::all($status ?: null), 'status'=>$status, 'user'=>Session::user(),
        ], 'layout.app');
    }

    public function create(Request $req): void
    {
        Acl::require('briefings.create');
        $this->view('briefings.form', ['clients'=>Client::all(), 'user'=>Session::user()], 'layout.app');
    }

    public function store(Request $req): void
    {
        Acl::require('briefings.create');
        $this->assertCsrf($req);
        $id = Briefing::create([
            'number'=>Numbering::briefing(),'public_token'=>Numbering::publicToken(),
            'client_id'=>(int)($req->post['client_id'] ?? 0) ?: null,
            'contact_name'=>trim((string)($req->post['contact_name'] ?? '')) ?: null,
            'contact_email'=>Sanitize::email((string)($req->post['contact_email'] ?? '')),
            'kind'=>trim((string)($req->post['kind'] ?? '')) ?: null,
            'status'=>'aguardando','total_questions'=>12,
        ]);
        ActivityLog::log('created','briefing',$id);
        $this->redirect('/briefings/' . $id);
    }

    public function show(Request $req, array $p): void
    {
        Acl::require('briefings.view');
        $id = (int)$p['id'];
        $br = Briefing::find($id);
        if (!$br) $this->redirect('/briefings');
        $qs   = Briefing::questions();
        $ans  = Briefing::answers($id);
        $link = Url::briefing($br['public_token']);
        $wa   = Whatsapp::briefingMessage($br, $link);

        // Sugestão simples: mapeia respostas de "serviços de interesse" (question 10) para serviços da biblioteca.
        $suggested = [];
        if (!empty($ans[10])) {
            $picks = json_decode($ans[10], true) ?: [];
            $map = [
                'Redes sociais'      => ['Gestão de Redes Sociais'],
                'Vídeo'              => ['Produção de Vídeo (mensal)'],
                'Identidade visual'  => ['Identidade Visual'],
                'Site'               => ['Site Institucional','Landing Page'],
                'Tráfego pago'       => ['Tráfego Pago'],
                'Hospedagem'         => ['Hospedagem Profissional'],
            ];
            $all = Service::byCategory(null);
            $wanted = [];
            foreach ($picks as $pick) foreach ($map[$pick] ?? [] as $name) $wanted[$name] = true;
            foreach ($all as $svc) if (isset($wanted[$svc['name']])) $suggested[] = $svc;
        }

        $this->view('briefings.show', [
            'br'=>$br,'questions'=>$qs,'answers'=>$ans,'suggested'=>$suggested,
            'link'=>$link,'wa'=>$wa,'user'=>Session::user(),
        ], 'layout.app');
    }

    public function toProposal(Request $req, array $p): void
    {
        Acl::require('proposals.create');
        $this->assertCsrf($req);
        $id = (int)$p['id'];
        $br = Briefing::find($id);
        if (!$br) $this->redirect('/briefings');

        // Cria proposta (rascunho) já com os serviços sugeridos.
        $clientId = (int)($br['client_id'] ?? 0);
        if (!$clientId) {
            // cria cliente rápido pelo contato do briefing
            $clientId = Client::create([
                'company_name' => $br['contact_name'] ?: 'Cliente do briefing ' . $br['number'],
                'email'        => $br['contact_email'] ?? null,
                'segment'      => $br['kind'] ?? null,
            ]);
        }
        $number = Numbering::proposal();
        $token  = Numbering::publicToken();
        $pid = Proposal::create([
            'number'=>$number,'public_token'=>$token,
            'client_id'=>$clientId,'user_id'=>Session::user()['id']??null,
            'title'=>'Proposta a partir do briefing ' . $br['number'],
            'project'=>$br['kind'] ?? null,
            'summary'=>'Escopo sugerido pelas respostas do briefing.',
            'status'=>'rascunho','issue_date'=>date('Y-m-d'),
            'valid_until'=>date('Y-m-d', strtotime('+15 days')),
            'payment_terms'=>'50/50','terms_text'=>null,'discount_percent'=>0,
        ]);

        // adiciona os serviços sugeridos
        $ans = Briefing::answers($id);
        if (!empty($ans[10])) {
            $picks = json_decode($ans[10], true) ?: [];
            $map = ['Redes sociais'=>'Gestão de Redes Sociais','Vídeo'=>'Produção de Vídeo (mensal)',
                    'Identidade visual'=>'Identidade Visual','Site'=>'Site Institucional',
                    'Tráfego pago'=>'Tráfego Pago','Hospedagem'=>'Hospedagem Profissional'];
            $all = Service::byCategory(null);
            $byName = []; foreach ($all as $s) $byName[$s['name']] = $s;
            foreach ($picks as $pick) {
                $name = $map[$pick] ?? null;
                if ($name && isset($byName[$name])) {
                    $s = $byName[$name];
                    Proposal::addItem($pid, [
                        'service_id'=>(int)$s['id'],'name'=>$s['name'],'description'=>$s['short_description'] ?? null,
                        'quantity'=>1,'unit_price'=>(float)$s['default_price'],'discount_percent'=>0,
                        'recurrence'=>$s['recurrence'],'sort_order'=>0,
                    ]);
                }
            }
        }
        Totals::recompute($pid);
        ActivityLog::log('from_briefing', 'proposal', $pid, ['briefing_id'=>$id]);

        // abre o wizard no passo 1 (Escopo) para o comercial revisar
        $this->redirect('/proposals/' . $pid . '/wizard?step=1');
    }
}
