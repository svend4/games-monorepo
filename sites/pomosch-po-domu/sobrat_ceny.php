<?php
// Скрипт-пример (PHP): собирает услуги и цены из Markdown-файлов
// и сохраняет сводную таблицу в CSV.
//
// Запуск 1 (консоль, PHP из XAMPP):
//   C:\xampp\php\php.exe sobrat_ceny.php
// Запуск 2 (браузер, Apache из XAMPP):
//   http://localhost/01/01/sobrat_ceny.php
//
// Исходные файлы НЕ изменяются — создаётся только ceny_svodka_php.csv

$base = __DIR__;
$mdFiles = glob($base . DIRECTORY_SEPARATOR . "*.md");
$rows = [];
$log = [];

foreach ($mdFiles as $md) {
    $fname = basename($md);
    $count = 0;
    foreach (file($md) as $line) {
        if (strpos($line, "₽") === false) continue;
        // ищем "услуга ... от 1 500 ₽" или "500 ₽"
        if (preg_match('/(.+?)\|?\s*(от\s*)?([\d\s]+)\s*₽/u', $line, $m)) {
            $name  = trim($m[1], " |*-#\t");
            $price = preg_replace('/\s/', '', $m[3]);
            if ($name !== "" && ctype_digit($price)) {
                $rows[] = [$fname, $name, $price];
                $count++;
            }
        }
    }
    $log[] = "  $fname: цен найдено $count";
}

// Записываем CSV (с BOM для корректной кириллицы в Excel)
$out = $base . DIRECTORY_SEPARATOR . "ceny_svodka_php.csv";
$fp = fopen($out, "w");
fwrite($fp, "\xEF\xBB\xBF");
fputcsv($fp, ["файл", "услуга", "цена_руб"]);
foreach ($rows as $r) fputcsv($fp, $r);
fclose($fp);

// Вывод результата (в консоли — текст, в браузере — тоже читаемо)
$nl = (php_sapi_name() === "cli") ? "\n" : "<br>\n";
echo "Найдено Markdown-файлов: " . count($mdFiles) . $nl;
echo implode($nl, $log) . $nl;
echo $nl . "Готово! Собрано строк: " . count($rows) . $nl;
echo "Результат сохранён: $out" . $nl;
