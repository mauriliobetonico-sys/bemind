<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Csrf;
use App\Core\Money;
use App\Core\Request;
use App\Models\Proposal;
use App\Models\Service;
use App\Services\Totals;

final class ProposalItemsController extends Controller
{
    public function store(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $this->checkCsrf($req);
        $pid = (int)$p['id'];
        $svcId = isset($req->post['service_id']) ? (int)$req->post['service_id'] : null;
        $svc   = $svcId ? Service::find($svcId) : null;
        $name  = $svc['name'] ?? (string)($req->post['name'] ?? 'Item');
        $price = isset($req->post['unit_price']) ? Money::parse((string)$req->post['unit_price']) : (float)($svc['default_price'] ?? 0);
        $rec   = (string)($req->post['recurrence'] ?? $svc['recurrence'] ?? 'unico');

        $id = Proposal::addItem($pid, [
            'service_id'=>$svcId ?: null,'name'=>$name,'description'=>$svc['short_description'] ?? null,
            'deliverables'=>$svc['deliverables'] ?? null,'lead_time'=>$svc['lead_time'] ?? null,
            'quantity'=>(int)($req->post['quantity'] ?? 1),
            'unit_price'=>$price,'discount_percent'=>(float)($req->post['discount_percent'] ?? 0),
            'recurrence'=>$rec,'sort_order'=>(int)($req->post['sort_order'] ?? 0),
        ]);
        $t = Totals::recompute($pid);
        $this->json(['ok'=>true,'item_id'=>$id,'totals'=>$t]);
    }

    public function update(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $this->checkCsrf($req);
        $pid = (int)$p['id']; $iid = (int)$p['itemId'];
        $data = [];
        foreach (['name','description','lead_time','quantity','discount_percent','recurrence','sort_order'] as $f) {
            if (array_key_exists($f, $req->post)) $data[$f] = $req->post[$f];
        }
        if (array_key_exists('unit_price', $req->post)) $data['unit_price'] = Money::parse((string)$req->post['unit_price']);
        Proposal::updateItem($iid, $data);
        $t = Totals::recompute($pid);
        $this->json(['ok'=>true,'totals'=>$t]);
    }

    public function destroy(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $this->checkCsrf($req);
        Proposal::deleteItem((int)$p['itemId']);
        $t = Totals::recompute((int)$p['id']);
        $this->json(['ok'=>true,'totals'=>$t]);
    }

    public function reorder(Request $req, array $p): void
    {
        Acl::require('proposals.update');
        $this->checkCsrf($req);
        $ids = $req->post['ids'] ?? [];
        if (is_string($ids)) $ids = array_filter(array_map('intval', explode(',', $ids)));
        Proposal::reorderItems((int)$p['id'], array_map('intval', (array)$ids));
        $t = Totals::recompute((int)$p['id']);
        $this->json(['ok'=>true,'totals'=>$t]);
    }

    private function checkCsrf(Request $req): void
    {
        $t = $req->post['_csrf'] ?? $req->server['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!Csrf::check((string)$t)) $this->json(['ok'=>false,'error'=>'csrf'], 419);
    }
}
