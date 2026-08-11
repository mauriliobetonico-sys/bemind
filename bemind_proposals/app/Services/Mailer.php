<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Env;

/**
 * Envia e-mail via PHPMailer (SMTP) se disponível, senão cai no mail() do PHP.
 * Retorna true se aparentemente entregue.
 */
final class Mailer
{
    public static function send(string $to, string $subject, string $htmlBody, ?string $altText = null): bool
    {
        $from     = (string)(Env::get('MAIL_FROM', 'no-reply@localhost'));
        $fromName = (string)(Env::get('MAIL_FROM_NAME', 'Be Mind Marketing'));

        if (class_exists('\\PHPMailer\\PHPMailer\\PHPMailer')) {
            try {
                $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
                $mail->isSMTP();
                $mail->Host       = (string)Env::get('MAIL_HOST', '');
                $mail->SMTPAuth   = true;
                $mail->Username   = (string)Env::get('MAIL_USER', '');
                $mail->Password   = (string)Env::get('MAIL_PASSWORD', '');
                $mail->SMTPSecure = (string)Env::get('MAIL_ENCRYPTION', 'tls');
                $mail->Port       = (int)Env::get('MAIL_PORT', 587);
                $mail->CharSet    = 'UTF-8';
                $mail->setFrom($from, $fromName);
                $mail->addAddress($to);
                $mail->isHTML(true);
                $mail->Subject = $subject;
                $mail->Body    = $htmlBody;
                $mail->AltBody = $altText ?? strip_tags($htmlBody);
                return (bool)$mail->send();
            } catch (\Throwable $e) {
                error_log('[Mailer] PHPMailer: ' . $e->getMessage());
                return false;
            }
        }

        // Fallback: mail()
        $headers  = "MIME-Version: 1.0\r\n";
        $headers .= "Content-type: text/html; charset=UTF-8\r\n";
        $headers .= "From: {$fromName} <{$from}>\r\n";
        return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $htmlBody, $headers);
    }
}
