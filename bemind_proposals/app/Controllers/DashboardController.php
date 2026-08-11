<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Controller;
use App\Core\Request;
use App\Core\Session;

final class DashboardController extends Controller
{
    public function root(Request $req): void
    {
        $this->redirect(Session::user() ? '/dashboard' : '/login');
    }

    public function index(Request $req): void
    {
        $user = $this->requireLogin();

        // Placeholders coerentes com o design — implementação real no passo 3+.
        $kpis = [
            ['label' => 'Criadas',      'value' => 0, 'color' => '#6B7078'],
            ['label' => 'Enviadas',     'value' => 0, 'color' => '#2A5DB0'],
            ['label' => 'Visualizadas', 'value' => 0, 'color' => '#A15C00'],
            ['label' => 'Aprovadas',    'value' => 0, 'color' => '#1E7A45'],
            ['label' => 'Pendentes',    'value' => 0, 'color' => '#2A5DB0'],
            ['label' => 'Recusadas',    'value' => 0, 'color' => '#B23A2E'],
        ];

        $this->view('dashboard.index', [
            'user'     => $user,
            'kpis'     => $kpis,
            'approved' => 0.0,
            'ticket'   => 0.0,
        ], 'layout.app');
    }
}
