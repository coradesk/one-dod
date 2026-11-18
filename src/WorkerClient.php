<?php
declare(strict_types=1);

/** Klien HTTP ke worker AI Python (localhost). */
final class WorkerClient
{
    public function __construct(private string $baseUrl, private int $timeout) {}

    public function health(): ?array
    {
        $ch = curl_init($this->baseUrl . '/health');
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3, CURLOPT_CONNECTTIMEOUT => 2]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        return ($body !== false && $code === 200) ? json_decode((string)$body, true) : null;
    }

    /** @return array{blob:string, headers:array<string,string>} */
    public function removeBg(string $pngBlob, string $model): array
    {
        return $this->post('/remove-bg', $pngBlob, ['model' => $model]);
    }

    /** @return array{blob:string, headers:array<string,string>} */
    public function enhance(string $pngBlob, string $mode, int $target): array
    {
        return $this->post('/enhance', $pngBlob, ['mode' => $mode, 'target' => (string)$target]);
    }

    private function post(string $path, ?string $blob, array $fields, ?string $filePath = null): array
    {
        $tmp = null;
        if ($blob !== null) {
            $tmp = tempnam(sys_get_temp_dir(), 'imgw');
            file_put_contents($tmp, $blob);
            $filePath = $tmp;
        }
        if ($filePath !== null) {
            $fields['file'] = new CURLFile($filePath, 'image/png', 'in.png');
        }
        $headers = [];
        try {
            $ch = curl_init($this->baseUrl . $path);
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $fields,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => $this->timeout,
                CURLOPT_CONNECTTIMEOUT => 3,
                CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$headers) {
                    if (str_contains($line, ':')) {
                        [$k, $v] = explode(':', $line, 2);
                        $headers[strtolower(trim($k))] = trim($v);
                    }
                    return strlen($line);
                },
            ]);
            $body = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $err = curl_error($ch);
        } finally {
            if ($tmp !== null) {
                @unlink($tmp);
            }
        }
        if ($body === false) {
            throw new WorkerUnavailable('Worker AI tidak dapat dihubungi: ' . $err);
        }
        if ($code !== 200) {
            $msg = json_decode((string)$body, true)['error'] ?? ('HTTP ' . $code);
            throw new RuntimeException('Worker AI gagal: ' . $msg);
        }
        return ['blob' => (string)$body, 'headers' => $headers];
    }
}

final class WorkerUnavailable extends RuntimeException {}
