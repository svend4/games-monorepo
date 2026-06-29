<?php
// ВИТРИНА (PHP) с ПОИСКОМ и ФИЛЬТРОМ по цене.
// Читает database.json (его готовит generate_all.py).
// Открыть:  http://localhost/01/01/prais.php
// Обновить данные:  python generate_all.py

$file = __DIR__ . DIRECTORY_SEPARATOR . "database.json";
$data = file_exists($file) ? json_decode(file_get_contents($file), true) : null;

$q     = isset($_GET['q']) ? trim($_GET['q']) : "";
$price = isset($_GET['price']) ? $_GET['price'] : "";

function matchRow($u, $q, $price) {
    if ($q !== "") {
        $hay = mb_strtolower($u["услуга"] . " " . $u["описание"]);
        if (mb_strpos($hay, mb_strtolower($q)) === false) return false;
    }
    if ($price === "lo"  && $u["цена"] >= 500)  return false;
    if ($price === "mid" && ($u["цена"] < 500 || $u["цена"] > 1500)) return false;
    if ($price === "hi"  && $u["цена"] <= 1500) return false;
    return true;
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Прайс — помощь по дому</title>
<style>
  body { font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif; background:#f7f9f8;
         color:#22302b; margin:0; padding:32px 16px; }
  .wrap { max-width:780px; margin:0 auto; background:#fff; padding:36px;
          border-radius:14px; box-shadow:0 2px 14px rgba(0,0,0,.06); }
  h1 { color:#2a7f62; margin-top:0; }
  .meta { color:#7a8b84; font-size:.9em; margin-bottom:18px; }
  form { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:20px; }
  input[type=text], select { padding:9px 12px; border:1px solid #cdd8d3;
          border-radius:8px; font-size:1em; }
  input[type=text] { flex:1; min-width:200px; }
  button { background:#2a7f62; color:#fff; border:0; border-radius:8px;
          padding:9px 18px; font-size:1em; cursor:pointer; }
  a.reset { align-self:center; color:#7a8b84; font-size:.9em; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:11px 12px; border-bottom:1px solid #e0e6e3; }
  th { background:#2a7f62; color:#fff; }
  td.price { text-align:right; font-weight:600; white-space:nowrap; }
  tr:nth-child(even) td { background:#fafcfb; }
  .err,.empty { background:#fff7e6; border-left:4px solid #b9770e; padding:14px 18px;
          border-radius:0 8px 8px 0; color:#6b4e12; }
  .panel { background:#eef5f1; border-radius:10px; padding:12px 16px; margin-bottom:14px; font-size:.95em; }
  .panel summary { cursor:pointer; }
  .panel ul { margin:10px 0 0; padding-left:20px; }
  .panel li { padding:3px 0; border:0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Прайс — помощь по дому</h1>
<?php if ($data && !empty($data["услуги"])): ?>
  <div class="meta">Обновлено: <?= htmlspecialchars($data["обновлено"]) ?> ·
       Документов: <?= (int)$data["документов"] ?> · Всего услуг: <?= (int)$data["услуг"] ?></div>

  <?php if (!empty($data["контакты"])): $k = $data["контакты"]; ?>
  <div class="panel">
    <strong>Контакты:</strong>
    <?php if (!empty($k["телефон"])): ?> ☎ <?= htmlspecialchars($k["телефон"]) ?><?php endif; ?>
    <?php if (!empty($k["email"])): ?> · ✉ <?= htmlspecialchars($k["email"]) ?><?php endif; ?>
    <?php if (!empty($k["режим"])): ?> · 🕐 <?= htmlspecialchars($k["режим"]) ?><?php endif; ?>
  </div>
  <?php endif; ?>

  <?php if (!empty($data["условия"])): ?>
  <details class="panel">
    <summary><strong>Условия (<?= count($data["условия"]) ?>)</strong></summary>
    <ul>
      <?php foreach ($data["условия"] as $c): ?>
      <li><?= htmlspecialchars($c) ?></li>
      <?php endforeach; ?>
    </ul>
  </details>
  <?php endif; ?>

  <form method="get">
    <input type="text" name="q" placeholder="Поиск по названию…" value="<?= htmlspecialchars($q) ?>">
    <select name="price">
      <option value="">Любая цена</option>
      <option value="lo"  <?= $price==="lo"?"selected":"" ?>>до 500 ₽</option>
      <option value="mid" <?= $price==="mid"?"selected":"" ?>>500–1500 ₽</option>
      <option value="hi"  <?= $price==="hi"?"selected":"" ?>>от 1500 ₽</option>
    </select>
    <button type="submit">Найти</button>
    <a class="reset" href="prais.php">сброс</a>
  </form>

  <?php
    $rows = array_filter($data["услуги"], fn($u) => matchRow($u, $q, $price));
  ?>
  <?php if ($rows): ?>
  <table>
    <tr><th>Услуга</th><th>Описание</th><th>Цена</th></tr>
    <?php foreach ($rows as $u): ?>
    <tr>
      <td><?= htmlspecialchars($u["услуга"]) ?></td>
      <td><?= htmlspecialchars($u["описание"]) ?></td>
      <td class="price">от <?= number_format($u["цена"], 0, ",", " ") ?> ₽</td>
    </tr>
    <?php endforeach; ?>
  </table>
  <div class="meta">Показано: <?= count($rows) ?> из <?= count($data["услуги"]) ?></div>
  <?php else: ?>
  <div class="empty">По запросу ничего не найдено. <a href="prais.php">Сбросить фильтр</a></div>
  <?php endif; ?>

<?php else: ?>
  <div class="err">
    Данные не найдены. Сначала запустите обработку:<br>
    <code>python generate_all.py</code>
  </div>
<?php endif; ?>
</div>
</body>
</html>
