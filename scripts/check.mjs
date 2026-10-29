import { readdir } from 'node:fs/promises';
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
