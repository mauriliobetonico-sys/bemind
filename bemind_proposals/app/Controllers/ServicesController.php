<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Request;
use App\Core\Session;
use App\Models\ActivityLog;
use App\Models\Service;

final class ServicesController extends Controller
{
    public function index(Request $req): void
    {
        Acl::require('services.view');
        $catId = isset($req->query['cat']) ? (int)$req->query['cat'] : null;
        $this->view('services.index', [
            'categories' => Service::categories(),
            'services'   => Service::byCategory($catId),
            'currentCat' => $catId,
            'user'       => Session::user(),
        ], 'layout.app');
    }

    public function create(Request $req): void
    {
        Acl::require('services.create');
        $this->view('services.form', ['s'=>[],'categories'=>Service::categories(),'user'=>Session::user()], 'layout.app');
    }

    public function edit(Request $req, array $p): void
    {
        Acl::require('services.update');
        $s = Service::find((int)$p['id']);
        if (!$s) $this->redirect('/services');
        $this->view('services.form', ['s'=>$s,'categories'=>Service::categories(),'user'=>Session::user()], 'layout.app');
    }

    public function store(Request $req): void
    {
        Acl::require('services.create');
        $this->assertCsrf($req);
        $id = Service::create($this->clean($req->post));
        ActivityLog::log('created', 'service', $id);
        $this->redirect('/services');
    }

    public function update(Request $req, array $p): void
    {
        Acl::require('services.update');
        $this->assertCsrf($req);
        Service::update((int)$p['id'], $this->clean($req->post));
        ActivityLog::log('updated', 'service', (int)$p['id']);
        $this->redirect('/services');
    }

    public function apiIndex(Request $req): void
    {
        Acl::require('services.view');
        $catId = isset($req->query['category']) ? (int)$req->query['category'] : null;
        $rows  = array_map(fn($r)=>[
            'id'=>(int)$r['id'],'name'=>$r['name'],'category_id'=>(int)$r['category_id'],
            'category_slug'=>$r['category_slug']??null,'category_name'=>$r['category_name']??null,
            'default_price'=>(float)$r['default_price'],'unit'=>$r['unit'],'recurrence'=>$r['recurrence'],
            'short_description'=>$r['short_description'],
        ], Service::byCategory($catId));
        $this->json(['data'=>$rows]);
    }

    private function clean(array $in): array
    {
        return [
            'category_id'       => (int)($in['category_id'] ?? 0),
            'name'              => trim((string)($in['name'] ?? '')),
            'short_description' => trim((string)($in['short_description'] ?? '')) ?: null,
            'full_description'  => trim((string)($in['full_description']  ?? '')) ?: null,
            'deliverables'      => array_values(array_filter(array_map('trim', explode("\n", (string)($in['deliverables'] ?? ''))))),
            'lead_time'         => trim((string)($in['lead_time'] ?? '')) ?: null,
            'default_price'     => \App\Core\Money::parse((string)($in['default_price'] ?? '0')),
            'unit'              => (string)($in['unit'] ?? 'projeto'),
            'recurrence'        => (string)($in['recurrence'] ?? 'unico'),
            'active'            => !empty($in['active']) ? 1 : 0,
            'sort_order'        => (int)($in['sort_order'] ?? 0),
        ];
    }
}
