<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Controller;
use App\Core\Request;
use App\Core\Session;

final class MoreController extends Controller
{
    public function index(Request $req): void
    {
        $this->requireLogin();
        $this->view('more.index', ['user'=>Session::user()], 'layout.app');
    }
}
