<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Request;
use App\Core\Sanitize;
use App\Core\Session;
use App\Models\ActivityLog;
use App\Models\User;

final class UsersController extends Controller
{
    public function index(Request $req): void
    {
        Acl::require('settings.view');
        $this->view('users.index', ['users'=>User::all(),'user'=>Session::user()], 'layout.app');
    }

    public function create(Request $req): void
    {
        $this->requireRole(['admin']);
        $this->view('users.form', ['u'=>[],'user'=>Session::user()], 'layout.app');
    }

    public function edit(Request $req, array $p): void
    {
        $this->requireRole(['admin']);
        $u = User::find((int)$p['id']);
        if (!$u) $this->redirect('/users');
        $this->view('users.form', ['u'=>$u,'user'=>Session::user()], 'layout.app');
    }

    public function store(Request $req): void
    {
        $this->requireRole(['admin']);
        $this->assertCsrf($req);
        $name  = trim((string)($req->post['name'] ?? ''));
        $email = Sanitize::email((string)($req->post['email'] ?? ''));
        $pass  = (string)($req->post['password'] ?? '');
        $role  = in_array($req->post['role'] ?? 'comercial', ['admin','comercial','editor','viewer'], true)
                 ? $req->post['role'] : 'comercial';
        if ($name === '' || !$email || strlen($pass) < 8) {
            $this->redirect('/users/new');
        }
        $id = User::create($name, $email, $pass, $role);
        ActivityLog::log('created', 'user', $id, ['role'=>$role]);
        $this->redirect('/users');
    }

    public function update(Request $req, array $p): void
    {
        $this->requireRole(['admin']);
        $this->assertCsrf($req);
        $id = (int)$p['id'];
        $data = [
            'name'   => trim((string)($req->post['name'] ?? '')),
            'email'  => Sanitize::email((string)($req->post['email'] ?? '')),
            'role'   => in_array($req->post['role'] ?? '', ['admin','comercial','editor','viewer'], true)
                        ? $req->post['role'] : 'comercial',
            'active' => !empty($req->post['active']) ? 1 : 0,
        ];
        if (!empty($req->post['password']) && strlen($req->post['password']) >= 8) {
            $data['password'] = $req->post['password'];
        }
        User::update($id, $data);
        ActivityLog::log('updated', 'user', $id);
        $this->redirect('/users');
    }
}
