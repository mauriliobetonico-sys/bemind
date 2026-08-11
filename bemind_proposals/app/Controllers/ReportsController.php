<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Request;
use App\Core\Session;
use App\Models\Proposal;

final class ReportsController extends Controller
{
    public function index(Request $req): void
    {
        Acl::require('reports.view');
        $year = (int)($req->query['year'] ?? date('Y'));
        $k    = Proposal::kpisForYear($year);
        $sent = max(1, (int)$k['enviada'] + (int)$k['visualizada'] + (int)$k['aprovada'] + (int)$k['recusada']);
        $approvalRate = (int)round(((int)$k['aprovada'] / $sent) * 100);
        $ticket = $k['aprovada'] > 0 ? (float)$k['value_approved'] / (int)$k['aprovada'] : 0.0;
        $this->view('reports.index', [
            'year'=>$year,'k'=>$k,'approvalRate'=>$approvalRate,'ticket'=>$ticket,
            'top'=>Proposal::topServices(4), 'user'=>Session::user(),
        ], 'layout.app');
    }
}
