<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Controller;
use App\Core\Db;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;
use PDO;

final class AuthController extends Controller
{
    public function showLogin(Request $req): void
    {
        if (Session::user()) $this->redirect('/dashboard');
        $error = Session::flash('login_error');
        $this->view('auth.login', ['error' => $error], 'layout.auth');
    }

    public function login(Request $req): void
    {
        $this->assertCsrf($req);

        $email = strtolower(trim((string)($req->post['email'] ?? '')));
        $pass  = (string)($req->post['password'] ?? '');

        if ($email === '' || $pass === '') {
            Session::flash('login_error', 'Informe e-mail e senha.');
            $this->redirect('/login');
        }

        $st = Db::conn()->prepare('SELECT id, name, email, password_hash, role, active FROM users WHERE email = :e LIMIT 1');
        $st->execute([':e' => $email]);
        $u = $st->fetch(PDO::FETCH_ASSOC);

        if (!$u || !$u['active'] || !password_verify($pass, $u['password_hash'])) {
            usleep(300000); // pequena penalidade
            Session::flash('login_error', 'Credenciais inválidas.');
            $this->redirect('/login');
        }

        if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
            $new = password_hash($pass, PASSWORD_DEFAULT);
            $st2 = Db::conn()->prepare('UPDATE users SET password_hash = :h, last_login_at = NOW() WHERE id = :id');
            $st2->execute([':h' => $new, ':id' => $u['id']]);
        } else {
            $st2 = Db::conn()->prepare('UPDATE users SET last_login_at = NOW() WHERE id = :id');
            $st2->execute([':id' => $u['id']]);
        }

        Session::login($u);
        $this->redirect('/dashboard');
    }

    public function logout(Request $req): void
    {
        $this->assertCsrf($req);
        Session::destroy();
        Response::redirect('/login');
    }
}
