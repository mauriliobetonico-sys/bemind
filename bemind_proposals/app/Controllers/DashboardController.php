<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Controller;
use App\Core\Request;
use App\Core\Session;
use App\Models\Proposal;

final class DashboardController extends Controller
{
    public function root(Request $req): void
    {
        $this->redirect(Session::user() ? '/dashboard' : '/login');
    }

    public function index(Request $req): void
    {
        $user = $this->requireLogin();
        $year = (int)date('Y');
        $k    = Proposal::kpisForYear($year);

        $kpis = [
            ['label' => 'Criadas',      'value' => (int)$k['created'],     'color' => '#6B7078'],
            ['label' => 'Enviadas',     'value' => (int)$k['enviada'],     'color' => '#2A5DB0'],
            ['label' => 'Visualizadas', 'value' => (int)$k['visualizada'], 'color' => '#A15C00'],
            ['label' => 'Aprovadas',    'value' => (int)$k['aprovada'],    'color' => '#1E7A45'],
            ['label' => 'Pendentes',    'value' => (int)$k['pendente'],    'color' => '#2A5DB0'],
            ['label' => 'Recusadas',    'value' => (int)$k['recusada'],    'color' => '#B23A2E'],
        ];
        $approved = (float)$k['value_approved'];
        $ticket   = $k['aprovada'] > 0 ? $approved / (int)$k['aprovada'] : 0.0;

        $performance = [
            ['label'=>'Rascunho',    'value'=>(int)$k['rascunho']],
            ['label'=>'Enviadas',    'value'=>(int)$k['enviada']],
            ['label'=>'Visualizadas','value'=>(int)$k['visualizada']],
            ['label'=>'Aprovadas',   'value'=>(int)$k['aprovada']],
            ['label'=>'Recusadas',   'value'=>(int)$k['recusada']],
        ];
        $maxP = max(1, max(array_column($performance, 'value')));
        foreach ($performance as &$p) $p['pct'] = (int)round($p['value'] / $maxP * 100);
        unset($p);

        $activity = Proposal::recentActivity(3);

        $this->view('dashboard.index', [
            'user'=>$user, 'kpis'=>$kpis, 'approved'=>$approved, 'ticket'=>$ticket,
            'performance'=>$performance, 'activity'=>$activity, 'year'=>$year,
        ], 'layout.app');
    }

    public function api(Request $req): void
    {
        $this->requireLogin();
        $this->json(Proposal::kpisForYear((int)date('Y')));
    }
}
