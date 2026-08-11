<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Money;
use App\Core\Request;
use App\Models\Client;
use App\Models\Proposal;
use App\Models\Service;
use App\Services\Csv;

final class ExportController extends Controller
{
    public function clients(Request $req): void
    {
        Acl::require('clients.view');
        $rows = [];
        foreach (Client::all() as $c) $rows[] = [
            $c['id'], $c['company_name'], $c['trade_name'], $c['doc'],
            $c['contact_name'], $c['email'], $c['whatsapp'],
            $c['city'], $c['state'], (int)$c['proposals_count'], Money::br((float)$c['total_contracted']),
        ];
        Csv::stream('clientes.csv',
            ['ID','Razão social','Nome fantasia','CNPJ/CPF','Responsável','E-mail','WhatsApp','Cidade','UF','Propostas','Total contratado'],
            $rows);
    }

    public function proposals(Request $req): void
    {
        Acl::require('proposals.view');
        $rows = [];
        foreach (Proposal::all() as $p) $rows[] = [
            $p['number'], $p['status'], $p['client_name'], $p['title'],
            Money::br((float)$p['total_monthly']), Money::br((float)$p['total_once']),
            $p['issue_date'], $p['valid_until'], (int)$p['views_count'],
        ];
        Csv::stream('propostas.csv',
            ['Número','Status','Cliente','Título','Mensal','Único','Emissão','Validade','Visualizações'],
            $rows);
    }

    public function services(Request $req): void
    {
        Acl::require('services.view');
        $rows = [];
        foreach (Service::byCategory(null) as $s) $rows[] = [
            $s['name'], $s['category_name'], Money::br((float)$s['default_price']),
            $s['unit'], $s['recurrence'], $s['active'] ? 'ativo' : 'inativo',
        ];
        Csv::stream('servicos.csv',
            ['Serviço','Categoria','Preço padrão','Unidade','Recorrência','Status'],
            $rows);
    }
}
