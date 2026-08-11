<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Request;
use App\Core\Session;
use App\Models\Notification;

final class NotificationsController extends Controller
{
    public function index(Request $req): void
    {
        Acl::require('notifications.view');
        $user = Session::user();
        $this->view('notifications.index', [
            'items'=>Notification::all((int)$user['id']),'user'=>$user,
        ], 'layout.app');
    }

    public function read(Request $req, array $p): void
    {
        Acl::require('notifications.view');
        $this->assertCsrf($req);
        Notification::markRead((int)$p['id'], (int)Session::user()['id']);
        $this->redirect('/notifications');
    }
}
