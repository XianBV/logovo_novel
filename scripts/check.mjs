import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const files = [];
for (const folder of ['./', 'js/', 'scripts/']) {
    const directory = new URL(folder, root);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(new URL(entry.name, directory));
    }
}

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Синтаксис JavaScript проверен: ${files.length} файлов.`);

// Отдельный CSS-модуль должен попасть в поставку вместе с index.html.
// Проверяем локальные подключения без запросов к шрифтам и другим сервисам.
const html = await readFile(new URL('index.html', root), 'utf8');
const stylesheetLinks = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => ({
        rel: tag.match(/\brel=["']([^"']+)["']/i)?.[1],
        href: tag.match(/\bhref=["']([^"']+)["']/i)?.[1]
    }))
    .filter(link => link.rel?.split(/\s+/).includes('stylesheet') && link.href && !/^(?:https?:|data:|\/\/)/i.test(link.href));
for (const { href } of stylesheetLinks) {
    const asset = new URL(href, root);
    asset.search = '';
    if (!(await stat(asset)).isFile()) throw new Error(`Не найден файл стилей: ${href}`);
}
console.log(`Подключения CSS проверены: ${stylesheetLinks.length} файлов.`);
