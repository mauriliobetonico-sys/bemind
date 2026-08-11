<?php
declare(strict_types=1);

use App\Core\Router;
use App\Controllers\{
    AuthController, DashboardController, ClientsController, ServicesController,
    CloudController, ProposalsController, ProposalItemsController, BriefingsController,
    PublicController, ReportsController, NotificationsController, SettingsController,
    MoreController, ExportController, UsersController, TemplatesController,
    ProposalScheduleController
};

/** @var Router $router */

/* ---------------- Auth ---------------- */
$router->get('/',            [DashboardController::class, 'root']);
$router->get('/login',       [AuthController::class,      'showLogin']);
$router->post('/login',      [AuthController::class,      'login']);
$router->post('/logout',     [AuthController::class,      'logout']);

/* ---------------- Painel ---------------- */
$router->get('/dashboard',   [DashboardController::class, 'index']);
$router->get('/api/dashboard', [DashboardController::class, 'api']);

/* ---------------- Clientes ---------------- */
$router->get('/clients',              [ClientsController::class, 'index']);
$router->get('/clients/new',          [ClientsController::class, 'create']);
$router->post('/clients',             [ClientsController::class, 'store']);
$router->get('/clients/{id}',         [ClientsController::class, 'show']);
$router->get('/clients/{id}/edit',    [ClientsController::class, 'edit']);
$router->post('/clients/{id}',        [ClientsController::class, 'update']);

$router->get('/api/clients',          [ClientsController::class, 'apiIndex']);
$router->post('/api/clients',         [ClientsController::class, 'apiStore']);

/* ---------------- Serviços ---------------- */
$router->get('/services',             [ServicesController::class, 'index']);
$router->get('/services/new',         [ServicesController::class, 'create']);
$router->post('/services',            [ServicesController::class, 'store']);
$router->get('/services/{id}/edit',   [ServicesController::class, 'edit']);
$router->post('/services/{id}',       [ServicesController::class, 'update']);

$router->get('/api/services',         [ServicesController::class, 'apiIndex']);

/* ---------------- Cloud ---------------- */
$router->get('/cloud',                [CloudController::class, 'index']);
$router->get('/cloud/{id}/edit',      [CloudController::class, 'edit']);
$router->post('/cloud/{id}',          [CloudController::class, 'update']);

/* ---------------- Propostas ---------------- */
$router->get('/proposals',                  [ProposalsController::class, 'index']);
$router->get('/proposals/express',          [ProposalsController::class, 'express']);
$router->post('/proposals/express',         [ProposalsController::class, 'expressStore']);
$router->get('/proposals/new',              [ProposalsController::class, 'wizard']);
$router->get('/proposals/{id}/wizard',      [ProposalsController::class, 'wizard']);
$router->post('/proposals/wizard',          [ProposalsController::class, 'wizardStep']);
$router->get('/proposals/{id}',             [ProposalsController::class, 'show']);
$router->get('/proposals/{id}/done',        [ProposalsController::class, 'done']);
$router->post('/proposals/{id}',            [ProposalsController::class, 'update']);
$router->post('/proposals/{id}/send',       [ProposalsController::class, 'send']);
$router->post('/proposals/{id}/duplicate',  [ProposalsController::class, 'duplicate']);
$router->post('/proposals/{id}/archive',    [ProposalsController::class, 'archive']);
$router->post('/proposals/{id}/renew',      [ProposalsController::class, 'renew']);
$router->get('/proposals/{id}/pdf',         [ProposalsController::class, 'pdf']);
$router->get('/proposals/{id}/preview',     [ProposalsController::class, 'preview']);

$router->post('/api/proposals/{id}/autosave',        [ProposalsController::class, 'autosave']);
$router->post('/api/proposals/{id}/items',           [ProposalItemsController::class, 'store']);
$router->post('/api/proposals/{id}/items/{itemId}',  [ProposalItemsController::class, 'update']);
$router->delete('/api/proposals/{id}/items/{itemId}',[ProposalItemsController::class, 'destroy']);
$router->post('/api/proposals/{id}/reorder-items',   [ProposalItemsController::class, 'reorder']);

/* ---------------- Briefings ---------------- */
$router->get('/briefings',                [BriefingsController::class, 'index']);
$router->get('/briefings/new',            [BriefingsController::class, 'create']);
$router->post('/briefings',               [BriefingsController::class, 'store']);
$router->get('/briefings/{id}',           [BriefingsController::class, 'show']);
$router->post('/briefings/{id}/to-proposal', [BriefingsController::class, 'toProposal']);

/* ---------------- Relatórios / Notificações / Settings / Mais ---------------- */
$router->get('/reports',                  [ReportsController::class, 'index']);
$router->get('/notifications',            [NotificationsController::class, 'index']);
$router->post('/notifications/{id}/read', [NotificationsController::class, 'read']);
$router->get('/settings',                 [SettingsController::class, 'index']);
$router->post('/settings',                [SettingsController::class, 'update']);
$router->get('/more',                     [MoreController::class, 'index']);

/* ---------------- Usuários / equipe ---------------- */
$router->get('/users',                    [UsersController::class, 'index']);
$router->get('/users/new',                [UsersController::class, 'create']);
$router->post('/users',                   [UsersController::class, 'store']);
$router->get('/users/{id}/edit',          [UsersController::class, 'edit']);
$router->post('/users/{id}',              [UsersController::class, 'update']);

/* ---------------- Templates de proposta ---------------- */
$router->get('/templates',                [TemplatesController::class, 'index']);
$router->get('/templates/{id}/new-proposal', [TemplatesController::class, 'newProposal']);
$router->post('/templates/from/{proposalId}',[TemplatesController::class, 'saveFromProposal']);
$router->post('/templates/{id}/delete',   [TemplatesController::class, 'destroy']);

/* ---------------- Cronograma ---------------- */
$router->get('/proposals/{id}/schedule',  [ProposalScheduleController::class, 'edit']);
$router->post('/proposals/{id}/schedule', [ProposalScheduleController::class, 'update']);

/* ---------------- Exportações CSV ---------------- */
$router->get('/export/clients.csv',       [ExportController::class, 'clients']);
$router->get('/export/proposals.csv',     [ExportController::class, 'proposals']);
$router->get('/export/services.csv',      [ExportController::class, 'services']);

/* ---------------- Rotas públicas ---------------- */
$router->get('/p/{token}',                [PublicController::class, 'proposal']);
$router->post('/p/{token}/accept',        [PublicController::class, 'accept']);
$router->post('/p/{token}/request-change',[PublicController::class, 'requestChange']);
$router->post('/p/{token}/decline',       [PublicController::class, 'decline']);
$router->get('/b/{token}',                [PublicController::class, 'briefing']);
$router->post('/b/{token}/save',          [PublicController::class, 'briefingSave']);
$router->post('/b/{token}/submit',        [PublicController::class, 'briefingSubmit']);

/* ---------------- Health ---------------- */
$router->get('/health', function () {
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'time' => date('c')]);
    exit;
});
