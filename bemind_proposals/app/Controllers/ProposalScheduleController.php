<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Request;
use App\Core\Session;
use App\Models\ActivityLog;
use App\Models\Proposal;

final class ProposalScheduleController extends Controller
{
    public function edit(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $id = (int)$p['id'];
        $prop = Proposal::find($id);
        if (!$prop) $this->redirect('/proposals');
        $this->view('proposals.schedule', [
            'p'=>$prop,'phases'=>Proposal::schedule($id),'user'=>Session::user(),
        ], 'layout.app');
    }

    public function update(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $this->assertCsrf($req);
        $id = (int)$p['id'];

        $phases = [];
        $names   = (array)($req->post['phase'] ?? []);
        $periods = (array)($req->post['period'] ?? []);
        foreach ($names as $i => $name) {
            $name = trim((string)$name);
            if ($name === '') continue;
            $phases[] = ['phase'=>$name, 'period'=>trim((string)($periods[$i] ?? ''))];
        }
        Proposal::setSchedule($id, $phases);
        ActivityLog::log('schedule_updated','proposal',$id,['count'=>count($phases)]);
        $this->redirect('/proposals/' . $id);
    }
}
