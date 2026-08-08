import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createRequestCoordinator,
  createServer,
  checkGoogleDriveConnection,
  buildChapterDocumentUpdateRequests,
  buildContentsDocumentUpdateRequests,
  extractChapterContentFromGoogleDocument,
  forwardAppsScriptAction,
  getGoogleConfig,
  getMutationLockKey,
  getSupabaseConfig,
  grantPermissionDirect,
  createNovelDirect,
  createAuthorSubmissionDirect,
  deleteAvatarDirect,
  deleteNovelDirect,
  deleteUserDirect,
  permanentDeleteChapterDirect,
  restoreNovelDirect,
  restoreFromTrashDirect,
  handleEdgeRequest,
  handleDirectQuery,
  handleDirectMutation,
  parseJsonp,
  runMutationAction,
  setUserBlockedDirect
} from './server.js';

test('parseJsonp извлекает ответ Apps Script', () => {
  assert.deepEqual(
    parseJsonp('callback({"status":"completed","result":{"success":true}});', 'callback'),
    { status: 'completed', result: { success: true } }
  );
});

test('переходный сервер дожидается завершения Apps Script', async () => {
  let statusChecks = 0;
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === 'POST') {
      return new Response('OK', { status: 200 });
    }

    statusChecks += 1;
    const callback = new URL(_url).searchParams.get('callback');
    const status = statusChecks === 1
      ? { status: 'pending' }
      : { status: 'completed', result: { success: true, chapter_id: 27 } };
    return new Response(`${callback}(${JSON.stringify(status)});`, { status: 200 });
  };

  const result = await forwardAppsScriptAction('updateChapter', { chapter_id: 27 }, {
    fetchImpl,
    scriptUrl: 'https://example.test/exec',
    pollIntervalMs: 1,
    timeoutMs: 1000
  });

  assert.deepEqual(result, { success: true, chapter_id: 27 });
  assert.equal(statusChecks, 2);
});

test('HTTP-сервер отвечает на проверку здоровья и принимает действие', async t => {
  const server = createServer({
    forwardAction: async (action, data) => ({ success: true, action, value: data.value })
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/api/health`).then(response => response.json());
  assert.equal(health.success, true);

  const actionResponse = await fetch(`${baseUrl}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'example', data: { value: 42 } })
  }).then(response => response.json());

  assert.equal(actionResponse.success, true);
  assert.equal(actionResponse.action, 'example');
  assert.equal(actionResponse.value, 42);
});

test('Supabase Edge Function принимает GET и POST запросы', async () => {
  const queryResponse = await handleEdgeRequest(
    new Request('https://example-ref.supabase.co/functions/v1/api/query?action=getExample&value=17', {
      headers: { Origin: 'https://reader.example' }
    }),
    {
      allowedOrigins: ['https://reader.example'],
      directQuery: async (action, params) => ({ success: true, action, value: params.value })
    }
  );
  assert.equal(queryResponse.status, 200);
  assert.equal(queryResponse.headers.get('access-control-allow-origin'), 'https://reader.example');
  assert.deepEqual(await queryResponse.json(), {
    success: true,
    action: 'getExample',
    value: '17'
  });

  const actionResponse = await handleEdgeRequest(
    new Request('https://example-ref.supabase.co/functions/v1/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveExample', data: { value: 42 } })
    }),
    {
      mutationAction: async (action, data) => ({ success: true, action, value: data.value })
    }
  );
  assert.equal(actionResponse.status, 200);
  const result = await actionResponse.json();
  assert.equal(result.success, true);
  assert.equal(result.action, 'saveExample');
  assert.equal(result.value, 42);
  assert.equal(Number.isFinite(result.server_duration_ms), true);
});

