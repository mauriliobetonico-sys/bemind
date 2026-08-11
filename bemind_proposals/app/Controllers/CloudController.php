<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Money;
use App\Core\Request;
use App\Core\Session;
use App\Models\ActivityLog;
use App\Models\CloudPlan;

final class CloudController extends Controller
{
    public function index(Request $req): void
    {
        Acl::require('cloud.view');
        $this->view('cloud.index', ['plans'=>CloudPlan::all(),'user'=>Session::user()], 'layout.app');
    }

    public function edit(Request $req, array $p): void
    {
        Acl::require('cloud.update');
        $plan = CloudPlan::find((int)$p['id']);
        if (!$plan) $this->redirect('/cloud');
        $this->view('cloud.form', ['plan'=>$plan,'user'=>Session::user()], 'layout.app');
    }

    public function update(Request $req, array $p): void
    {
        Acl::require('cloud.update');
        $this->assertCsrf($req);
        $id = (int)$p['id'];
        CloudPlan::update($id, [
            'name'          => trim((string)($req->post['name'] ?? '')),
            'monthly_price' => Money::parse((string)($req->post['monthly_price'] ?? '0')),
            'annual_price'  => Money::parse((string)($req->post['annual_price']  ?? '0')),
            'min_price'     => Money::parse((string)($req->post['min_price']     ?? '150')),
            'disk'      => $req->post['disk']      ?? null,
            'traffic'   => $req->post['traffic']   ?? null,
            'sites'     => $req->post['sites']     ?? null,
            'mailboxes' => $req->post['mailboxes'] ?? null,
            'databases' => $req->post['databases'] ?? null,
            'ssl'       => $req->post['ssl']       ?? null,
            'backup'    => $req->post['backup']    ?? null,
            'support'   => $req->post['support']   ?? null,
            'migration' => $req->post['migration'] ?? null,
            'notes'     => $req->post['notes']     ?? null,
            'active'    => !empty($req->post['active']) ? 1 : 0,
        ]);
        ActivityLog::log('updated', 'cloud_plan', $id);
        $this->redirect('/cloud');
    }
}
