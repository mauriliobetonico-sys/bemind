<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Acl;
use App\Core\Controller;
use App\Core\Money;
use App\Core\Request;
use App\Core\Sanitize;
use App\Core\Session;
use App\Models\ActivityLog;
use App\Models\CompanySettings;
use App\Models\User;

final class SettingsController extends Controller
{
    public function index(Request $req): void
    {
        Acl::require('settings.view');
        $this->view('settings.index', [
            's'=>CompanySettings::get(),'users'=>User::all(),'user'=>Session::user(),
        ], 'layout.app');
    }

    public function update(Request $req): void
    {
        Acl::require('settings.update');
        $this->assertCsrf($req);

        // upload de logo (opcional)
        $logoPath = null;
        if (!empty($_FILES['logo']['tmp_name']) && is_uploaded_file($_FILES['logo']['tmp_name'])) {
            $mime = mime_content_type($_FILES['logo']['tmp_name']) ?: '';
            $ext  = ['image/png'=>'png','image/jpeg'=>'jpg','image/webp'=>'webp','image/svg+xml'=>'svg'][$mime] ?? null;
            if ($ext) {
                $file = 'logo-' . bin2hex(random_bytes(4)) . '.' . $ext;
                if (@move_uploaded_file($_FILES['logo']['tmp_name'], BMP_ROOT . '/public/uploads/' . $file)) {
                    $logoPath = '/uploads/' . $file;
                }
            }
        }

        $data = [
            'name'              => trim((string)($req->post['name'] ?? 'Be Mind Marketing')),
            'email'             => Sanitize::email((string)($req->post['email'] ?? '')),
            'whatsapp'          => Sanitize::digits((string)($req->post['whatsapp'] ?? '')) ?: null,
            'doc'               => Sanitize::digits((string)($req->post['doc'] ?? '')) ?: null,
            'site'              => trim((string)($req->post['site'] ?? '')) ?: null,
            'instagram'         => trim((string)($req->post['instagram'] ?? '')) ?: null,
            'address'           => trim((string)($req->post['address'] ?? '')) ?: null,
            'proposal_prefix'   => trim((string)($req->post['proposal_prefix'] ?? 'BEMIND-')),
            'default_validity_days' => (int)($req->post['default_validity_days'] ?? 15),
            'pix_key'           => trim((string)($req->post['pix_key'] ?? '')) ?: null,
            'pix_key_type'      => $req->post['pix_key_type'] ?? null,
            'pix_holder'        => trim((string)($req->post['pix_holder'] ?? '')) ?: null,
            'pix_bank'          => trim((string)($req->post['pix_bank'] ?? '')) ?: null,
            'show_pix_in_proposals' => !empty($req->post['show_pix_in_proposals']) ? 1 : 0,
            'auto_save_enabled' => !empty($req->post['auto_save_enabled']) ? 1 : 0,
            'dark_mode'         => !empty($req->post['dark_mode']) ? 1 : 0,
        ];
        if ($logoPath) $data['logo_path'] = $logoPath;
        CompanySettings::update($data);
        ActivityLog::log('updated','settings',1);
        $this->redirect('/settings');
    }
}