test('Supabase Edge Function отвечает на предварительную CORS-проверку', async () => {
  const response = await handleEdgeRequest(
    new Request('https://example-ref.supabase.co/functions/v1/api/action', {
      method: 'OPTIONS',
      headers: { Origin: 'https://reader.example' }
    }),
    { allowedOrigins: ['https://reader.example'] }
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://reader.example');
  assert.match(response.headers.get('access-control-allow-headers'), /content-type/);
});

test('перенесённые изменения не вызывают мост Apps Script', async t => {
  let bridgeCalls = 0;
  let directCalls = 0;
  const server = createServer({
    forwardAction: async () => {
      bridgeCalls += 1;
      return { success: false };
    },
    directMutation: async (action, data) => {
      directCalls += 1;
      return { success: true, action, email: data.email };
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const result = await fetch(`http://127.0.0.1:${address.port}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'loginWithEmail',
      data: { email: 'reader@example.test', password: 'secret' },
      mutation_id: 'direct-login-test'
    })
  }).then(response => response.json());

  assert.equal(result.success, true);
  assert.equal(directCalls, 1);
  assert.equal(bridgeCalls, 0);
});

test('одновременные сохранения одной главы выполняются по очереди', async () => {
  const coordinator = createRequestCoordinator();
  const events = [];

  const first = coordinator.run({
    mutationId: 'first',
    lockKey: 'chapter:27',
    task: async () => {
      events.push('first:start');
      await new Promise(resolve => setTimeout(resolve, 15));
      events.push('first:end');
      return 1;
    }
  });
  const second = coordinator.run({
    mutationId: 'second',
    lockKey: 'chapter:27',
    task: async () => {
      events.push('second:start');
      events.push('second:end');
      return 2;
    }
  });

  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('повтор одного mutation_id не запускает сохранение дважды', async () => {
  const coordinator = createRequestCoordinator();
  let executions = 0;
  const task = () => coordinator.run({
    mutationId: 'same-request',
    lockKey: 'chapter:27',
    task: async () => {
      executions += 1;
      return { success: true };
    }
  });

  const [first, second] = await Promise.all([task(), task()]);
  assert.deepEqual(first, { success: true });
  assert.deepEqual(second, { success: true });
  assert.equal(executions, 1);
});

test('конфигурация Supabase принимает новый и старый серверные ключи', () => {
  const modern = getSupabaseConfig({
    SUPABASE_URL: 'https://example-ref.supabase.co',
    SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`
  });
  assert.equal(modern.configured, true);
  assert.equal(modern.isLegacyKey, false);

  const legacy = getSupabaseConfig({
    SUPABASE_URL: 'https://example-ref.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(80)
  });
  assert.equal(legacy.configured, true);
  assert.equal(legacy.isLegacyKey, true);

  const hosted = getSupabaseConfig({
    SUPABASE_URL: 'https://example-ref.supabase.co',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: `sb_secret_${'y'.repeat(40)}` })
  });
  assert.equal(hosted.configured, true);
  assert.equal(hosted.isLegacyKey, false);
});

test('конфигурация Google Диска не считает неполные ключи подключением', () => {
  const partial = getGoogleConfig({
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret'
  });
  assert.equal(partial.credentialsConfigured, true);
  assert.equal(partial.connected, false);
  assert.equal(partial.redirectUri, 'http://127.0.0.1:3000/api/google/oauth/callback');

  const complete = getGoogleConfig({
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REFRESH_TOKEN: 'refresh-token'
  });
  assert.equal(complete.connected, true);
});

test('проверка Google Диска обновляет токен и видит корневую папку', async () => {
  const fetchImpl = async url => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'temporary-access-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    assert.match(String(url), /drive\/v3\/files\/root-folder/);
    return new Response(JSON.stringify({
      id: 'root-folder',
      name: 'Логово новелл',
      mimeType: 'application/vnd.google-apps.folder',
      trashed: false
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await checkGoogleDriveConnection({
    fetchImpl,
    config: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      rootFolderId: 'root-folder',
      credentialsConfigured: true,
      connected: true
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.folder.name, 'Логово новелл');
});

test('Google Docs преобразуется в формат редактора без потери оформления', () => {
  const extracted = extractChapterContentFromGoogleDocument({
    body: {
      content: [
        { paragraph: { elements: [{ textRun: { content: 'Глава 2\n' } }] } },
        {
          paragraph: {
            elements: [
              { textRun: { content: 'Обычный ' } },
              {
                textRun: {
                  content: 'жирный\n',
                  textStyle: {
                    bold: true,
                    foregroundColor: { color: { rgbColor: { red: 1, green: 0, blue: 0 } } },
                    fontSize: { magnitude: 14 }
                  }
                }
              }
            ]
          }
        },
        { paragraph: { elements: [{ horizontalRule: {} }] } },
        {
          paragraph: {
            paragraphStyle: { indentStart: { magnitude: 36 } },
            elements: [{ textRun: { content: 'Цитата\n', textStyle: { italic: true } } }]
          }
        }
      ]
    }
  });

  assert.equal(extracted.content, 'Обычный жирный\n\nЦитата');
  assert.equal(extracted.content_rich.blocks[0].runs[1].bold, true);
  assert.equal(extracted.content_rich.blocks[0].runs[1].color, '#ff0000');
  assert.equal(extracted.content_rich.blocks[0].runs[1].size, 14);
  assert.equal(extracted.content_rich.blocks[1].type, 'divider');
  assert.equal(extracted.content_rich.blocks[2].type, 'quote');
});

test('сохранение главы оставляет таблицу навигации и создаёт настоящую линию', () => {
  const requests = buildChapterDocumentUpdateRequests({
    body: {
      content: [
        { startIndex: 1, endIndex: 10, paragraph: { elements: [] } },
        { startIndex: 10, endIndex: 25, paragraph: { elements: [] } },
        { startIndex: 25, endIndex: 40, table: {} }
      ]
    }
  }, {
    chapter_number: 27,
    chapter_title: 'Название',
    content_rich: {
      version: 1,
      blocks: [
        { type: 'paragraph', runs: [{ text: 'Жирный', bold: true }] },
        { type: 'divider', runs: [] },
        { type: 'quote', runs: [{ text: 'Цитата', italic: true }] }
      ]
    }
  });

  assert.deepEqual(requests[0].deleteContentRange.range, { startIndex: 10, endIndex: 24 });
  assert.ok(!requests.some(request => request.deleteContentRange?.range.endIndex > 24));
  assert.ok(requests.some(request => request.updateParagraphStyle?.paragraphStyle.borderBottom));
  assert.ok(requests.some(request => request.updateTextStyle?.textStyle.bold === true));
  assert.ok(requests.some(request => request.updateTextStyle?.textStyle.italic === true));
});

test('текст новой главы вставляется до завершающего абзаца пустого Google Docs', () => {
  const requests = buildChapterDocumentUpdateRequests({
    body: { content: [{ startIndex: 1, endIndex: 2, paragraph: { elements: [] } }] }
  }, {
    chapter_number: 2,
    chapter_title: 'Новая',
    content: 'Текст главы'
  });
  const insertions = requests.filter(request => request.insertText);
  assert.equal(insertions.length, 2);
  assert.equal(insertions[1].insertText.location.index, 1 + 'Глава 2: Новая'.length);
  assert.ok(insertions[1].insertText.text.startsWith('\n'));
});

test('документ содержания получает тома, абзацы глав и ссылки', () => {
  const requests = buildContentsDocumentUpdateRequests({
    body: { content: [{ startIndex: 1, endIndex: 8, paragraph: { elements: [] } }] }
  }, { title: 'Тест 2' }, [
    {
      volume_name: 'Том 1', volume_order: 1, chapter_number: 1,
      chapter_title: 'Тест', file_id: 'chapter-one'
    },
    {
      volume_name: 'Том 2', volume_order: 2, chapter_number: 2,
      chapter_title: 'Дальше', file_id: 'chapter-two'
    }
  ], 'description-doc');

  assert.deepEqual(requests[0].deleteContentRange.range, { startIndex: 1, endIndex: 7 });
  assert.equal(
    requests[1].insertText.text,
    'Тест 2\nТом 1\nГлава 1: Тест\n\nТом 2\nГлава 2: Дальше'
  );
  const links = requests.filter(request => request.updateTextStyle?.textStyle.link);
  assert.equal(links.length, 3);
  assert.ok(links.some(request => request.updateTextStyle.textStyle.link.url.includes('chapter-one')));
  assert.ok(requests.some(request => (
    request.updateParagraphStyle?.paragraphStyle.namedStyleType === 'HEADING_1'
  )));
});

test('после создания главы мост запускает прямое обновление содержания', async () => {
  let directCalls = 0;
  let bridgeCalls = 0;
  const result = await runMutationAction('addChapter', { novel_id: 10 }, {
    directMutation: async () => {
      directCalls += 1;
      return { success: true, chapter_id: 50 };
    },
    forwardAction: async () => {
      bridgeCalls += 1;
      return { success: false };
    }
  });

  assert.equal(result.success, true);
  assert.equal(directCalls, 1);
  assert.equal(bridgeCalls, 0);
});

test('глава без тома не получает скрытое имя тома', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  let insertedChapter = null;
  const fetchImpl = async (url, options = {}) => {
    const parsedUrl = url instanceof URL ? url : new URL(url);
    const table = parsedUrl.pathname.split('/').at(-1);
    if (table === 'sessions') {
      return new Response(JSON.stringify([{
        expires_at: future,
        users: { user_id: 3, username: 'Создатель', role: 'creator' }
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'novels') {
      return new Response(JSON.stringify([{
        novel_id: 10,
        title: 'Тест 2',
        creator_id: 3,
        folder_id: 'novel-folder',
        is_deleted: false
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'chapters' && options.method === 'POST') {
      insertedChapter = { chapter_id: 53, ...JSON.parse(options.body) };
      return new Response(JSON.stringify([insertedChapter]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (table === 'chapters') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Неожиданный запрос ${parsedUrl}`);
  };
  const result = await handleDirectMutation('addChapter', {
    session_token: 'creator-token',
    novel_id: 10,
    volume_name: '',
    chapter_number: 1,
    chapter_title: 'Тест',
    content: 'Три тестовых слова'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    },
    resolveChapterParentFolder: async () => ({ id: 'chapters-folder' }),
    createChapterDocument: async () => 'google-doc-53',
    updateNovelStats: async () => {},
    updateNovelVolumeStructure: async () => {},
    syncContents: async () => ({ success: true, chapter_count: 1 }),
    syncNavigation: async () => ({ success: true, errors: [] })
  });

  assert.equal(result.success, true);
  assert.equal(insertedChapter.volume_name, '');
  assert.equal(insertedChapter.volume_order, 1);
  assert.equal(insertedChapter.word_count, 3);
});

test('прямое удаление главы скрывает её и обновляет соседей', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  let deletedPatch = null;
  let navigationIds = null;
  const fetchImpl = async (url, options = {}) => {
    const parsedUrl = url instanceof URL ? url : new URL(url);
    const table = parsedUrl.pathname.split('/').at(-1);
    if (table === 'sessions') {
      return new Response(JSON.stringify([{
        expires_at: future,
        users: { user_id: 3, username: 'Создатель', role: 'creator' }
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'novels') {
      return new Response(JSON.stringify([{
        novel_id: 10,
        title: 'Тест 2',
        creator_id: 3,
        folder_id: 'novel-folder',
        is_deleted: false
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'chapters' && options.method === 'PATCH') {
      deletedPatch = JSON.parse(options.body);
      return new Response(JSON.stringify([deletedPatch]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (table === 'chapters' && parsedUrl.searchParams.get('chapter_id')) {
      return new Response(JSON.stringify([{
        chapter_id: 53,
        novel_id: 10,
        chapter_number: 2,
        chapter_title: 'Вторая',
        file_id: 'google-doc-53',
        is_deleted: false
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'chapters') {
      return new Response(JSON.stringify([
        { chapter_id: 52, volume_order: 1, chapter_number: 1, file_id: 'doc-52' },
        { chapter_id: 53, volume_order: 1, chapter_number: 2, file_id: 'doc-53' },
        { chapter_id: 54, volume_order: 1, chapter_number: 3, file_id: 'doc-54' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Неожиданный запрос ${parsedUrl}`);
  };
  const result = await handleDirectMutation('deleteChapter', {
    session_token: 'creator-token',
    chapterId: 53
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    },
    updateNovelStats: async () => {},
    updateNovelVolumeStructure: async () => {},
    trashChapterDocument: async () => {},
    syncContents: async () => ({ success: true }),
    syncNavigation: async (_novelId, ids) => {
      navigationIds = ids;
      return { success: true, errors: [] };
    }
  });

  assert.equal(result.success, true);
  assert.equal(deletedPatch.is_deleted, true);
  assert.deepEqual(navigationIds, [52, 54]);
});

test('содержание не показывает заголовок для главы без тома', () => {
  const requests = buildContentsDocumentUpdateRequests({
    body: { content: [{ startIndex: 1, endIndex: 8, paragraph: { elements: [] } }] }
  }, { title: 'Тест 2' }, [{
    volume_name: '', volume_order: 1, chapter_number: 1,
    chapter_title: 'Тест', file_id: 'chapter-one'
  }], 'description-doc');

  assert.equal(requests[1].insertText.text, 'Тест 2\nГлава 1: Тест');
  assert.ok(!requests[1].insertText.text.includes('Основной том'));
  assert.ok(!requests.some(request => (
    request.updateParagraphStyle?.paragraphStyle.namedStyleType === 'HEADING_1'
  )));
});

test('страница чтения получает текст и навигацию без Apps Script', async () => {
  const fetchImpl = async url => {
    const parsedUrl = url instanceof URL ? url : new URL(url);
    if (parsedUrl.hostname === 'oauth2.googleapis.com') {
      return new Response(JSON.stringify({ access_token: 'google-access', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (parsedUrl.hostname === 'docs.googleapis.com') {
      return new Response(JSON.stringify({
        body: {
          content: [
            { paragraph: { elements: [{ textRun: { content: 'Глава 2\n' } }] } },
            { paragraph: { elements: [{ textRun: { content: 'Текст главы\n', textStyle: { italic: true } } }] } }
          ]
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const table = parsedUrl.pathname.split('/').at(-1);
    if (table === 'novels') {
      return new Response(JSON.stringify([{
        novel_id: 8,
        title: 'Новелла',
        slug: 'novel-slug',
        access_type: 'public',
        creator_id: 5,
        is_deleted: false
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'chapters' && parsedUrl.searchParams.has('chapter_number')) {
      return new Response(JSON.stringify([{
        chapter_id: 27,
        novel_id: 8,
        chapter_number: 2,
        chapter_title: 'Вторая',
        file_id: 'google-doc-27',
        is_deleted: false
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'chapters') {
      return new Response(JSON.stringify([
        { chapter_id: 26, novel_id: 8, chapter_number: 1, chapter_title: 'Первая' },
        { chapter_id: 27, novel_id: 8, chapter_number: 2, chapter_title: 'Вторая' },
        { chapter_id: 28, novel_id: 8, chapter_number: 3, chapter_title: 'Третья' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Неожиданный запрос ${parsedUrl}`);
  };
  const result = await handleDirectQuery('getChapter', {
    novel: 'novel-slug',
    chapter: 2
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    },
    googleConfig: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      connected: true
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.chapter.content, 'Текст главы');
  assert.equal(result.chapter.content_rich.blocks[0].runs[0].italic, true);
  assert.equal(result.chapter.prevChapterNumber, 1);
  assert.equal(result.chapter.nextChapterNumber, 3);
});

test('обновление главы записывает документ, имя файла и Supabase напрямую', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  let docsBatch = null;
  let drivePatch = null;
  let chapterPatch = null;
  let contentsSyncNovelId = null;
  const fetchImpl = async (url, options = {}) => {
    const parsedUrl = url instanceof URL ? url : new URL(url);
    if (parsedUrl.hostname === 'oauth2.googleapis.com') {
      return new Response(JSON.stringify({ access_token: 'google-access', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (parsedUrl.hostname === 'docs.googleapis.com' && parsedUrl.pathname.endsWith(':batchUpdate')) {
      docsBatch = JSON.parse(options.body);
      return new Response(JSON.stringify({ replies: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (parsedUrl.hostname === 'docs.googleapis.com') {
      return new Response(JSON.stringify({
        revisionId: 'revision-1',
        body: {
          content: [
            { startIndex: 1, endIndex: 10, paragraph: { elements: [] } },
            { startIndex: 10, endIndex: 25, paragraph: { elements: [] } },
            { startIndex: 25, endIndex: 40, table: {} }
          ]
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (parsedUrl.hostname === 'www.googleapis.com') {
      drivePatch = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: 'google-doc-27', ...drivePatch }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const table = parsedUrl.pathname.split('/').at(-1);
    if (table === 'sessions') {
      return new Response(JSON.stringify([{
        expires_at: future,
        users: { user_id: 9, username: 'Создатель', role: 'creator' }
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'chapters' && options.method === 'PATCH') {
      chapterPatch = JSON.parse(options.body);
      return new Response(JSON.stringify([chapterPatch]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (table === 'chapters' && parsedUrl.searchParams.get('select') === 'word_count') {
      return new Response(JSON.stringify([{ word_count: 4 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (table === 'chapters') {
      return new Response(JSON.stringify([{
        chapter_id: 27,
        novel_id: 8,
        chapter_number: 27,
        chapter_title: 'Старое название',
        file_id: 'google-doc-27',
        is_deleted: false
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'novels' && options.method === 'PATCH') {
      return new Response(options.body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'novels') {
      return new Response(JSON.stringify([{
        novel_id: 8,
        title: 'Новелла',
        creator_id: 9,
        access_type: 'private',
        is_deleted: false
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Неожиданный запрос ${parsedUrl}`);
  };

  const result = await handleDirectMutation('updateChapter', {
    session_token: 'creator-token',
    chapter_id: 27,
    chapter_number: 27,
    chapter_title: 'Новое название',
    volume_name: 'Том 1',
    content: 'Новый текст из четырёх слов',
    content_rich: {
      version: 1,
      blocks: [{ type: 'paragraph', runs: [{ text: 'Новый текст из четырёх слов', bold: true }] }]
    },
    publish_at: ''
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    },
    googleConfig: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      connected: true
    },
    syncContents: async novelId => {
      contentsSyncNovelId = novelId;
      return { success: true, chapter_count: 1 };
    }
  });

  assert.equal(result.success, true);
  assert.equal(docsBatch.writeControl.requiredRevisionId, 'revision-1');
  assert.match(drivePatch.name, /Новое название/);
  assert.equal(chapterPatch.chapter_title, 'Новое название');
  assert.equal(chapterPatch.publish_at, null);
  assert.equal(chapterPatch.word_count, 5);
  assert.equal(contentsSyncNovelId, 8);
});

test('вход проверяет старый хеш пароля и создаёт сессию напрямую', async () => {
  const salt = 'existing-salt';
  const password = 'correct-password';
  const hash = crypto.createHash('sha256').update(`${salt}${password}`).digest('hex');
  let savedSession = null;
  const fetchImpl = async (url, options = {}) => {
    const table = url.pathname.split('/').at(-1);
    if (table === 'users') {
      return new Response(JSON.stringify([{
        user_id: 9,
        username: 'Читатель',
        email: 'reader@example.test',
        role: 'reader',
        password_hash: `${salt}:${hash}`
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'sessions') {
      assert.equal(options.method, 'POST');
      savedSession = JSON.parse(options.body);
      return new Response(JSON.stringify([savedSession]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Неожиданная таблица ${table}`);
  };
  const result = await handleDirectMutation('loginWithEmail', {
    email: 'reader@example.test',
    password
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.user.user_id, 9);
  assert.equal(savedSession.user_id, 9);
  assert.equal(result.session_token, savedSession.token);
});

test('заблокированная учётная запись не может войти', async () => {
  let sessionsTouched = false;
  const fetchImpl = async (url, options = {}) => {
    const table = url.pathname.split('/').at(-1);
    if (table === 'users') {
      return new Response(JSON.stringify([{
        user_id: 9,
        username: 'Заблокированный',
        email: 'blocked@example.test',
        role: 'reader',
        password_hash: 'salt:not-needed',
        is_banned: true
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (table === 'sessions') sessionsTouched = true;
    return new Response('[]', {
      status: options.method === 'POST' ? 201 : 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await handleDirectMutation('loginWithEmail', {
    email: 'blocked@example.test',
    password: 'secret'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.equal(result.success, false);
  assert.match(result.error, /заблокирована/i);
  assert.equal(sessionsTouched, false);
});

test('сессия заблокированного пользователя считается гостевой', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const fetchImpl = async () => new Response(JSON.stringify([{
    expires_at: future,
    users: {
      user_id: 9,
      username: 'Заблокированный',
      role: 'reader',
      is_banned: true
    }
  }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await handleDirectQuery('getInitialData', {
    scope: 'session',
    session_token: 'blocked-token'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.user.user_id, null);
});

test('регистрация создаёт только роль читателя и не хранит открытый пароль', async () => {
  let insertedUser = null;
  const fetchImpl = async (url, options = {}) => {
    const table = url.pathname.split('/').at(-1);
    assert.equal(table, 'users');
    if (options.method === 'POST') {
      insertedUser = JSON.parse(options.body);
      return new Response(JSON.stringify([insertedUser]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await handleDirectMutation('registerWithEmail', {
    username: 'Новый читатель',
    email: 'new@example.test',
    password: 'secret-password'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.equal(result.success, true);
  assert.equal(insertedUser.role, 'reader');
  assert.notEqual(insertedUser.password_hash, 'secret-password');
  assert.match(insertedUser.password_hash, /^[^:]+:[a-f0-9]{64}$/);
});

test('добавление на полку выполняется одним безопасным upsert', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  let shelfRequest = null;
  const fetchImpl = async (url, options = {}) => {
    const table = url.pathname.split('/').at(-1);
    if (table === 'sessions') {
      return new Response(JSON.stringify([{
        expires_at: future,
        users: { user_id: 9, username: 'Читатель', role: 'reader' }
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    shelfRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify([shelfRequest.body]), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await handleDirectMutation('addToReadingList', {
    session_token: 'reader-token',
    novel_id: 8,
    list_type: 'favorite'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.equal(result.success, true);
  assert.equal(shelfRequest.body.user_id, 9);
  assert.equal(shelfRequest.body.novel_id, 8);
  assert.equal(shelfRequest.url.searchParams.get('on_conflict'), 'user_id,novel_id');
  assert.match(shelfRequest.options.headers.Prefer, /merge-duplicates/);
});

test('отметка прочитанной главы обновляет прогресс напрямую', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  let savedProgress = null;
  const fetchImpl = async (url, options = {}) => {
    const table = url.pathname.split('/').at(-1);
    let data = [];
    if (table === 'sessions') {
      data = [{ expires_at: future, users: { user_id: 9, username: 'Читатель', role: 'reader' } }];
    } else if (table === 'chapters' && url.searchParams.has('chapter_id')) {
      data = [{ chapter_id: 27, novel_id: 8, chapter_number: 2 }];
    } else if (table === 'chapters') {
      data = [
        { chapter_id: 26, chapter_number: 1, publish_at: null },
        { chapter_id: 27, chapter_number: 2, publish_at: null }
      ];
    } else if (table === 'reading_progress' && options.method === 'POST') {
      savedProgress = JSON.parse(options.body);
      data = [savedProgress];
    }
    return new Response(JSON.stringify(data), {
      status: options.method === 'POST' ? 201 : 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await handleDirectMutation('markChapterRead', {
    session_token: 'reader-token',
    chapter_id: 27
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.progress, 50);
  assert.deepEqual(savedProgress.read_chapters, [27]);
  assert.equal(savedProgress.last_chapter_number, 2);
});

test('следующий номер главы читается напрямую из Supabase', async () => {
  const fetchImpl = async url => {
    assert.equal(url.searchParams.get('novel_id'), 'eq.8');
    assert.equal(url.searchParams.get('order'), 'chapter_number.desc');
    return new Response(JSON.stringify([{ chapter_number: 27 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await handleDirectQuery('getNextChapterNumber', { novel_id: 8 }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });
  assert.deepEqual(result, { success: true, next_number: 28, max_existing: 27 });
});

test('проверка номера главы возвращает найденную главу', async () => {
  const fetchImpl = async () => new Response(JSON.stringify([
    { chapter_id: 49, chapter_title: 'Проверочная глава' }
  ]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const result = await handleDirectQuery('checkChapterNumber', {
    novel_id: 8,
    chapter_number: 27
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });
  assert.equal(result.success, true);
  assert.equal(result.exists, true);
  assert.equal(result.existing_chapter.id, 49);
});

test('сессионная загрузка возвращает авторизованного пользователя', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const fetchImpl = async () => new Response(JSON.stringify([{
    expires_at: future,
    users: {
      user_id: 0,
      username: 'Владелец',
      email: 'owner@example.test',
      role: 'owner',
      avatar_url: null,
      telegram_id: null
    }
  }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await handleDirectQuery('getInitialData', {
    scope: 'session',
    session_token: 'test-token'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.user.role, 'owner');
  assert.ok(result.user.features.includes('admin_panel'));
});

test('полная загрузка для гостя возвращает только публичные новеллы', async () => {
  const fetchImpl = async url => {
    const table = url.pathname.split('/').at(-1);
    const data = {
      novels: [
        {
          novel_id: 1,
          title: 'Публичная',
          access_type: 'public',
          creator_id: 7,
          creator: { user_id: 7, username: 'Создатель' },
          cover_urls: ['cover-1'],
          novel_authors: [{ authors: { name: 'Автор' } }],
          novel_tags: [{ tags: { tag_id: 3, name: 'Фэнтези' } }]
        },
        { novel_id: 2, title: 'По ссылке', access_type: 'link_only', creator_id: 7 },
        { novel_id: 3, title: 'Приватная', access_type: 'private', creator_id: 7 }
      ],
      tags: [{ tag_id: 3, name: 'Фэнтези', description: null }],
      settings: [{ value: 'midnight' }]
    };
    return new Response(JSON.stringify(data[table] || []), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const result = await handleDirectQuery('getInitialData', { scope: 'full' }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.novels.map(novel => novel.novel_id), [1]);
  assert.equal(result.novels[0].author, 'Автор');
  assert.equal(result.novels[0].cover_url, 'cover-1');
  assert.equal(result.roleTheme, 'midnight');
  assert.deepEqual(result.tags, [{ id: 3, name: 'Фэнтези', description: '' }]);
  assert.ok(result.config.languages.includes('Китайский'));
});

test('полная загрузка соблюдает список чтения и явные разрешения', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const fetchImpl = async url => {
    const table = url.pathname.split('/').at(-1);
    let data = [];
    if (table === 'sessions') {
      data = [{
        expires_at: future,
        users: { user_id: 9, username: 'Читатель', role: 'reader' }
      }];
    } else if (table === 'reading_lists') {
      data = [{ novel_id: 2 }, { novel_id: 4 }];
    } else if (table === 'novel_permissions') {
      data = [{ novel_id: 3 }];
    } else if (table === 'novels') {
      data = [
        { novel_id: 1, title: 'Публичная', access_type: 'public', creator_id: 7 },
        { novel_id: 2, title: 'По ссылке на полке', access_type: 'link_only', creator_id: 7 },
        { novel_id: 3, title: 'Приватная с доступом', access_type: 'private', creator_id: 7 },
        { novel_id: 4, title: 'Приватная только на полке', access_type: 'private', creator_id: 7 },
        { novel_id: 5, title: 'Чужая по ссылке', access_type: 'link_only', creator_id: 7 },
        { novel_id: 6, title: 'Своя приватная', access_type: 'private', creator_id: 9 }
      ];
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const result = await handleDirectQuery('getInitialData', {
    scope: 'full',
    session_token: 'reader-token'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.deepEqual(result.novels.map(novel => novel.novel_id), [1, 2, 3, 6]);
});

test('списки чтения загружаются напрямую для владельца сессии', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const fetchImpl = async url => {
    const table = url.pathname.split('/').at(-1);
    const data = table === 'sessions'
      ? [{ expires_at: future, users: { user_id: 9, username: 'Читатель', role: 'reader' } }]
      : [
          { novel_id: 2, list_type: 'reading', created_at: '2026-01-01', notes: null },
          { novel_id: 3, list_type: 'favorite', created_at: '2026-01-02', notes: 'Любимое' }
        ];
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await handleDirectQuery('getReadingLists', {
    session_token: 'reader-token'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.deepEqual(result.lists.reading.map(item => item.novel_id), [2]);
  assert.deepEqual(result.lists.favorite.map(item => item.novel_id), [3]);
  assert.deepEqual(result.lists.completed, []);
});

test('прогресс чтения учитывает только уже опубликованные главы', async () => {
  const futureSession = new Date(Date.now() + 60_000).toISOString();
  const futureChapter = new Date(Date.now() + 3_600_000).toISOString();
  const fetchImpl = async url => {
    const table = url.pathname.split('/').at(-1);
    let data = [];
    if (table === 'sessions') {
      data = [{ expires_at: futureSession, users: { user_id: 9, username: 'Читатель', role: 'reader' } }];
    } else if (table === 'reading_progress') {
      data = [{
        last_chapter_id: 27,
        last_chapter_number: 2,
        last_paragraph_index: 4,
        progress_percent: 50,
        read_chapters: [26, 27],
        updated_at: '2026-01-03'
      }];
    } else if (table === 'chapters') {
      data = [{ publish_at: null }, { publish_at: '2026-01-01' }, { publish_at: futureChapter }];
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await handleDirectQuery('getReadingProgress', {
    novel_id: 8,
    session_token: 'reader-token'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.equal(result.total_chapters, 2);
  assert.equal(result.chapters_read, 2);
  assert.deepEqual(result.read_chapters, [26, 27]);
  assert.equal(result.last_paragraph_index, 4);
});

test('созданные пользователем новеллы сохраняют прежний формат карточек', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const fetchImpl = async url => {
    const table = url.pathname.split('/').at(-1);
    if (table === 'novels') {
      assert.doesNotMatch(url.searchParams.get('select'), /(^|,)cover_url(,|$)/);
    }
    const data = table === 'sessions'
      ? [{ expires_at: future, users: { user_id: 9, username: 'Создатель', role: 'creator' } }]
      : [{
          novel_id: 8,
          title: 'Новелла',
          cover_urls: ['cover-main', 'cover-alt'],
          chapter_count: 27,
          access_type: 'private',
          is_deleted: false,
          translation_status: 'Продолжается'
        }];
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await handleDirectQuery('getMyCreatedNovels', {
    session_token: 'creator-token'
  }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });

  assert.deepEqual(result.novels, [{
    novel_id: 8,
    title: 'Новелла',
    cover_url: 'cover-main',
    chapter_count: 27,
    access_type: 'private',
    is_deleted: false,
    translation_status: 'Продолжается'
  }]);
});

test('теги преобразуются в клиентский формат', async () => {
  const fetchImpl = async () => new Response(JSON.stringify([
    { tag_id: 3, name: 'Фэнтези', description: null }
  ]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const result = await handleDirectQuery('getTags', {}, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });
  assert.deepEqual(result.tags, [{ id: 3, name: 'Фэнтези', description: '' }]);
});

test('публичная страница новеллы собирается вместе с главами', async () => {
  const fetchImpl = async url => {
    if (url.pathname.endsWith('/novels')) {
      return new Response(JSON.stringify([{
        novel_id: 8,
        title: 'Тестовая новелла',
        slug: 'test-novel',
        access_type: 'public',
        creator_id: 5,
        is_deleted: false,
        creator: { user_id: 5, username: 'Автор' },
        novel_authors: [{ authors: { name: 'Писатель' } }],
        novel_tags: [{ tags: { tag_id: 3, name: 'Фэнтези' } }]
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/chapters')) {
      return new Response(JSON.stringify([{
        chapter_id: 27,
        novel_id: 8,
        chapter_number: 27,
        chapter_title: 'Глава',
        publish_at: null
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Неожиданный путь ${url.pathname}`);
  };
  const result = await handleDirectQuery('getNovel', { id: 8 }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });
  assert.equal(result.success, true);
  assert.equal(result.novel.author, 'Писатель');
  assert.equal(result.novel.chapters.length, 1);
  assert.deepEqual(result.novel.tags, [{ id: 3, name: 'Фэнтези' }]);
});

test('link-only новелла не открывается по числовому ID', async () => {
  const fetchImpl = async () => new Response(JSON.stringify([{
    novel_id: 8,
    title: 'Скрытая новелла',
    slug: 'secret-link',
    access_type: 'link_only',
    creator_id: 5,
    is_deleted: false
  }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await handleDirectQuery('getNovel', { id: 8 }, {
    fetchImpl,
    config: {
      url: 'https://example-ref.supabase.co',
      key: `sb_secret_${'x'.repeat(40)}`,
      configured: true,
      isLegacyKey: false
    }
  });
  assert.equal(result.success, false);
  assert.match(result.error, /ограничен/);
});

test('создание новеллы сохраняет базу и папку без Apps Script', async () => {
  const calls = [];
  const dbRequest = async (table, query = {}, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ table, query, method, body: options.body });
    if (table === 'users') return [{ custom_limit_personal: null, custom_limit_community: null }];
    if (table === 'novels' && method === 'POST') return [{ novel_id: 77 }];
    return [];
  };
  const result = await createNovelDirect({
    title: 'Тестовая новелла',
    description: 'Описание',
    access_type: 'public',
    tags: []
  }, {
    user_id: 12,
    username: 'creator',
    role: 'creator'
  }, {
    dbRequest,
    createNovelDriveResources: async novelId => ({
      folderId: `folder-${novelId}`,
      cover: { file_id: null, url: null },
      contentsId: 'contents',
      descriptionId: 'description'
    })
  });

  assert.equal(result.success, true);
  assert.equal(result.novel_id, 77);
  const insert = calls.find(call => call.table === 'novels' && call.method === 'POST');
  assert.equal(insert.body.storage_type, 'community');
  assert.equal(insert.body.creator_id, 12);
  const finalPatch = calls.find(call => call.table === 'novels' && call.method === 'PATCH');
  assert.equal(finalPatch.body.folder_id, 'folder-77');
  assert.equal(calls.some(call => call.table === 'novel_tags' && call.method === 'DELETE'), true);
});

test('ошибка Google Диска откатывает запись создаваемой новеллы', async () => {
  const calls = [];
  const dbRequest = async (table, query = {}, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ table, query, method, body: options.body });
    if (table === 'novels' && method === 'POST') return [{ novel_id: 78 }];
    return [];
  };
  const result = await createNovelDirect({ title: 'Сбой', tags: [] }, {
    user_id: 0,
    username: 'owner',
    role: 'owner'
  }, {
    dbRequest,
    createNovelDriveResources: async () => {
      throw new Error('Drive недоступен');
    }
  });

  assert.equal(result.success, false);
  assert.match(result.error, /Drive недоступен/);
  assert.equal(calls.some(call => call.table === 'novels' && call.method === 'DELETE'), true);
});

test('мягкое удаление и восстановление новеллы не трогают Google Диск', async () => {
  const patches = [];
  const dbRequest = async (table, query = {}, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (table === 'novels' && method === 'GET') {
      return [{ novel_id: 10, creator_id: 12, is_deleted: false, folder_id: 'drive-folder' }];
    }
    if (table === 'novels' && method === 'PATCH') patches.push(options.body);
    return [];
  };
  const user = { user_id: 12, role: 'creator' };
  const deleted = await deleteNovelDirect({ novelId: 10, permanent: false }, user, { dbRequest });
  const restored = await restoreNovelDirect({ novelId: 10 }, user, { dbRequest });

  assert.equal(deleted.success, true);
  assert.equal(restored.success, true);
  assert.equal(patches[0].is_deleted, true);
  assert.equal(patches[1].is_deleted, false);
  assert.equal(patches[1].deleted_at, null);
});

test('блокировка новеллы принимает camelCase ID из интерфейса', () => {
  assert.equal(getMutationLockKey('deleteNovel', { novelId: 10 }), 'novel:10');
  assert.equal(getMutationLockKey('restoreNovel', { novelId: 10 }), 'novel:10');
});

test('восстановление главы возвращает документ из корзины Google Диска', async () => {
  const driveStates = [];
  let restored = false;
  const dbRequest = async (table, query = {}, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (table === 'chapters' && method === 'GET' && query.chapter_id) {
      return [{
        chapter_id: 49,
        novel_id: 10,
        chapter_number: 1,
        volume_order: 1,
        is_deleted: true,
        file_id: 'chapter-doc'
      }];
    }
    if (table === 'chapters' && method === 'PATCH') {
      restored = true;
      return [{ chapter_id: 49, novel_id: 10, chapter_number: 1, volume_order: 1 }];
    }
    if (table === 'chapters' && query.novel_id) {
      return restored ? [{ chapter_id: 49, chapter_number: 1, volume_order: 1 }] : [];
    }
    return [];
  };
  const result = await restoreFromTrashDirect({ itemType: 'chapter', itemId: 49 }, {
    user_id: 0,
    role: 'owner'
  }, {
    dbRequest,
    setDriveTrashed: async (fileId, value) => driveStates.push([fileId, value]),
    updateNovelStats: async () => {},
    updateNovelVolumeStructure: async () => {},
    syncContents: async () => {},
    syncNavigation: async () => ({ success: true, errors: [] })
  });

  assert.equal(result.success, true);
  assert.deepEqual(driveStates, [['chapter-doc', false]]);
});

test('окончательная очистка главы удаляет запись только после обработки файла', async () => {
  const events = [];
  const dbRequest = async (table, query = {}, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (table === 'chapters' && method === 'GET') {
      return [{ chapter_id: 49, novel_id: 10, is_deleted: true, file_id: 'chapter-doc' }];
    }
    if (table === 'novels' && method === 'GET') {
      return [{ novel_id: 10, creator_id: 12, is_deleted: false }];
    }
    if (table === 'chapters' && method === 'DELETE') events.push('database');
    return [];
  };
  const result = await permanentDeleteChapterDirect({ chapterId: 49 }, {
    user_id: 0,
    role: 'owner'
  }, {
    dbRequest,
    setDriveTrashed: async () => events.push('drive'),
    updateNovelStats: async () => {},
    updateNovelVolumeStructure: async () => {},
    syncContents: async () => {}
  });

  assert.equal(result.success, true);
  assert.deepEqual(events, ['drive', 'database']);
});

test('выдача права обновляет существующую запись без дублей', async () => {
  const calls = [];
  const dbRequest = async (table, query = {}, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ table, query, method, body: options.body });
    if (table === 'novels') return [{ novel_id: 10, creator_id: 12, is_deleted: false }];
    if (table === 'users') return [{ user_id: 25 }];
    if (table === 'novel_permissions' && method === 'PATCH') {
      return [{ novel_id: 10, user_id: 25, permission: options.body.permission }];
    }
    return [];
  };
  const result = await grantPermissionDirect({
    novelId: 10,
    targetUserId: 25,
    permission: 'edit'
  }, {
    user_id: 12,
    role: 'creator'
  }, { dbRequest });

  assert.equal(result.success, true);
  assert.equal(calls.some(call => call.table === 'novel_permissions' && call.method === 'PATCH'), true);
  assert.equal(calls.some(call => call.table === 'novel_permissions' && call.method === 'POST'), false);
});

test('заявка на автора сохраняет уникальные альтернативные имена', async () => {
  let submissionBody = null;
  const dbRequest = async (table, _query = {}, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (table === 'submissions' && method === 'POST') {
      submissionBody = options.body;
      return [{ submission_id: 91 }];
    }
    return [];
  };
  const result = await createAuthorSubmissionDirect({
    name: 'Автор',
    aliases: ['Псевдоним', 'псевдоним', 'Другой'],
    bio: 'Описание'
  }, { user_id: 12, role: 'reader' }, { dbRequest });

  assert.equal(result.success, true);
  assert.deepEqual(submissionBody.payload.aliases, ['псевдоним', 'Другой']);
  assert.equal(submissionBody.created_by, 12);
});

test('удаление аватара согласованно очищает файл и профиль', async () => {
  const events = [];
  const dbRequest = async (table, _query = {}, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (table === 'users' && method === 'GET') {
      return [{ avatar_url: 'https://lh3.googleusercontent.com/d/avatar-file' }];
    }
    if (table === 'users' && method === 'PATCH') {
      events.push(['database', options.body.avatar_url]);
      return [{ user_id: 12 }];
    }
    return [];
  };
  const result = await deleteAvatarDirect({}, { user_id: 12, role: 'reader' }, {
    dbRequest,
    setDriveTrashed: async (fileId, trashed) => events.push(['drive', fileId, trashed])
  });

  assert.equal(result.success, true);
  assert.deepEqual(events, [
    ['drive', 'avatar-file', true],
    ['database', null]
  ]);
});

test('блокировка пользователя завершает его активные сессии', async () => {
  const calls = [];
  const dbRequest = async (table, query, options = {}) => {
    calls.push({ table, query, method: options.method || 'GET', body: options.body });
    if (table === 'users' && !options.method) {
      return [{ user_id: 9, username: 'Читатель', role: 'reader', is_banned: false }];
    }
    if (table === 'users' && options.method === 'PATCH') {
      return [{ user_id: 9, is_banned: true }];
    }
    return [];
  };
  const result = await setUserBlockedDirect(
    { user_id: 9 },
    { user_id: 1, role: 'admin' },
    true,
    { dbRequest }
  );

  assert.equal(result.success, true);
  assert.equal(result.is_banned, true);
  assert.ok(calls.some(call => call.table === 'users' && call.method === 'PATCH' && call.body.is_banned === true));
  assert.ok(calls.some(call => call.table === 'sessions' && call.method === 'DELETE'));
});

test('полное удаление очищает личные записи и передаёт новеллы владельцу', async () => {
  const calls = [];
  const dbRequest = async (table, query, options = {}) => {
    calls.push({ table, query, method: options.method || 'GET', body: options.body });
    if (table === 'users' && !options.method) {
      return [{ user_id: 9, username: 'Создатель', role: 'creator', avatar_url: null }];
    }
    if (table === 'users' && options.method === 'DELETE') {
      return [{ user_id: 9 }];
    }
    return [];
  };
  const result = await deleteUserDirect(
    { user_id: 9 },
    { user_id: 1, role: 'owner' },
    { dbRequest }
  );

  assert.equal(result.success, true);
  assert.ok(calls.some(call => call.table === 'novels' && call.query.owner_id === 'eq.9' && call.body.owner_id === 1));
  assert.ok(calls.some(call => call.table === 'novels' && call.query.creator_id === 'eq.9' && call.body.creator_id === 1));
  for (const table of ['sessions', 'reading_lists', 'reading_progress', 'novel_permissions', 'comments']) {
    assert.ok(calls.some(call => call.table === table && call.method === 'DELETE'));
  }
  assert.ok(calls.some(call => call.table === 'users' && call.method === 'DELETE'));
});

test('администратор не может навсегда удалить пользователя', async () => {
  let dbTouched = false;
  const result = await deleteUserDirect(
    { user_id: 9 },
    { user_id: 2, role: 'admin' },
    { dbRequest: async () => { dbTouched = true; return []; } }
  );

  assert.equal(result.success, false);
  assert.match(result.error, /только владельцу/i);
  assert.equal(dbTouched, false);
});

test('в админ-панели нет раздела полной очистки', async () => {
  const source = await readFile(new URL('./js/admin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /clearDatabaseConfirm|clearDriveFolderConfirm|clearAllDataExceptUsers/);
  assert.doesNotMatch(source, /admin-tab-database/);
  assert.match(source, /handleToggleUserBlock/);
  assert.match(source, /Удалить навсегда/);
});
