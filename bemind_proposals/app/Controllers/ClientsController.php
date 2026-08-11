<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Request;
use App\Core\Sanitize;
use App\Core\Session;
use App\Models\ActivityLog;
use App\Models\Client;

final class ClientsController extends Controller
{
    public function index(Request $req): void
    {
        Acl::require('clients.view');
        $q       = trim((string)($req->query['q'] ?? ''));
        $clients = Client::all($q ?: null);
        $this->view('clients.index', ['clients'=>$clients,'q'=>$q,'user'=>Session::user()], 'layout.app');
    }

    public function create(Request $req): void
    {
        Acl::require('clients.create');
        $this->view('clients.form', ['c'=>[],'user'=>Session::user()], 'layout.app');
    }

    public function edit(Request $req, array $p): void
    {
        Acl::require('clients.update');
        $c = Client::find((int)$p['id']);
        if (!$c) $this->redirect('/clients');
        $this->view('clients.form', ['c'=>$c,'user'=>Session::user()], 'layout.app');
    }

    public function store(Request $req): void
    {
        Acl::require('clients.create');
        $this->assertCsrf($req);
        $id = Client::create($this->clean($req->post));
        ActivityLog::log('created', 'client', $id, ['company'=>$req->post['company_name'] ?? '']);
        $this->redirect('/clients/' . $id);
    }

    public function update(Request $req, array $p): void
    {
        Acl::require('clients.update');
        $this->assertCsrf($req);
        $id = (int)$p['id'];
        Client::update($id, $this->clean($req->post));
        ActivityLog::log('updated', 'client', $id);
        $this->redirect('/clients/' . $id);
    }

    public function show(Request $req, array $p): void
    {
        Acl::require('clients.view');
        $id = (int)$p['id'];
        $c = Client::find($id);
        if (!$c) $this->redirect('/clients');
        $this->view('clients.show', [
            'c'=>$c,'stats'=>Client::stats($id),'proposals'=>Client::recentProposals($id, 5),
            'user'=>Session::user(),
        ], 'layout.app');
    }

    /* ---------- API JSON (usadas pelo Express/Wizard) ---------- */

    public function apiIndex(Request $req): void
    {
        Acl::require('clients.view');
        $q = trim((string)($req->query['q'] ?? ''));
        $rows = array_map(fn($r) => [
            'id'=>(int)$r['id'],'company_name'=>$r['company_name'],
            'trade_name'=>$r['trade_name'],'segment'=>$r['segment'],
            'doc'=>$r['doc'],'contact_name'=>$r['contact_name'],
        ], Client::all($q ?: null, 100));
        $this->json(['data'=>$rows]);
    }

    public function apiStore(Request $req): void
    {
        Acl::require('clients.create');
        $this->assertCsrf($req);
        $id = Client::create($this->clean($req->post));
        ActivityLog::log('created', 'client', $id);
        $this->json(['id'=>$id, 'client'=>Client::find($id)], 201);
    }

    private function clean(array $in): array
    {
        return [
            'company_name' => trim((string)($in['company_name'] ?? '')),
            'trade_name'   => trim((string)($in['trade_name']   ?? '')) ?: null,
            'doc'          => Sanitize::digits((string)($in['doc'] ?? '')) ?: null,
            'contact_name' => trim((string)($in['contact_name'] ?? '')) ?: null,
            'email'        => Sanitize::email((string)($in['email'] ?? '')),
            'phone'        => trim((string)($in['phone']    ?? '')) ?: null,
            'whatsapp'     => Sanitize::digits((string)($in['whatsapp'] ?? '')) ?: null,
            'address'      => trim((string)($in['address']  ?? '')) ?: null,
            'city'         => trim((string)($in['city']     ?? '')) ?: null,
            'state'        => strtoupper(trim((string)($in['state'] ?? ''))) ?: null,
            'segment'      => trim((string)($in['segment']  ?? '')) ?: null,
            'notes'        => trim((string)($in['notes']    ?? '')) ?: null,
        ];
    }
}
