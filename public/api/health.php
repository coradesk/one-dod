<?php
declare(strict_types=1);

require dirname(__DIR__, 2) . '/src/bootstrap.php';

$h = (new WorkerClient($CFG['worker_url'], 3))->health();
json_out([
    'worker'     => $h !== null,
    'providers'  => $h['providers'] ?? [],
    'gpu'        => in_array('CUDAExecutionProvider', $h['providers'] ?? [], true),
]);
