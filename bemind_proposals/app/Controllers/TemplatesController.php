<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Request;
use App\Core\Session;
use App\Models\ActivityLog;
use App\Models\Proposal;
use App\Models\ProposalTemplate;
use App\Services\Numbering;
use App\Services\Totals;

final class TemplatesController extends Controller
{
    public function index(Request $req): void
    {
        Acl::require('proposals.view');
        $this->view('templates.index', [
            'items'=>ProposalTemplate::all(),'user'=>Session::user(),
        ], 'layout.app');
    }

    public function saveFromProposal(Request $req, array $p): void
    {
        Acl::require('proposals.create');
        $this->assertCsrf($req);
        $pid = (int)$p['proposalId'];
        $prop = Proposal::find($pid);
        if (!$prop) $this->redirect('/proposals');

        $payload = [
            'title'=>$prop['title'],'project'=>$prop['project'],'summary'=>$prop['summary'],
            'discount_percent'=>(float)$prop['discount_percent'],
            'payment_terms'=>$prop['payment_terms'],'terms_text'=>$prop['terms_text'],
            'items'=>array_map(fn($it)=>[
                'service_id'=>$it['service_id'] ? (int)$it['service_id'] : null,
                'name'=>$it['name'],'description'=>$it['description'],
                'deliverables'=>$it['deliverables'],'lead_time'=>$it['lead_time'],
                'quantity'=>(int)$it['quantity'],'unit_price'=>(float)$it['unit_price'],
                'discount_percent'=>(float)$it['discount_percent'],
                'recurrence'=>$it['recurrence'],'sort_order'=>(int)$it['sort_order'],
            ], Proposal::items($pid)),
            'schedule'=>array_map(fn($s)=>['phase'=>$s['phase'],'period'=>$s['period']], Proposal::schedule($pid)),
        ];
        $name = trim((string)($req->post['name'] ?? '')) ?: $prop['title'];
        $id = ProposalTemplate::create($name, $payload, Session::user()['id'] ?? null);
        ActivityLog::log('created','template',$id,['from'=>$pid]);
        $this->redirect('/templates');
    }

    public function newProposal(Request $req, array $p): void
    {
        Acl::require('proposals.create');
        $tpl = ProposalTemplate::find((int)$p['id']);
        if (!$tpl) $this->redirect('/templates');
        $payload = json_decode($tpl['payload'], true) ?: [];

        $clientId = (int)($req->query['client_id'] ?? 0);
        if (!$clientId) {
            // Sem cliente: manda para o wizard para escolher e depois aplicamos o template.
            $_SESSION['pending_template'] = (int)$tpl['id'];
            $this->redirect('/proposals/new?tpl=' . (int)$tpl['id']);
        }
        $pid = Proposal::create([
            'number'=>Numbering::proposal(),'public_token'=>Numbering::publicToken(),
            'client_id'=>$clientId,'user_id'=>Session::user()['id']??null,
            'title'=>$payload['title'] ?? 'Proposta',
            'project'=>$payload['project'] ?? null,'summary'=>$payload['summary'] ?? null,
            'status'=>'rascunho','issue_date'=>date('Y-m-d'),
            'valid_until'=>date('Y-m-d', strtotime('+15 days')),
            'payment_terms'=>$payload['payment_terms'] ?? '50/50',
            'terms_text'=>$payload['terms_text'] ?? null,
            'discount_percent'=>(float)($payload['discount_percent'] ?? 0),
        ]);
        foreach ($payload['items'] ?? [] as $it) Proposal::addItem($pid, $it);
        if (!empty($payload['schedule'])) Proposal::setSchedule($pid, $payload['schedule']);
        Totals::recompute($pid);
        ActivityLog::log('from_template','proposal',$pid,['template_id'=>$tpl['id']]);
        $this->redirect('/proposals/' . $pid);
    }

    public function destroy(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $this->assertCsrf($req);
        ProposalTemplate::delete((int)$p['id']);
        $this->redirect('/templates');
    }
}
