<?php
declare(strict_types=1);

use App\Core\Router;
use App\Controllers\AuthController;
use App\Controllers\DashboardController;
use App\Controllers\PublicController;

/** @var Router $router */

// Público
$router->get('/',                             [DashboardController::class, 'root']);
$router->get('/login',                        [AuthController::class,      'showLogin']);
$router->post('/login',                       [AuthController::class,      'login']);
$router->post('/logout',                      [AuthController::class,      'logout']);

// Autenticado (as próprias controllers exigem sessão)
$router->get('/dashboard',                    [DashboardController::class, 'index']);

// Health check simples
$router->get('/health', function () {
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'time' => date('c')]);
    exit;
});

// Páginas públicas — proposta e briefing (placeholders no passo 1; ganham corpo no passo 4/6)
$router->get('/p/{token}',                    [PublicController::class, 'proposal']);
$router->post('/p/{token}/accept',            [PublicController::class, 'accept']);
$router->post('/p/{token}/request-change',    [PublicController::class, 'requestChange']);
$router->post('/p/{token}/decline',           [PublicController::class, 'decline']);
$router->get('/b/{token}',                    [PublicController::class, 'briefing']);
$router->post('/b/{token}/save',              [PublicController::class, 'briefingSave']);
$router->post('/b/{token}/submit',            [PublicController::class, 'briefingSubmit']);
