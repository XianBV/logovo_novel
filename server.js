import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT_URL = '';
const PRIVATE_FILES = new Set([
  '.env',
  '.env.example',
  'package.json',
  'server.js',
  'server.test.js',
  'code.gs',
  'Supabase.gs'
]);
const CLIENT_CONFIG = Object.freeze({
  languages: ['Китайский', 'Корейский', 'Японский', 'Английский', 'Русский', 'Другой'],
  eras: ['Современность', 'Будущее', 'Альтернативная история', 'Другое'],
  perspectives: ['Главный герой', 'Главная героиня', 'ГГ-шоу', 'ГГ-гун', 'Неизвестно'],
  orientations: ['Без CP', 'Лили', 'Чистая любовь', 'Романтика'],
  statusOptions: ['Завершен', 'Продолжается', 'Заморожен', 'Заброшен']
});
const DIRECT_MUTATION_ACTIONS = new Set([
  'loginWithEmail',
  'registerWithEmail',
  'logout',
  'createNovel',
  'updateNovel',
  'deleteNovel',
  'restoreNovel',
  'restoreFromTrash',
  'permanentDeleteNovel',
  'permanentDeleteChapter',
  'emptyTrash',
  'grantPermission',
  'revokePermission',
  'createAuthorSubmission',
  'uploadAvatar',
  'deleteAvatar',
  'updateUserRole',
  'setRoleTheme',
  'setGlobalLimits',
  'addTag',
  'updateTag',
  'deleteTag',
  'addChapter',
  'updateChapter',
  'deleteChapter',
  'addToReadingList',
  'removeFromReadingList',
  'updateReadingProgress',
  'markChapterRead',
  'markChapterUnread'
]);
const GOOGLE_DRIVE_ROOT_FOLDER_ID = '1QNtdwGiVZFS4FI9MS-scFv3x-KLeb7OK';
const GOOGLE_DRIVE_USERS_FOLDER_ID = '1X1JHzUNGnf0hJIt0dUguGkhl_W_zO4u5';
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents'
];
const googleOAuthStates = new Map();
let googleAccessTokenCache = { token: '', expiresAt: 0, refreshToken: '' };

function loadLocalEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
       (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

function setLocalEnvValue(key, value) {
  const envPath = path.join(ROOT_DIR, '.env');
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const lines = current.split(/\r?\n/);
  const entry = `${key}=${String(value).replace(/\r?\n/g, '')}`;
  let replaced = false;
  const updated = lines.map(line => {
    if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      replaced = true;
      return entry;
    }
    return line;
  });
  if (!replaced) updated.push(entry);
  writeFileSync(envPath, `${updated.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  process.env[key] = String(value);
}

export function getGoogleConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = String(env.GOOGLE_REFRESH_TOKEN || '').trim();
  return {
    clientId,
    clientSecret,
    refreshToken,
    redirectUri: String(
      env.GOOGLE_OAUTH_REDIRECT_URI ||
      `http://127.0.0.1:${port}/api/google/oauth/callback`
    ).trim(),
    rootFolderId: String(env.GOOGLE_DRIVE_ROOT_FOLDER_ID || GOOGLE_DRIVE_ROOT_FOLDER_ID).trim(),
    credentialsConfigured: Boolean(clientId && clientSecret),
    connected: Boolean(clientId && clientSecret && refreshToken)
  };
}

async function exchangeGoogleToken(form, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `Google OAuth: HTTP ${response.status}`);
  }
  return payload;
}

async function getGoogleAccessToken(options = {}) {
  const config = options.googleConfig || (
    options.config?.clientId ? options.config : getGoogleConfig()
  );
  if (!config.connected) throw new Error('Google Диск ещё не подключён');
  const mayUseCache = !options.fetchImpl;
  if (
    mayUseCache &&
    googleAccessTokenCache.refreshToken === config.refreshToken &&
    googleAccessTokenCache.token &&
    googleAccessTokenCache.expiresAt > Date.now()
  ) {
    return googleAccessTokenCache.token;
  }
  const tokens = await exchangeGoogleToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token'
  }, options);
  if (!tokens.access_token) throw new Error('Google не вернул токен доступа');
  if (mayUseCache) {
    googleAccessTokenCache = {
      token: tokens.access_token,
      expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in || 3600) - 60) * 1000,
      refreshToken: config.refreshToken
    };
  }
  return tokens.access_token;
}

async function googleJsonRequest(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const accessToken = await getGoogleAccessToken(options);
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json'
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetchImpl(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Google API: HTTP ${response.status}`);
  }
  return payload;
}

function googleRgbToHex(rgb = {}) {
  const values = ['red', 'green', 'blue'].map(channel => {
    const value = Math.max(0, Math.min(1, Number(rgb[channel] || 0)));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  });
  return `#${values.join('')}`;
}

function hexToGoogleRgb(color) {
  const normalized = /^#[0-9a-f]{6}$/i.test(color || '') ? color.slice(1) : '000000';
  return {
    red: parseInt(normalized.slice(0, 2), 16) / 255,
    green: parseInt(normalized.slice(2, 4), 16) / 255,
    blue: parseInt(normalized.slice(4, 6), 16) / 255
  };
}

function normalizeChapterRichContent(chapterData = {}) {
  try {
    const parsed = typeof chapterData.content_rich === 'string'
      ? JSON.parse(chapterData.content_rich)
      : chapterData.content_rich;
    if (parsed && Array.isArray(parsed.blocks)) {
      return parsed.blocks.map(block => ({
        type: ['quote', 'divider'].includes(block.type) ? block.type : 'paragraph',
        runs: Array.isArray(block.runs) ? block.runs.map(run => ({
          text: String(run.text || ''),
          bold: run.bold === true,
          italic: run.italic === true,
          underline: run.underline === true,
          strike: run.strike === true,
          color: /^#[0-9a-f]{6}$/i.test(run.color || '') ? run.color.toLowerCase() : '',
          size: Number.isFinite(Number(run.size))
            ? Math.max(10, Math.min(48, Math.round(Number(run.size))))
            : null
        })) : []
      }));
    }
  } catch {}

  const plainLines = String(chapterData.content || '').split('\n').filter(line => line.trim() !== '');
  if (!plainLines.length) plainLines.push('[Содержимое главы будет добавлено позже]');
  return plainLines.map(line => ({
    type: 'paragraph',
    runs: [{
      text: line,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      color: '',
      size: null
    }]
  }));
}

export function buildChapterDocumentUpdateRequests(document, chapterData = {}) {
  const structural = Array.isArray(document?.body?.content) ? document.body.content : [];
  const titleElement = structural.find(element => element.paragraph);
  if (!titleElement) throw new Error('В документе главы не найден заголовок');
  const titleStart = Number(titleElement.startIndex || 1);
  const titleEnd = Number(titleElement.endIndex || titleStart + 1);
  const tableElement = structural.find(element => element.table);
  const lastEnd = Number(structural.at(-1)?.endIndex || titleEnd);
  const contentEnd = tableElement
    // Google Docs does not allow deleting the final paragraph marker directly
    // before a table unless the table is deleted too. Keep that marker so the
    // navigation table stays structurally separate from the chapter body.
    ? Math.max(titleEnd, Number(tableElement.startIndex) - 1)
    : Math.max(titleEnd, lastEnd - 1);
  const title = `Глава ${chapterData.chapter_number}: ${chapterData.chapter_title}`;
  const blocks = normalizeChapterRichContent(chapterData);
  const requests = [];

  if (contentEnd > titleEnd) {
    requests.push({
      deleteContentRange: { range: { startIndex: titleEnd, endIndex: contentEnd } }
    });
  }
  if (titleEnd - 1 > titleStart) {
    requests.push({
      deleteContentRange: { range: { startIndex: titleStart, endIndex: titleEnd - 1 } }
    });
  }
  requests.push({ insertText: { location: { index: titleStart }, text: title } });

  const contentInsertIndex = titleStart + title.length;
  const contentStart = contentInsertIndex + 1;
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: titleStart, endIndex: contentStart },
      paragraphStyle: {
        namedStyleType: 'HEADING_1',
        alignment: 'CENTER'
      },
      fields: 'namedStyleType,alignment'
    }
  });
  const insertedText = blocks.map(block => (
    block.type === 'divider'
      ? '\n'
      : `${block.runs.map(run => run.text).join('')}\n`
  )).join('');
  if (insertedText) {
    requests.push({
      insertText: {
        location: { index: contentInsertIndex },
        text: `\n${insertedText}`
      }
    });
  }

  let blockOffset = 0;
  for (const block of blocks) {
    const blockText = block.type === 'divider'
      ? ''
      : block.runs.map(run => run.text).join('');
    const paragraphStart = contentStart + blockOffset;
    const paragraphEnd = paragraphStart + blockText.length + 1;
    const paragraphStyle = {
      namedStyleType: 'NORMAL_TEXT',
      alignment: 'START',
      indentStart: {
        magnitude: block.type === 'quote' ? 36 : 0,
        unit: 'PT'
      },
      indentFirstLine: { magnitude: 0, unit: 'PT' }
    };
    let paragraphFields = 'namedStyleType,alignment,indentStart,indentFirstLine';
    if (block.type === 'divider') {
      paragraphStyle.borderBottom = {
        color: { color: { rgbColor: { red: 0.55, green: 0.55, blue: 0.55 } } },
        width: { magnitude: 1.5, unit: 'PT' },
        padding: { magnitude: 6, unit: 'PT' },
        dashStyle: 'SOLID'
      };
      paragraphFields += ',borderBottom';
    }
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: paragraphStart, endIndex: paragraphEnd },
        paragraphStyle,
        fields: paragraphFields
      }
    });

    let runOffset = 0;
    for (const run of block.runs) {
      const runText = String(run.text || '');
      if (!runText) continue;
      const startIndex = paragraphStart + runOffset;
      const endIndex = startIndex + runText.length;
      requests.push({
        updateTextStyle: {
          range: { startIndex, endIndex },
          textStyle: {
            bold: run.bold === true,
            italic: run.italic === true,
            underline: run.underline === true,
            strikethrough: run.strike === true,
            foregroundColor: {
              color: { rgbColor: hexToGoogleRgb(run.color || '#000000') }
            },
            fontSize: { magnitude: run.size || 11, unit: 'PT' }
          },
          fields: 'bold,italic,underline,strikethrough,foregroundColor,fontSize'
        }
      });
      runOffset += runText.length;
    }
    blockOffset += blockText.length + 1;
  }
  return requests;
}

export function buildContentsDocumentUpdateRequests(document, novel = {}, chapters = [], descriptionFileId = '') {
  const structural = Array.isArray(document?.body?.content) ? document.body.content : [];
  const lastEnd = Number(structural.at(-1)?.endIndex || 1);
  const sortedChapters = [...chapters].sort((a, b) => (
    (Number(a.volume_order ?? 9999) - Number(b.volume_order ?? 9999)) ||
    (Number(a.chapter_number) - Number(b.chapter_number))
  ));
  const volumes = new Map();

  for (const chapter of sortedChapters) {
    const volumeName = String(chapter.volume_name || 'Основной том').trim() || 'Основной том';
    if (!volumes.has(volumeName)) {
      volumes.set(volumeName, {
        name: volumeName,
        order: Number(chapter.volume_order ?? 9999),
        chapters: []
      });
    }
    volumes.get(volumeName).chapters.push(chapter);
  }

  const orderedVolumes = [...volumes.values()].sort((a, b) => a.order - b.order);
  const lines = [{
    text: String(novel.title || 'Без названия'),
    style: 'TITLE',
    alignment: 'CENTER',
    link: descriptionFileId
      ? `https://docs.google.com/document/d/${descriptionFileId}/edit`
      : ''
  }];

  orderedVolumes.forEach((volume, volumeIndex) => {
    if (volume.name !== 'Основной том') {
      lines.push({ text: volume.name, style: 'HEADING_1', alignment: 'START', link: '' });
    }
    for (const chapter of volume.chapters) {
      lines.push({
        text: `Глава ${chapter.chapter_number}: ${chapter.chapter_title}`,
        style: 'NORMAL_TEXT',
        alignment: 'START',
        link: chapter.file_id
          ? `https://docs.google.com/document/d/${chapter.file_id}/edit`
          : ''
      });
    }
    if (volumeIndex < orderedVolumes.length - 1) {
      lines.push({ text: '', style: 'NORMAL_TEXT', alignment: 'START', link: '' });
    }
  });

  const text = lines.map(line => line.text).join('\n');
  const requests = [];
  if (lastEnd > 1) {
    requests.push({
      deleteContentRange: { range: { startIndex: 1, endIndex: lastEnd - 1 } }
    });
  }
  if (text) {
    requests.push({ insertText: { location: { index: 1 }, text } });
    requests.push({
      updateTextStyle: {
        range: { startIndex: 1, endIndex: 1 + text.length },
        textStyle: {},
        fields: 'bold,italic,underline,strikethrough,foregroundColor,fontSize,link'
      }
    });
  }

  let offset = 0;
  for (const line of lines) {
    const startIndex = 1 + offset;
    const textEnd = startIndex + line.text.length;
    const paragraphEnd = textEnd + 1;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex, endIndex: paragraphEnd },
        paragraphStyle: {
          namedStyleType: line.style,
          alignment: line.alignment
        },
        fields: 'namedStyleType,alignment'
      }
    });
    if (line.text && line.link) {
      requests.push({
        updateTextStyle: {
          range: { startIndex, endIndex: textEnd },
          textStyle: { link: { url: line.link } },
          fields: 'link'
        }
      });
    }
    offset += line.text.length + 1;
  }
  return requests;
}

async function listGoogleDriveFolderFiles(folderId, options = {}) {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', `'${String(folderId).replaceAll("'", "\\'")}' in parents and trashed = false`);
  url.searchParams.set('fields', 'files(id,name,mimeType,trashed)');
  url.searchParams.set('pageSize', '1000');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  const result = await googleJsonRequest(url, options);
  return Array.isArray(result.files) ? result.files : [];
}

export async function updateContentsDocumentDirect(novelId, options = {}) {
  const novel = await getNovelRecordDirect(novelId, options);
  if (!novel?.folder_id) throw new Error('У новеллы не найдена папка Google Drive');

  const files = await listGoogleDriveFolderFiles(novel.folder_id, options);
  const contentsFile = files.find(file => (
    file.name === 'Содержание' && file.mimeType === 'application/vnd.google-apps.document'
  ));
  if (!contentsFile) throw new Error('В папке новеллы не найден документ «Содержание»');
  const descriptionFile = files.find(file => (
    file.name === 'Описание' && file.mimeType === 'application/vnd.google-apps.document'
  ));

  const chapterRows = await supabaseRestRequest('chapters', {
    novel_id: `eq.${Number(novel.novel_id)}`,
    is_deleted: 'eq.false',
    select: 'chapter_id,volume_name,volume_order,chapter_number,chapter_title,file_id,publish_at',
    order: 'volume_order.asc,chapter_number.asc'
  }, options);
  const now = Date.now();
  const visibleChapters = chapterRows.filter(chapter => (
    !chapter.publish_at || new Date(chapter.publish_at).getTime() <= now
  ));
  const document = await googleJsonRequest(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(contentsFile.id)}`,
    options
  );
  const requests = buildContentsDocumentUpdateRequests(
    document,
    novel,
    visibleChapters,
    descriptionFile?.id || ''
  );
  const body = { requests };
  if (document.revisionId) body.writeControl = { requiredRevisionId: document.revisionId };
  await googleJsonRequest(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(contentsFile.id)}:batchUpdate`,
    { ...options, method: 'POST', body }
  );
  return {
    success: true,
    document_id: contentsFile.id,
    chapter_count: visibleChapters.length
  };
}

async function getOrCreateGoogleDriveFolder(parentId, name, options = {}) {
  const files = await listGoogleDriveFolderFiles(parentId, options);
  const existing = files.find(file => (
    file.name === name && file.mimeType === 'application/vnd.google-apps.folder'
  ));
  if (existing) return existing;
  return googleJsonRequest('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,parents', {
    ...options,
    method: 'POST',
    body: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    }
  });
}

function sortChapterRows(rows = []) {
  return [...rows].sort((a, b) => (
    (Number(a.volume_order ?? 9999) - Number(b.volume_order ?? 9999)) ||
    (Number(a.chapter_number) - Number(b.chapter_number))
  ));
}

function getNavigationTableCellRanges(document) {
  const structural = Array.isArray(document?.body?.content) ? document.body.content : [];
  const tableElement = structural.find(element => element.table);
  const cells = tableElement?.table?.tableRows?.[0]?.tableCells || [];
  return {
    tableElement,
    cells: cells.slice(0, 3).map(cell => {
      const cellContent = Array.isArray(cell.content) ? cell.content : [];
      const firstParagraph = cellContent.find(element => element.paragraph);
      const lastParagraph = [...cellContent].reverse().find(element => element.paragraph);
      return firstParagraph && lastParagraph ? {
        startIndex: Number(firstParagraph.startIndex),
        endIndex: Number(lastParagraph.endIndex)
      } : null;
    })
  };
}

async function updateChapterNavigationDocumentDirect(chapter, previous, next, contentsDocId, options = {}) {
  if (!chapter?.file_id) return { success: false, error: 'У главы отсутствует Google-документ' };
  const documentUrl = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(chapter.file_id)}`;
  let document = await googleJsonRequest(documentUrl, options);
  let navigation = getNavigationTableCellRanges(document);

  if (!navigation.tableElement) {
    const structural = Array.isArray(document?.body?.content) ? document.body.content : [];
    const lastEnd = Number(structural.at(-1)?.endIndex || 1);
    const insertIndex = Math.max(1, lastEnd - 1);
    const insertBody = {
      requests: [{
        insertTable: {
          rows: 1,
          columns: 3,
          location: { index: insertIndex }
        }
      }]
    };
    if (document.revisionId) insertBody.writeControl = { requiredRevisionId: document.revisionId };
    await googleJsonRequest(`${documentUrl}:batchUpdate`, {
      ...options,
      method: 'POST',
      body: insertBody
    });
    document = await googleJsonRequest(documentUrl, options);
    navigation = getNavigationTableCellRanges(document);
  }

  if (navigation.cells.length < 3 || navigation.cells.some(cell => !cell)) {
    throw new Error(`В документе главы ${chapter.chapter_id} не удалось подготовить таблицу навигации`);
  }

  const entries = [
    previous?.file_id ? {
      text: '◀ Предыдущая',
      url: `https://docs.google.com/document/d/${previous.file_id}/edit`,
      alignment: 'START'
    } : { text: '', url: '', alignment: 'START' },
    contentsDocId ? {
      text: '📖 Содержание',
      url: `https://docs.google.com/document/d/${contentsDocId}/edit`,
      alignment: 'CENTER'
    } : { text: '', url: '', alignment: 'CENTER' },
    next?.file_id ? {
      text: 'Следующая ▶',
      url: `https://docs.google.com/document/d/${next.file_id}/edit`,
      alignment: 'END'
    } : { text: '', url: '', alignment: 'END' }
  ];
  const requests = [];

  navigation.cells
    .map((cell, index) => ({ cell, entry: entries[index] }))
    .sort((a, b) => b.cell.startIndex - a.cell.startIndex)
    .forEach(({ cell, entry }) => {
      if (cell.endIndex - 1 > cell.startIndex) {
        requests.push({
          deleteContentRange: {
            range: { startIndex: cell.startIndex, endIndex: cell.endIndex - 1 }
          }
        });
      }
      if (entry.text) {
        requests.push({ insertText: { location: { index: cell.startIndex }, text: entry.text } });
        requests.push({
          updateTextStyle: {
            range: { startIndex: cell.startIndex, endIndex: cell.startIndex + entry.text.length },
            textStyle: { link: { url: entry.url } },
            fields: 'link'
          }
        });
      }
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: cell.startIndex,
            endIndex: cell.startIndex + entry.text.length + 1
          },
          paragraphStyle: { alignment: entry.alignment },
          fields: 'alignment'
        }
      });
    });

  const updateBody = { requests };
  if (document.revisionId) updateBody.writeControl = { requiredRevisionId: document.revisionId };
  await googleJsonRequest(`${documentUrl}:batchUpdate`, {
    ...options,
    method: 'POST',
    body: updateBody
  });
  return { success: true };
}

async function syncChapterNavigationDirect(novelId, chapterIds, options = {}) {
  const novel = await getNovelRecordDirect(novelId, options);
  if (!novel?.folder_id) return { success: false, errors: ['У новеллы не найдена папка Google Drive'] };
  const [files, rows] = await Promise.all([
    listGoogleDriveFolderFiles(novel.folder_id, options),
    supabaseRestRequest('chapters', {
      novel_id: `eq.${Number(novel.novel_id)}`,
      is_deleted: 'eq.false',
      select: 'chapter_id,volume_name,volume_order,chapter_number,chapter_title,file_id',
      order: 'volume_order.asc,chapter_number.asc'
    }, options)
  ]);
  const contentsDocId = files.find(file => (
    file.name === 'Содержание' && file.mimeType === 'application/vnd.google-apps.document'
  ))?.id || '';
  const chapters = sortChapterRows(rows);
  const targets = new Set((chapterIds || []).map(Number));
  const errors = [];

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (!targets.has(Number(chapter.chapter_id))) continue;
    try {
      await updateChapterNavigationDocumentDirect(
        chapter,
        index > 0 ? chapters[index - 1] : null,
        index < chapters.length - 1 ? chapters[index + 1] : null,
        contentsDocId,
        options
      );
    } catch (error) {
      errors.push(`Глава ${chapter.chapter_id}: ${error.message}`);
    }
  }
  return { success: errors.length === 0, errors };
}

export function extractChapterContentFromGoogleDocument(document) {
  const structuralElements = Array.isArray(document?.body?.content)
    ? document.body.content
    : [];
  const blocks = [];
  const plainLines = [];
  let skippedTitle = false;

  for (const structural of structuralElements) {
    if (structural.table) break;
    const paragraph = structural.paragraph;
    if (!paragraph) continue;
    if (!skippedTitle) {
      skippedTitle = true;
      continue;
    }

    const elements = Array.isArray(paragraph.elements) ? paragraph.elements : [];
    const hasDividerBorder = Number(paragraph.paragraphStyle?.borderBottom?.width?.magnitude || 0) > 0;
    if (elements.some(element => element.horizontalRule) || hasDividerBorder) {
      blocks.push({ type: 'divider', runs: [] });
      plainLines.push('');
      continue;
    }

    const block = {
      type: Number(paragraph.paragraphStyle?.indentStart?.magnitude || 0) >= 30
        ? 'quote'
        : 'paragraph',
      runs: []
    };
    for (const element of elements) {
      if (!element.textRun) continue;
      let text = String(element.textRun.content || '');
      if (text.endsWith('\n')) text = text.slice(0, -1);
      if (!text) continue;
      const style = element.textRun.textStyle || {};
      const color = style.foregroundColor?.color?.rgbColor
        ? googleRgbToHex(style.foregroundColor.color.rgbColor)
        : '';
      const size = Number(style.fontSize?.magnitude);
      block.runs.push({
        text,
        bold: style.bold === true,
        italic: style.italic === true,
        underline: style.underline === true,
        strike: style.strikethrough === true,
        color: color && color !== '#000000' ? color : '',
        size: Number.isFinite(size) && Math.round(size) !== 11 ? Math.round(size) : null
      });
    }
    const paragraphText = block.runs.map(run => run.text).join('');
    blocks.push(block);
    plainLines.push(paragraphText);
  }

  while (
    blocks.length &&
    blocks.at(-1).type === 'paragraph' &&
    blocks.at(-1).runs.length === 0
  ) {
    blocks.pop();
    plainLines.pop();
  }
  return {
    content: plainLines.join('\n').trim(),
    content_rich: { version: 1, blocks }
  };
}

async function readChapterGoogleDocument(documentId, options = {}) {
  if (!documentId) return { content: '', content_rich: null };
  const document = await googleJsonRequest(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
    options
  );
  return extractChapterContentFromGoogleDocument(document);
}

export async function checkGoogleDriveConnection(options = {}) {
  const config = options.googleConfig || (
    options.config?.clientId ? options.config : getGoogleConfig()
  );
  if (!config.connected) {
    return {
      success: false,
      credentials_configured: config.credentialsConfigured,
      connected: false
    };
  }
  const fetchImpl = options.fetchImpl || fetch;
  const accessToken = await getGoogleAccessToken({ ...options, config });
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${config.rootFolderId}`);
  url.searchParams.set('fields', 'id,name,mimeType,trashed');
  url.searchParams.set('supportsAllDrives', 'true');
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const folder = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(folder.error?.message || `Google Drive: HTTP ${response.status}`);
  if (folder.trashed) throw new Error('Корневая папка Google Диска находится в корзине');
  return {
    success: true,
    credentials_configured: true,
    connected: true,
    folder: {
      id: folder.id,
      name: folder.name,
      mimeType: folder.mimeType
    }
  };
}

function createGoogleAuthorizationUrl() {
  const config = getGoogleConfig();
  if (!config.credentialsConfigured) {
    throw new Error('Сначала заполните GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET в .env');
  }
  const state = crypto.randomBytes(24).toString('hex');
  googleOAuthStates.set(state, Date.now() + 10 * 60 * 1000);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  }).toString();
  return url.toString();
}

async function completeGoogleAuthorization(requestUrl, options = {}) {
  const state = String(requestUrl.searchParams.get('state') || '');
  const expiresAt = googleOAuthStates.get(state);
  googleOAuthStates.delete(state);
  if (!state || !expiresAt || expiresAt < Date.now()) {
    throw new Error('Ссылка подключения устарела. Начните подключение заново.');
  }
  if (requestUrl.searchParams.get('error')) {
    throw new Error('Доступ к Google Диску не был разрешён');
  }
  const code = String(requestUrl.searchParams.get('code') || '');
  if (!code) throw new Error('Google не вернул код авторизации');
  const config = options.googleConfig || (
    options.config?.clientId ? options.config : getGoogleConfig()
  );
  const tokens = await exchangeGoogleToken({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code'
  }, options);
  if (!tokens.refresh_token) {
    throw new Error('Google не выдал долгоживущий токен. Повторите подключение с подтверждением доступа.');
  }
  setLocalEnvValue('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
  return { success: true };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  let hostedSecretKey = '';
  try {
    const hostedSecretKeys = JSON.parse(String(env.SUPABASE_SECRET_KEYS || '{}'));
    hostedSecretKey = String(
      hostedSecretKeys.default || Object.values(hostedSecretKeys)[0] || ''
    ).trim();
  } catch {
    hostedSecretKey = '';
  }
  const key = String(
    env.SUPABASE_SECRET_KEY ||
    hostedSecretKey ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY ||
    ''
  ).trim();

  return {
    url,
    key,
    configured: /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && key.length >= 30,
    isLegacyKey: key !== '' && !key.startsWith('sb_secret_')
  };
}

export async function checkSupabaseConnection(options = {}) {
  const config = options.config || getSupabaseConfig();
  const fetchImpl = options.fetchImpl || fetch;
  if (!config.configured) {
    throw new Error('SUPABASE_URL и серверный ключ ещё не заполнены в .env');
  }

  const headers = { apikey: config.key };
  if (config.isLegacyKey) headers.Authorization = `Bearer ${config.key}`;

  const response = await fetchImpl(
    `${config.url}/rest/v1/novels?select=novel_id&limit=1`,
    { method: 'GET', headers }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase отклонил подключение: HTTP ${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ''}`);
  }

  return { success: true, configured: true };
}

export async function supabaseRestRequest(table, query = {}, options = {}) {
  const config = options.config || getSupabaseConfig();
  const fetchImpl = options.fetchImpl || fetch;
  if (!config.configured) {
    throw new Error('Подключение к Supabase ещё не настроено');
  }

  const url = new URL(`${config.url}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    apikey: config.key,
    Accept: 'application/json'
  };
  if (config.isLegacyKey) headers.Authorization = `Bearer ${config.key}`;
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = options.prefer || 'return=representation';
  }

  const response = await fetchImpl(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ошибка Supabase: HTTP ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function anonymousUser() {
  return {
    user_id: null,
    username: 'Аноним',
    role: 'reader',
    avatar_url: null,
    auth_type: 'anonymous',
    features: []
  };
}

export async function resolveSessionUser(params = {}, options = {}) {
  if (!params.session_token) return anonymousUser();

  const rows = await supabaseRestRequest('sessions', {
    token: `eq.${params.session_token}`,
    select: 'expires_at,users(user_id,username,email,role,avatar_url,telegram_id)',
    limit: 1
  }, options);
  const session = rows[0];
  const sessionUser = session?.users;
  const expiresAt = session?.expires_at ? new Date(session.expires_at) : null;
  if (!sessionUser || !expiresAt || expiresAt <= new Date()) return anonymousUser();

  const features = ['personal_novels', 'community_novels'];
  if (sessionUser.role === 'admin' || sessionUser.role === 'owner') {
    features.push('admin_panel');
  }
  return {
    user_id: sessionUser.user_id,
    username: sessionUser.username,
    email: sessionUser.email || null,
    role: sessionUser.role,
    avatar_url: sessionUser.avatar_url || null,
    auth_type: sessionUser.telegram_id ? 'telegram' : 'email',
    features
  };
}

async function getTagsDirect(options = {}) {
  const rows = await supabaseRestRequest('tags', {
    is_active: 'eq.true',
    select: 'tag_id,name,description',
    order: 'name.asc'
  }, options);
  return rows.map(tag => ({
    id: tag.tag_id,
    name: tag.name,
    description: tag.description || ''
  }));
}

async function getTrashDirect(user, options = {}) {
  if (!user || !['admin', 'owner'].includes(user.role)) {
    return { success: false, error: 'Нет прав на просмотр корзины' };
  }
  const db = options.dbRequest || supabaseRestRequest;
  const [novels, chapters] = await Promise.all([
    db('novels', {
      is_deleted: 'eq.true',
      select: 'novel_id,title,deleted_at'
    }, options),
    db('chapters', {
      is_deleted: 'eq.true',
      select: 'chapter_id,chapter_number,chapter_title,deleted_at'
    }, options)
  ]);
  const items = [
    ...novels.map(novel => ({
      item_type: 'novel',
      item_id: novel.novel_id,
      title: novel.title || `Новелла ID: ${novel.novel_id}`,
      deleted_at: novel.deleted_at
    })),
    ...chapters.map(chapter => ({
      item_type: 'chapter',
      item_id: chapter.chapter_id,
      title: `Глава ${chapter.chapter_number}: ${chapter.chapter_title || ''}`.trim(),
      deleted_at: chapter.deleted_at
    }))
  ].sort((a, b) => new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0));
  return { success: true, items };
}

async function getNovelPermissionsDirect(params, user, options = {}) {
  const novelId = Number(params.novelId ?? params.novel_id);
  if (!Number.isFinite(novelId)) return { success: false, error: 'Не передан ID новеллы' };
  const novel = await getNovelIncludingDeletedDirect(novelId, options);
  if (!novel || !canManageNovelDirect(novel, user)) {
    return { success: false, error: 'Нет доступа к списку прав' };
  }
  const db = options.dbRequest || supabaseRestRequest;
  const rows = await db('novel_permissions', {
    novel_id: `eq.${novelId}`,
    select: 'permission,granted_at,user_id,users(username,email,avatar_url)',
    order: 'granted_at.desc'
  }, options);
  return {
    success: true,
    permissions: rows.map(row => ({
      user_id: row.user_id,
      permission: row.permission,
      granted_at: row.granted_at,
      username: row.users?.username || 'Неизвестный пользователь',
      email: row.users?.email || '',
      avatar_url: row.users?.avatar_url || ''
    }))
  };
}

async function searchUserForPermissionDirect(params, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const query = String(params.query || '').trim().replace(/[,*()]/g, '');
  if (query.length < 2) return { success: true, users: [] };
  const db = options.dbRequest || supabaseRestRequest;
  const rows = await db('users', {
    or: `(username.ilike.*${query}*,email.ilike.*${query}*)`,
    select: 'user_id,username,email,avatar_url,role',
    order: 'username.asc',
    limit: 10
  }, options);
  return {
    success: true,
    users: rows.map(row => ({
      user_id: row.user_id,
      username: row.username,
      email: row.email || '',
      avatar_url: row.avatar_url || '',
      role: row.role
    }))
  };
}

async function getUserPublicProfileDirect(params, currentUser, options = {}) {
  const profileUserId = Number(params.userId ?? params.user_id);
  if (!Number.isFinite(profileUserId)) return { success: false, error: 'Пользователь не найден' };
  const db = options.dbRequest || supabaseRestRequest;
  const profileRows = await db('users', {
    user_id: `eq.${profileUserId}`,
    select: 'user_id,username,avatar_url,bio,created_at',
    limit: 1
  }, options);
  const profile = profileRows[0];
  if (!profile) return { success: false, error: 'Пользователь не найден' };

  const hasCurrentUser = currentUser?.user_id !== null && currentUser?.user_id !== undefined;
  const seesEverything = hasCurrentUser && (
    String(currentUser.user_id) === '0' ||
    String(currentUser.user_id) === String(profileUserId) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'owner'
  );
  const [novels, readingRows, permissionRows] = await Promise.all([
    db('novels', {
      creator_id: `eq.${profileUserId}`,
      is_deleted: 'eq.false',
      select: 'novel_id,title,cover_urls,language,translation_status,access_type,novel_authors(authors(name))',
      order: 'updated_at.desc'
    }, options),
    hasCurrentUser && !seesEverything
      ? db('reading_lists', { user_id: `eq.${currentUser.user_id}`, select: 'novel_id' }, options)
      : Promise.resolve([]),
    hasCurrentUser && !seesEverything
      ? db('novel_permissions', { user_id: `eq.${currentUser.user_id}`, select: 'novel_id' }, options)
      : Promise.resolve([])
  ]);
  const readingIds = new Set(readingRows.map(row => String(row.novel_id)));
  const permittedIds = new Set(permissionRows.map(row => String(row.novel_id)));
  const visible = novels.filter(novel => {
    if (seesEverything || novel.access_type === 'public') return true;
    if (!hasCurrentUser) return false;
    const id = String(novel.novel_id);
    if (novel.access_type === 'link_only') return readingIds.has(id) || permittedIds.has(id);
    return novel.access_type === 'private' && permittedIds.has(id);
  }).map(novel => ({
    novel_id: novel.novel_id,
    title: novel.title,
    cover_url: Array.isArray(novel.cover_urls) ? novel.cover_urls[0] || null : null,
    language: novel.language,
    translation_status: novel.translation_status,
    access_type: novel.access_type,
    author: novel.novel_authors?.[0]?.authors?.name || 'Неизвестно'
  }));
  return {
    success: true,
    user: {
      user_id: profile.user_id,
      username: profile.username,
      avatar_url: profile.avatar_url,
      bio: profile.bio,
      created_at: profile.created_at
    },
    novels: visible,
    novels_count: visible.length
  };
}

async function getSubmissionsDirect(params, user, options = {}) {
  if (!user || !['admin', 'owner'].includes(user.role)) {
    return { success: false, error: 'Нет прав на просмотр заявок' };
  }
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'cancelled', 'all']);
  const allowedTypes = new Set(['author', 'tag', 'novel_request', 'other', 'all']);
  const status = allowedStatuses.has(params.status) ? params.status : 'pending';
  const type = allowedTypes.has(params.type) ? params.type : 'all';
  const query = {
    select: 'submission_id,submission_type,title,body,payload,status,created_by,reviewed_by,review_comment,result_entity_type,result_entity_id,created_at,updated_at,reviewed_at',
    order: 'created_at.desc'
  };
  if (status !== 'all') query.status = `eq.${status}`;
  if (type !== 'all') query.submission_type = `eq.${type}`;
  const db = options.dbRequest || supabaseRestRequest;
  const submissions = await db('submissions', query, options);
  return { success: true, submissions };
}

function requireAdministrator(user, ownerOnly = false) {
  const isOwner = user && (user.role === 'owner' || String(user.user_id) === '0');
  if (ownerOnly) return isOwner ? null : { success: false, error: 'Это действие доступно только владельцу' };
  return user && (isOwner || user.role === 'admin')
    ? null
    : { success: false, error: 'Доступ запрещён' };
}

async function getAllUsersDirect(user, options = {}) {
  const accessError = requireAdministrator(user);
  if (accessError) return accessError;
  const db = options.dbRequest || supabaseRestRequest;
  const users = await db('users', {
    select: 'user_id,telegram_id,username,email,role,created_at,last_active,avatar_url,custom_limit_personal,custom_limit_community',
    order: 'created_at.desc',
    limit: 100
  }, options);
  return { success: true, users };
}

async function searchUsersDirect(params, user, options = {}) {
  const accessError = requireAdministrator(user);
  if (accessError) return accessError;
  const text = String(params.query || '').trim().replace(/[,*()]/g, '');
  const db = options.dbRequest || supabaseRestRequest;
  const query = {
    select: 'user_id,telegram_id,username,email,role,created_at,last_active,avatar_url,custom_limit_personal,custom_limit_community',
    order: 'created_at.desc',
    limit: 50
  };
  if (text) query.or = `(username.ilike.*${text}*,email.ilike.*${text}*,telegram_id.ilike.*${text}*)`;
  const rows = await db('users', query, options);
  const users = rows.map(row => ({
    ...row,
    custom_limits: {
      personal: row.custom_limit_personal ?? 10,
      community: row.custom_limit_community ?? 50
    }
  }));
  return { success: true, users, count: users.length };
}

async function getSettingDirect(params, user, options = {}) {
  const accessError = requireAdministrator(user);
  if (accessError) return accessError;
  const key = String(params.key || '').trim();
  if (!key) return { success: false, error: 'Не указан ключ настройки' };
  const db = options.dbRequest || supabaseRestRequest;
  const rows = await db('settings', { key: `eq.${key}`, select: 'value', limit: 1 }, options);
  return { success: true, key, value: rows[0]?.value ?? null };
}

async function getDashboardDataDirect(user, options = {}) {
  const accessError = requireAdministrator(user);
  if (accessError) return accessError;
  const db = options.dbRequest || supabaseRestRequest;
  const [activeNovels, activeChapters, activeTags, deletedNovels, deletedChapters, recentNovels, errorNovels, recentUsers] = await Promise.all([
    db('novels', { is_deleted: 'eq.false', select: 'novel_id' }, options),
    db('chapters', { is_deleted: 'eq.false', select: 'chapter_id' }, options),
    db('tags', { is_active: 'eq.true', select: 'tag_id' }, options),
    db('novels', { is_deleted: 'eq.true', select: 'novel_id' }, options),
    db('chapters', { is_deleted: 'eq.true', select: 'chapter_id' }, options),
    db('novels', { is_deleted: 'eq.false', select: 'novel_id,title,created_at', order: 'created_at.desc', limit: 5 }, options),
    db('novels', { original_status: 'eq.error', select: 'novel_id,title,description', limit: 5 }, options),
    db('users', { select: 'user_id,username,created_at', order: 'created_at.desc', limit: 5 }, options)
  ]);
  return {
    success: true,
    stats: {
      novels: activeNovels.length,
      chapters: activeChapters.length,
      tags: activeTags.length,
      trashItems: deletedNovels.length + deletedChapters.length,
      lastUpdated: new Date().toISOString()
    },
    errorNovels,
    recentNovels,
    recentUsers
  };
}

async function cleanupSessionsDirect(user, options = {}) {
  const accessError = requireAdministrator(user);
  if (accessError) return accessError;
  const db = options.dbRequest || supabaseRestRequest;
  const removed = await db('sessions', { expires_at: `lt.${new Date().toISOString()}` }, {
    ...options,
    method: 'DELETE'
  });
  return { success: true, deletedCount: removed.length };
}

async function getRoleThemeDirect(options = {}) {
  const rows = await supabaseRestRequest('settings', {
    key: 'eq.roleTheme',
    select: 'value',
    limit: 1
  }, options);
  return rows[0]?.value || 'default';
}

function mapCatalogNovel(row) {
  const authors = Array.isArray(row.novel_authors)
    ? row.novel_authors
        .map(link => link.authors?.name)
        .filter(Boolean)
        .join(', ')
    : '';
  const tags = Array.isArray(row.novel_tags)
    ? row.novel_tags
        .map(link => link.tags ? { id: link.tags.tag_id, name: link.tags.name } : null)
        .filter(Boolean)
    : [];
  const coverUrl = Array.isArray(row.cover_urls) && row.cover_urls.length
    ? row.cover_urls[0]
    : (row.cover_url || null);

  return {
    novel_id: row.novel_id,
    title: row.title,
    author: authors || 'Автор не указан',
    cover_url: coverUrl,
    language: row.language,
    era: row.era,
    perspective: row.perspective,
    orientation: row.orientation,
    chapter_count: row.chapter_count,
    created_at: row.created_at,
    creator: {
      user_id: row.creator_id,
      username: row.creator?.username || 'Неизвестен'
    },
    translation_status: row.translation_status,
    original_chapter_count: row.original_chapter_count,
    original_status: row.original_status || 'Не указан',
    original_word_count: row.original_word_count || 0,
    slug: row.slug || null,
    access_type: row.access_type || 'public',
    tags,
    description: row.description || '',
    updated_at: row.updated_at
  };
}

async function getVisibleNovelsDirect(user, options = {}) {
  const hasUser = user && user.user_id !== null && user.user_id !== undefined;
  const seesEverything = hasUser && (
    String(user.user_id) === '0' || user.role === 'admin' || user.role === 'owner'
  );
  let readingListRows = [];
  let permissionRows = [];

  if (hasUser && !seesEverything) {
    [readingListRows, permissionRows] = await Promise.all([
      supabaseRestRequest('reading_lists', {
        user_id: `eq.${user.user_id}`,
        select: 'novel_id'
      }, options),
      supabaseRestRequest('novel_permissions', {
        user_id: `eq.${user.user_id}`,
        select: 'novel_id'
      }, options)
    ]);
  }

  const readingListIds = new Set(readingListRows.map(row => String(row.novel_id)));
  const permittedIds = new Set(permissionRows.map(row => String(row.novel_id)));
  const userId = hasUser ? String(user.user_id) : null;
  const rows = await supabaseRestRequest('novels', {
    is_deleted: 'eq.false',
    select: '*,creator:creator_id(user_id,username),novel_authors(authors(name)),novel_tags(tags(tag_id,name))',
    order: 'updated_at.desc'
  }, options);

  return rows.filter(row => {
    if (seesEverything || row.access_type === 'public') return true;
    if (!userId) return false;

    const novelId = String(row.novel_id);
    const isCreator = String(row.creator_id) === userId;
    if (row.access_type === 'link_only') {
      return isCreator || readingListIds.has(novelId) || permittedIds.has(novelId);
    }
    if (row.access_type === 'private') {
      return isCreator || permittedIds.has(novelId);
    }
    return false;
  }).map(mapCatalogNovel);
}

function requireSignedInUser(user) {
  if (!user || user.user_id === null || user.user_id === undefined) {
    return { success: false, error: 'Требуется авторизация.' };
  }
  return null;
}

async function getReadingListsDirect(user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;

  const lists = {
    reading: [],
    completed: [],
    want_to_read: [],
    favorite: [],
    dropped: []
  };
  const rows = await supabaseRestRequest('reading_lists', {
    user_id: `eq.${user.user_id}`,
    select: 'novel_id,list_type,created_at,updated_at,notes'
  }, options);
  for (const item of rows) {
    if (!Array.isArray(lists[item.list_type])) continue;
    lists[item.list_type].push({
      novel_id: item.novel_id,
      added_at: item.created_at,
      updated_at: item.updated_at,
      notes: item.notes || ''
    });
  }
  return { success: true, lists };
}

async function getReadingProgressDirect(params, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const novelId = Number(params.novel_id);
  if (!Number.isFinite(novelId)) return { success: false, error: 'Не передан ID новеллы' };

  const [progressRows, chapterRows] = await Promise.all([
    supabaseRestRequest('reading_progress', {
      user_id: `eq.${user.user_id}`,
      novel_id: `eq.${novelId}`,
      select: '*',
      limit: 1
    }, options),
    supabaseRestRequest('chapters', {
      novel_id: `eq.${novelId}`,
      deleted_at: 'is.null',
      select: 'publish_at'
    }, options)
  ]);

  const now = new Date();
  const totalChapters = chapterRows.filter(chapter => (
    !chapter.publish_at || new Date(chapter.publish_at) <= now
  )).length;
  if (!progressRows.length) {
    return {
      success: true,
      progress: 0,
      chapters_read: 0,
      total_chapters: totalChapters,
      read_chapters: [],
      last_paragraph_index: 0
    };
  }

  const progress = progressRows[0];
  const readChapters = Array.isArray(progress.read_chapters) ? progress.read_chapters : [];
  return {
    success: true,
    last_chapter_id: progress.last_chapter_id,
    last_chapter_number: progress.last_chapter_number,
    last_paragraph_index: progress.last_paragraph_index || 0,
    chapters_read: readChapters.length,
    total_chapters: totalChapters,
    progress: progress.progress_percent,
    read_chapters: readChapters,
    updated_at: progress.updated_at
  };
}

async function getMyCreatedNovelsDirect(user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const rows = await supabaseRestRequest('novels', {
    creator_id: `eq.${user.user_id}`,
    select: 'novel_id,title,cover_urls,cover_url,chapter_count,access_type,is_deleted,translation_status',
    order: 'updated_at.desc'
  }, options);
  return {
    success: true,
    novels: rows.map(novel => ({
      novel_id: novel.novel_id,
      title: novel.title,
      cover_url: Array.isArray(novel.cover_urls) && novel.cover_urls.length
        ? novel.cover_urls[0]
        : (novel.cover_url || null),
      chapter_count: novel.chapter_count,
      access_type: novel.access_type,
      is_deleted: novel.is_deleted,
      translation_status: novel.translation_status
    }))
  };
}

function userFeatures(user) {
  const features = ['personal_novels', 'community_novels'];
  if (user.role === 'admin' || user.role === 'owner') features.push('admin_panel');
  return features;
}

function publicSessionUser(user) {
  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email || null,
    role: user.role,
    avatar_url: user.avatar_url || null,
    auth_type: user.telegram_id ? 'telegram' : 'email',
    features: userFeatures(user)
  };
}

function passwordHash(password, salt = crypto.randomUUID()) {
  const digest = crypto.createHash('sha256').update(`${salt}${password}`, 'utf8').digest('hex');
  return `${salt}:${digest}`;
}

function passwordMatches(password, storedHash) {
  if (!storedHash || !String(storedHash).includes(':')) return false;
  const separator = String(storedHash).indexOf(':');
  const salt = String(storedHash).slice(0, separator);
  const expected = String(storedHash).slice(separator + 1);
  const actual = crypto.createHash('sha256').update(`${salt}${password}`, 'utf8').digest('hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function loginWithEmailDirect(data, options = {}) {
  const email = String(data.email || '').trim().toLowerCase();
  const password = String(data.password || '');
  if (!email || !password) return { success: false, error: 'Заполните email и пароль' };

  const users = await supabaseRestRequest('users', {
    email: `eq.${email}`,
    select: 'user_id,username,email,role,avatar_url,telegram_id,password_hash',
    limit: 1
  }, options);
  if (!users.length) return { success: false, error: 'Пользователь с таким email не найден' };
  const user = users[0];
  if (!user.password_hash) return { success: false, error: 'У пользователя не задан пароль' };
  if (!passwordMatches(password, user.password_hash)) {
    return { success: false, error: 'Неверный пароль' };
  }

  const token = crypto.randomUUID();
  const now = new Date();
  await supabaseRestRequest('sessions', {}, {
    ...options,
    method: 'POST',
    body: {
      token,
      user_id: user.user_id,
      created_at: now.toISOString(),
      last_used: now.toISOString(),
      expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
  return { success: true, user: publicSessionUser(user), session_token: token };
}

async function registerWithEmailDirect(data, options = {}) {
  const username = String(data.username || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  const password = String(data.password || '');
  if (username.length < 2) return { success: false, error: 'Имя пользователя слишком короткое' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'Некорректный email' };
  }
  if (password.length < 6) return { success: false, error: 'Пароль должен быть минимум 6 символов' };

  const existing = await supabaseRestRequest('users', {
    email: `eq.${email}`,
    select: 'user_id',
    limit: 1
  }, options);
  if (existing.length) return { success: false, error: 'Пользователь с таким email уже существует' };

  const timestamp = new Date().toISOString();
  await supabaseRestRequest('users', {}, {
    ...options,
    method: 'POST',
    body: {
      username,
      email,
      role: 'reader',
      password_hash: passwordHash(password),
      created_at: timestamp,
      last_active: timestamp,
      avatar_url: null
    }
  });
  return { success: true, message: 'Регистрация прошла успешно' };
}

async function logoutDirect(data, options = {}) {
  const token = String(data.session_token || '').trim();
  if (!token) return { success: false, error: 'Token is required' };
  await supabaseRestRequest('sessions', { token: `eq.${token}` }, {
    ...options,
    method: 'DELETE'
  });
  return { success: true };
}

async function addToReadingListDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const validTypes = new Set(['reading', 'completed', 'want_to_read', 'favorite', 'dropped']);
  const listType = String(data.list_type || '');
  const novelId = Number(data.novel_id);
  if (!validTypes.has(listType)) return { success: false, error: 'Неверный тип списка' };
  if (!Number.isFinite(novelId)) return { success: false, error: 'Не передан ID новеллы' };
  const timestamp = new Date().toISOString();
  await supabaseRestRequest('reading_lists', {
    on_conflict: 'user_id,novel_id'
  }, {
    ...options,
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      user_id: user.user_id,
      novel_id: novelId,
      list_type: listType,
      created_at: timestamp,
      updated_at: timestamp,
      notes: ''
    }
  });
  return { success: true, message: 'Добавлено в список' };
}

async function removeFromReadingListDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const novelId = Number(data.novel_id);
  if (!Number.isFinite(novelId)) return { success: false, error: 'Не передан ID новеллы' };
  await supabaseRestRequest('reading_lists', {
    user_id: `eq.${user.user_id}`,
    novel_id: `eq.${novelId}`
  }, { ...options, method: 'DELETE' });
  return { success: true, message: 'Удалено из списка' };
}

async function getChapterAndPublishedRows(chapterId, options = {}) {
  const chapters = await supabaseRestRequest('chapters', {
    chapter_id: `eq.${chapterId}`,
    is_deleted: 'eq.false',
    select: 'chapter_id,novel_id,chapter_number',
    limit: 1
  }, options);
  if (!chapters.length) return null;
  const chapter = chapters[0];
  const publishedRows = await supabaseRestRequest('chapters', {
    novel_id: `eq.${chapter.novel_id}`,
    deleted_at: 'is.null',
    select: 'chapter_id,chapter_number,publish_at'
  }, options);
  const now = new Date();
  return {
    chapter,
    publishedRows: publishedRows.filter(row => !row.publish_at || new Date(row.publish_at) <= now)
  };
}

async function updateReadingProgressDirectMutation(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const chapterId = Number(data.chapter_id);
  if (!Number.isFinite(chapterId)) return { success: false, error: 'Не передан ID главы' };
  const chapterData = await getChapterAndPublishedRows(chapterId, options);
  if (!chapterData) return { success: false, error: 'Глава не найдена' };
  const { chapter, publishedRows } = chapterData;
  const novelId = Number(data.novel_id || chapter.novel_id);
  if (novelId !== Number(chapter.novel_id)) return { success: false, error: 'Глава не принадлежит этой новелле' };

  const progressRows = await supabaseRestRequest('reading_progress', {
    user_id: `eq.${user.user_id}`,
    novel_id: `eq.${novelId}`,
    select: '*',
    limit: 1
  }, options);
  const readChapters = new Set((progressRows[0]?.read_chapters || []).map(Number));
  readChapters.add(chapterId);
  const updatedReadChapters = [...readChapters];
  const percent = publishedRows.length
    ? Math.round((updatedReadChapters.length / publishedRows.length) * 100)
    : 0;
  await supabaseRestRequest('reading_progress', {
    on_conflict: 'user_id,novel_id'
  }, {
    ...options,
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      user_id: user.user_id,
      novel_id: novelId,
      last_chapter_id: chapterId,
      last_chapter_number: chapter.chapter_number,
      read_chapters: updatedReadChapters,
      progress_percent: percent,
      last_paragraph_index: Number(data.last_paragraph_index || data.paragraph_index || 0),
      updated_at: new Date().toISOString()
    }
  });
  return {
    success: true,
    progress: percent,
    chapters_read: updatedReadChapters.length,
    total_chapters: publishedRows.length,
    last_chapter: chapter.chapter_number
  };
}

async function markChapterUnreadDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const chapterId = Number(data.chapter_id);
  if (!Number.isFinite(chapterId)) return { success: false, error: 'Не передан ID главы' };
  const chapterData = await getChapterAndPublishedRows(chapterId, options);
  if (!chapterData) return { success: false, error: 'Глава не найдена' };
  const { chapter, publishedRows } = chapterData;
  const progressRows = await supabaseRestRequest('reading_progress', {
    user_id: `eq.${user.user_id}`,
    novel_id: `eq.${chapter.novel_id}`,
    select: '*',
    limit: 1
  }, options);
  if (!progressRows.length) return { success: true, message: 'Прогресс пуст', progress: 0 };

  const current = progressRows[0];
  const remaining = (current.read_chapters || []).map(Number).filter(id => id !== chapterId);
  if (remaining.length === (current.read_chapters || []).length) {
    return { success: true, message: 'Глава и так не прочитана', progress: current.progress_percent || 0 };
  }
  if (!remaining.length) {
    await supabaseRestRequest('reading_progress', {
      user_id: `eq.${user.user_id}`,
      novel_id: `eq.${chapter.novel_id}`
    }, { ...options, method: 'DELETE' });
    return { success: true, message: 'Прогресс сброшен', progress: 0, chapters_read: 0 };
  }

  const remainingSet = new Set(remaining);
  const remainingRows = publishedRows
    .filter(row => remainingSet.has(Number(row.chapter_id)))
    .sort((a, b) => Number(a.chapter_number) - Number(b.chapter_number));
  const last = remainingRows.at(-1) || null;
  const percent = publishedRows.length ? Math.round((remaining.length / publishedRows.length) * 100) : 0;
  await supabaseRestRequest('reading_progress', {
    user_id: `eq.${user.user_id}`,
    novel_id: `eq.${chapter.novel_id}`
  }, {
    ...options,
    method: 'PATCH',
    body: {
      read_chapters: remaining,
      progress_percent: percent,
      last_chapter_id: last?.chapter_id || null,
      last_chapter_number: last?.chapter_number || null,
      updated_at: new Date().toISOString()
    }
  });
  return {
    success: true,
    progress: percent,
    chapters_read: remaining.length,
    total_chapters: publishedRows.length
  };
}

function countWords(text) {
  const normalized = String(text || '').trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

async function updateNovelStatsDirect(novelId, options = {}) {
  const rows = await supabaseRestRequest('chapters', {
    novel_id: `eq.${novelId}`,
    is_deleted: 'eq.false',
    select: 'word_count'
  }, options);
  const translationWordCount = rows.reduce((sum, row) => sum + Number(row.word_count || 0), 0);
  await supabaseRestRequest('novels', { novel_id: `eq.${novelId}` }, {
    ...options,
    method: 'PATCH',
    body: {
      chapter_count: rows.length,
      translation_word_count: translationWordCount,
      updated_at: new Date().toISOString()
    }
  });
}

function determineVolumeOrder(rows, volumeName, excludeChapterId = null) {
  const normalized = String(volumeName || '').trim();
  if (!normalized) return 1;
  const comparableRows = rows.filter(row => (
    excludeChapterId === null || String(row.chapter_id) !== String(excludeChapterId)
  ));
  const existing = comparableRows.find(row => String(row.volume_name || '').trim() === normalized);
  if (existing && Number.isFinite(Number(existing.volume_order))) return Number(existing.volume_order);
  const maxOrder = comparableRows.reduce(
    (max, row) => Math.max(max, Number(row.volume_order) || 0),
    0
  );
  return maxOrder + 1;
}

async function updateNovelVolumeStructureDirect(novelId, options = {}) {
  const rows = await supabaseRestRequest('chapters', {
    novel_id: `eq.${Number(novelId)}`,
    is_deleted: 'eq.false',
    select: 'volume_name'
  }, options);
  const names = new Set(rows.map(row => String(row.volume_name || '').trim()).filter(Boolean));
  const hasVolumes = names.size > 1 || (
    names.size === 1 && !['Том 1', 'Основной том'].includes([...names][0])
  );
  await supabaseRestRequest('novels', { novel_id: `eq.${Number(novelId)}` }, {
    ...options,
    method: 'PATCH',
    body: { has_volumes: hasVolumes }
  });
  return hasVolumes;
}

async function createChapterGoogleDocumentDirect(chapterData, parentFolderId, options = {}) {
  const created = await googleJsonRequest('https://docs.googleapis.com/v1/documents', {
    ...options,
    method: 'POST',
    body: { title: `Глава ${chapterData.chapter_number} - ${chapterData.chapter_title}` }
  });
  const documentId = created.documentId;
  if (!documentId) throw new Error('Google Docs не вернул ID созданной главы');
  try {
    const moveUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentId)}`);
    moveUrl.searchParams.set('addParents', parentFolderId);
    moveUrl.searchParams.set('removeParents', 'root');
    moveUrl.searchParams.set('fields', 'id,name,parents');
    moveUrl.searchParams.set('supportsAllDrives', 'true');
    await googleJsonRequest(moveUrl, { ...options, method: 'PATCH', body: {} });

    const document = await googleJsonRequest(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
      options
    );
    const body = { requests: buildChapterDocumentUpdateRequests(document, chapterData) };
    if (document.revisionId) body.writeControl = { requiredRevisionId: document.revisionId };
    await googleJsonRequest(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      { ...options, method: 'POST', body }
    );
    return documentId;
  } catch (error) {
    await googleJsonRequest(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentId)}?supportsAllDrives=true`,
      { ...options, method: 'PATCH', body: { trashed: true } }
    ).catch(() => {});
    throw error;
  }
}

async function resolveChapterParentFolderDirect(novel, volumeName, options = {}) {
  return volumeName && volumeName !== 'Том 1'
    ? getOrCreateGoogleDriveFolder(novel.folder_id, volumeName, options)
    : getOrCreateGoogleDriveFolder(novel.folder_id, 'Главы', options);
}

async function addChapterDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const novelId = Number(data.novel_id);
  const chapterNumber = Number(data.chapter_number);
  const chapterTitle = String(data.chapter_title || '').trim();
  const volumeName = String(data.volume_name || '').trim();
  if (!Number.isFinite(novelId)) return { success: false, error: 'Не передан ID новеллы' };
  if (!Number.isFinite(chapterNumber) || !chapterTitle) {
    return { success: false, error: 'Не указан номер или название главы' };
  }
  const novel = await getNovelRecordDirect(novelId, options);
  if (!novel || !await canEditNovelDirect(novel, user, options)) {
    return { success: false, error: 'У вас нет прав на добавление главы в эту новеллу' };
  }
  if (!novel.folder_id) return { success: false, error: 'У новеллы отсутствует папка Google Drive' };

  const existingRows = await supabaseRestRequest('chapters', {
    novel_id: `eq.${novelId}`,
    is_deleted: 'eq.false',
    select: 'chapter_id,volume_name,volume_order,chapter_number,chapter_title,file_id,publish_at',
    order: 'volume_order.asc,chapter_number.asc'
  }, options);
  if (existingRows.some(row => Number(row.chapter_number) === chapterNumber)) {
    return { success: false, error: `Глава №${chapterNumber} уже существует.` };
  }

  let publishAt = null;
  if (data.publish_at) {
    const date = new Date(data.publish_at);
    if (Number.isNaN(date.getTime())) return { success: false, error: 'Некорректная дата публикации' };
    publishAt = date.toISOString();
  }
  const volumeOrder = determineVolumeOrder(existingRows, volumeName);
  const resolveParentFolder = options.resolveChapterParentFolder || resolveChapterParentFolderDirect;
  const createChapterDocument = options.createChapterDocument || createChapterGoogleDocumentDirect;
  const parentFolder = await resolveParentFolder(novel, volumeName, options);
  let fileId = '';
  let insertedChapter = null;
  try {
    fileId = await createChapterDocument({
      ...data,
      chapter_number: chapterNumber,
      chapter_title: chapterTitle
    }, parentFolder.id, options);
    const now = new Date().toISOString();
    const inserted = await supabaseRestRequest('chapters', {}, {
      ...options,
      method: 'POST',
      body: {
        novel_id: novelId,
        volume_name: volumeName,
        volume_order: volumeOrder,
        chapter_number: chapterNumber,
        chapter_title: chapterTitle,
        file_id: fileId,
        word_count: countWords(data.content),
        publish_at: publishAt,
        created_at: now,
        updated_at: now,
        is_deleted: false
      }
    });
    insertedChapter = inserted[0];
    if (!insertedChapter?.chapter_id) throw new Error('Supabase не вернул ID созданной главы');
  } catch (error) {
    if (fileId && !insertedChapter) {
      await googleJsonRequest(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
        { ...options, method: 'PATCH', body: { trashed: true } }
      ).catch(() => {});
    }
    throw error;
  }

  const updateStats = options.updateNovelStats || updateNovelStatsDirect;
  const updateVolumeStructure = options.updateNovelVolumeStructure || updateNovelVolumeStructureDirect;
  const syncContents = options.syncContents || updateContentsDocumentDirect;
  const syncNavigation = options.syncNavigation || syncChapterNavigationDirect;
  await Promise.all([
    updateStats(novelId, options),
    updateVolumeStructure(novelId, options),
    syncContents(novelId, options)
  ]);
  const planned = sortChapterRows([...existingRows, insertedChapter]);
  const index = planned.findIndex(row => Number(row.chapter_id) === Number(insertedChapter.chapter_id));
  const navigationIds = [
    insertedChapter.chapter_id,
    index > 0 ? planned[index - 1].chapter_id : null,
    index < planned.length - 1 ? planned[index + 1].chapter_id : null
  ].filter(Boolean);
  const navigation = await syncNavigation(novelId, navigationIds, options);
  return {
    success: true,
    chapter_id: insertedChapter.chapter_id,
    word_count: Number(insertedChapter.word_count || countWords(data.content)),
    navigation_warning: navigation.success ? undefined : navigation.errors.join('; ')
  };
}

async function deleteChapterDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const chapterId = Number(data.chapter_id ?? data.chapterId);
  if (!Number.isFinite(chapterId)) return { success: false, error: 'Не передан ID главы' };
  const rows = await supabaseRestRequest('chapters', {
    chapter_id: `eq.${chapterId}`,
    is_deleted: 'eq.false',
    select: '*',
    limit: 1
  }, options);
  const chapter = rows[0];
  if (!chapter) return { success: false, error: 'Глава не найдена или уже удалена' };
  const novel = await getNovelRecordDirect(chapter.novel_id, options);
  if (!novel || !await canEditNovelDirect(novel, user, options)) {
    return { success: false, error: 'У вас нет прав на удаление этой главы' };
  }
  const activeRows = sortChapterRows(await supabaseRestRequest('chapters', {
    novel_id: `eq.${Number(chapter.novel_id)}`,
    is_deleted: 'eq.false',
    select: 'chapter_id,volume_name,volume_order,chapter_number,chapter_title,file_id',
    order: 'volume_order.asc,chapter_number.asc'
  }, options));
  const index = activeRows.findIndex(row => Number(row.chapter_id) === chapterId);
  const navigationIds = [
    index > 0 ? activeRows[index - 1].chapter_id : null,
    index >= 0 && index < activeRows.length - 1 ? activeRows[index + 1].chapter_id : null
  ].filter(Boolean);

  const now = new Date().toISOString();
  await supabaseRestRequest('chapters', { chapter_id: `eq.${chapterId}` }, {
    ...options,
    method: 'PATCH',
    body: { is_deleted: true, deleted_at: now, updated_at: now }
  });
  let driveWarning;
  if (chapter.file_id) {
    const trashChapterDocument = options.trashChapterDocument || (fileId => (
      googleJsonRequest(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
        { ...options, method: 'PATCH', body: { trashed: true } }
      )
    ));
    try {
      await trashChapterDocument(chapter.file_id, options);
    } catch (error) {
      driveWarning = error.message;
    }
  }
  const updateStats = options.updateNovelStats || updateNovelStatsDirect;
  const updateVolumeStructure = options.updateNovelVolumeStructure || updateNovelVolumeStructureDirect;
  const syncContents = options.syncContents || updateContentsDocumentDirect;
  const syncNavigation = options.syncNavigation || syncChapterNavigationDirect;
  await Promise.all([
    updateStats(chapter.novel_id, options),
    updateVolumeStructure(chapter.novel_id, options),
    syncContents(chapter.novel_id, options)
  ]);
  const navigation = await syncNavigation(chapter.novel_id, navigationIds, options);
  return {
    success: true,
    drive_warning: driveWarning,
    navigation_warning: navigation.success ? undefined : navigation.errors.join('; ')
  };
}

async function updateChapterDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const chapterId = Number(data.chapter_id);
  const chapterNumber = Number(data.chapter_number);
  const chapterTitle = String(data.chapter_title || '').trim();
  if (!Number.isFinite(chapterId)) return { success: false, error: 'Не передан ID главы' };
  if (!Number.isFinite(chapterNumber) || !chapterTitle) {
    return { success: false, error: 'Не указан номер или название главы' };
  }

  const chapterRows = await supabaseRestRequest('chapters', {
    chapter_id: `eq.${chapterId}`,
    is_deleted: 'eq.false',
    select: '*',
    limit: 1
  }, options);
  if (!chapterRows.length) return { success: false, error: 'Глава не найдена или была удалена' };
  const currentChapter = chapterRows[0];
  const novel = await getNovelRecordDirect(currentChapter.novel_id, options);
  if (!novel || !await canEditNovelDirect(novel, user, options)) {
    return { success: false, error: 'У вас нет прав на редактирование этой главы' };
  }

  if (chapterNumber !== Number(currentChapter.chapter_number)) {
    const duplicates = await supabaseRestRequest('chapters', {
      novel_id: `eq.${currentChapter.novel_id}`,
      chapter_number: `eq.${chapterNumber}`,
      chapter_id: `neq.${chapterId}`,
      is_deleted: 'eq.false',
      select: 'chapter_id',
      limit: 1
    }, options);
    if (duplicates.length) {
      return { success: false, error: 'Глава с таким номером уже существует в этой новелле.' };
    }
  }
  if (!currentChapter.file_id) return { success: false, error: 'У главы отсутствует файл Google Docs' };

  const volumeName = data.volume_name !== undefined
    ? String(data.volume_name).trim()
    : String(currentChapter.volume_name || '').trim();
  const contentsMetadataChanged = (
    chapterNumber !== Number(currentChapter.chapter_number) ||
    chapterTitle !== String(currentChapter.chapter_title || '') ||
    volumeName !== String(currentChapter.volume_name || '')
  );

  let publishAtValue;
  if (data.publish_at !== undefined) {
    if (!data.publish_at) {
      publishAtValue = null;
    } else {
      const publishDate = new Date(data.publish_at);
      if (Number.isNaN(publishDate.getTime())) {
        return { success: false, error: 'Некорректная дата публикации' };
      }
      publishAtValue = publishDate.toISOString();
    }
  }

  const googleDocument = await googleJsonRequest(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(currentChapter.file_id)}`,
    options
  );
  const requests = buildChapterDocumentUpdateRequests(googleDocument, data);
  const batchBody = { requests };
  if (googleDocument.revisionId) {
    batchBody.writeControl = { requiredRevisionId: googleDocument.revisionId };
  }
  await googleJsonRequest(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(currentChapter.file_id)}:batchUpdate`,
    { ...options, method: 'POST', body: batchBody }
  );
  await googleJsonRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(currentChapter.file_id)}?supportsAllDrives=true`,
    {
      ...options,
      method: 'PATCH',
      body: { name: `Глава ${chapterNumber} - ${chapterTitle}` }
    }
  );

  const wordCount = countWords(data.content);
  const chapterPatch = {
    volume_name: volumeName,
    chapter_number: chapterNumber,
    chapter_title: chapterTitle,
    word_count: wordCount,
    updated_at: new Date().toISOString()
  };
  if (data.publish_at !== undefined) chapterPatch.publish_at = publishAtValue;
  await supabaseRestRequest('chapters', { chapter_id: `eq.${chapterId}` }, {
    ...options,
    method: 'PATCH',
    body: chapterPatch
  });
  await updateNovelStatsDirect(currentChapter.novel_id, options);
  if (contentsMetadataChanged) {
    const syncContents = options.syncContents || updateContentsDocumentDirect;
    await syncContents(currentChapter.novel_id, options);
  }
  return { success: true, word_count: wordCount };
}

const NOVEL_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]);

function isTruthyFormValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function generateNovelSlugDirect(title) {
  const transliteration = {
    А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'ZH', З: 'Z',
    И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R',
    С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'H', Ц: 'C', Ч: 'CH', Ш: 'SH', Щ: 'SCH',
    Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'YU', Я: 'YA'
  };
  const words = String(title || '').trim().match(/[\p{L}\p{N}]+/gu) || [];
  const slug = words.map(word => {
    const first = word[0].toUpperCase();
    return transliteration[first] ?? (/^[A-Z0-9]$/.test(first) ? first : '');
  }).join('');
  return slug || 'NOVEL';
}

async function ensureUniqueNovelSlugDirect(title, options = {}) {
  const db = options.dbRequest || supabaseRestRequest;
  const base = generateNovelSlugDirect(title);
  const rows = await db('novels', { slug: `eq.${base}`, select: 'novel_id', limit: 1 }, options);
  if (!rows.length) return base;
  return `${base}-${Math.floor(Date.now() / 1000)}`;
}

async function findOrCreateAuthorDirect(authorName, options = {}) {
  const db = options.dbRequest || supabaseRestRequest;
  const name = String(authorName || '').trim();
  if (!name) return null;
  const existing = await db('authors', {
    name: `ilike.${name}`,
    select: 'author_id',
    limit: 1
  }, options);
  if (existing.length) return existing[0].author_id;
  const created = await db('authors', {}, {
    ...options,
    method: 'POST',
    body: { name, aliases: '' }
  });
  if (!created[0]?.author_id) throw new Error('Не удалось сохранить автора новеллы');
  return created[0].author_id;
}

async function syncNovelAuthorDirect(novelId, authorName, options = {}, knownAuthorId = null) {
  const db = options.dbRequest || supabaseRestRequest;
  const name = String(authorName || '').trim();
  const authorId = knownAuthorId || (name ? await findOrCreateAuthorDirect(name, options) : null);
  await db('novel_authors', { novel_id: `eq.${Number(novelId)}` }, {
    ...options,
    method: 'DELETE'
  });
  if (authorId) {
    await db('novel_authors', {}, {
      ...options,
      method: 'POST',
      body: { novel_id: Number(novelId), author_id: authorId }
    });
  }
  return authorId;
}

async function syncNovelTagsDirect(novelId, tags, options = {}) {
  const db = options.dbRequest || supabaseRestRequest;
  const names = [...new Set((Array.isArray(tags) ? tags : [])
    .map(tag => String(tag || '').trim())
    .filter(Boolean))];
  const tagIds = [];
  for (const name of names) {
    const existing = await db('tags', { name: `eq.${name}`, select: 'tag_id', limit: 1 }, options);
    let tagId = existing[0]?.tag_id;
    if (!tagId) {
      const created = await db('tags', {}, {
        ...options,
        method: 'POST',
        body: { name, is_active: true }
      });
      tagId = created[0]?.tag_id;
    }
    if (!tagId) throw new Error(`Не удалось сохранить тег «${name}»`);
    tagIds.push(tagId);
  }
  await db('novel_tags', { novel_id: `eq.${Number(novelId)}` }, {
    ...options,
    method: 'DELETE'
  });
  if (tagIds.length) {
    await db('novel_tags', {}, {
      ...options,
      method: 'POST',
      body: tagIds.map(tagId => ({ novel_id: Number(novelId), tag_id: tagId }))
    });
  }
}

async function createGoogleDriveFolderDirect(parentId, name, options = {}) {
  return googleJsonRequest('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,parents', {
    ...options,
    method: 'POST',
    body: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    }
  });
}

async function uploadGoogleDriveFileDirect({ parentId, name, mimeType, bytes }, options = {}) {
  const accessToken = await getGoogleAccessToken(options);
  const fetchImpl = options.fetchImpl || fetch;
  const boundary = `novel-lair-${crypto.randomBytes(12).toString('hex')}`;
  const metadata = Buffer.from(JSON.stringify({ name, parents: [parentId] }), 'utf8');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const response = await fetchImpl(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || `Не удалось загрузить обложку: HTTP ${response.status}`);
  }
  await googleJsonRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(payload.id)}/permissions?supportsAllDrives=true`,
    { ...options, method: 'POST', body: { type: 'anyone', role: 'reader' } }
  );
  return payload;
}

function parseNovelCoverDataUrl(value) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(value || ''));
  if (!match) throw new Error('Не удалось прочитать файл обложки');
  const mimeType = match[1].toLowerCase();
  if (!NOVEL_IMAGE_MIME_TYPES.has(mimeType)) throw new Error('Поддерживаются JPG, PNG, GIF и WebP');
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
    throw new Error('Размер обложки должен быть не больше 10 МБ');
  }
  return { mimeType, bytes };
}

async function processNovelCoverDirect(data, imageFolderId, options = {}) {
  if (options.processNovelCover) return options.processNovelCover(data, imageFolderId, options);
  let image;
  if (data.cover_base64) {
    image = parseNovelCoverDataUrl(data.cover_base64);
  } else if (String(data.cover_url || '').trim()) {
    let url;
    try {
      url = new URL(String(data.cover_url).trim());
    } catch {
      throw new Error('Некорректная ссылка на обложку');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Некорректная ссылка на обложку');
    const response = await (options.imageFetchImpl || fetch)(url, {
      headers: { 'User-Agent': 'NovelLibraryBot/1.0' },
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`Не удалось загрузить обложку (код ${response.status})`);
    const mimeType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!NOVEL_IMAGE_MIME_TYPES.has(mimeType)) throw new Error('Ссылка ведёт не на поддерживаемое изображение');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
      throw new Error('Размер обложки должен быть не больше 10 МБ');
    }
    image = { mimeType, bytes };
  } else {
    return { file_id: null, url: null };
  }
  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  }[image.mimeType];
  const uploaded = await uploadGoogleDriveFileDirect({
    parentId: imageFolderId,
    name: `cover_${Date.now()}.${extension}`,
    mimeType: image.mimeType,
    bytes: image.bytes
  }, options);
  return {
    file_id: uploaded.id,
    url: `https://lh3.googleusercontent.com/d/${uploaded.id}`
  };
}

async function createGoogleDocumentInFolderDirect(title, parentFolderId, options = {}) {
  const created = await googleJsonRequest('https://docs.googleapis.com/v1/documents', {
    ...options,
    method: 'POST',
    body: { title }
  });
  if (!created.documentId) throw new Error(`Google Docs не создал документ «${title}»`);
  const moveUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(created.documentId)}`);
  moveUrl.searchParams.set('addParents', parentFolderId);
  moveUrl.searchParams.set('removeParents', 'root');
  moveUrl.searchParams.set('fields', 'id,name,parents');
  moveUrl.searchParams.set('supportsAllDrives', 'true');
  await googleJsonRequest(moveUrl, { ...options, method: 'PATCH', body: {} });
  return created.documentId;
}

function buildNovelDescriptionDocument(novel, author, contentsDocumentId) {
  const coverUrl = Array.isArray(novel.cover_urls) ? novel.cover_urls[0] : '';
  const title = String(novel.title || 'Без названия');
  const description = String(novel.description || 'Описание пока не добавлено.');
  const lines = [
    title,
    '',
    ...(coverUrl ? ['🖼️ Обложка', ''] : []),
    'Описание',
    description,
    '',
    '📗 Содержание 📗',
    '',
    `Автор: ${author || 'Не указан'}`,
    `Язык: ${novel.language || 'Не указан'}`,
    `Год: ${novel.year || 'Не указан'}`,
    `Статус оригинала: ${novel.original_status || 'Не указан'}`,
    `Статус перевода: ${novel.translation_status || 'Не указан'}`,
    `Эра: ${novel.era || 'Не указана'}`,
    `Тип отношений: ${novel.orientation || 'Не указан'}`,
    `Перспектива: ${novel.perspective || 'Не указана'}`,
    `Слов в оригинале: ${Number(novel.original_word_count || 0).toLocaleString('ru-RU')}`,
    `Глав в оригинале: ${Number(novel.original_chapter_count || 0).toLocaleString('ru-RU')}`,
    ...(novel.alt_titles ? [`Альтернативные названия: ${String(novel.alt_titles).split('|').join(', ')}`] : [])
  ];
  const text = `${lines.join('\n')}\n`;
  const titleEnd = title.length + 1;
  const descriptionHeadingStart = text.indexOf('Описание\n');
  const contentsStart = text.indexOf('📗 Содержание 📗');
  const coverStart = coverUrl ? text.indexOf('🖼️ Обложка') : -1;
  return {
    text,
    styles: [
      { kind: 'named', startIndex: 1, endIndex: 1 + titleEnd, value: 'TITLE' },
      { kind: 'named', startIndex: 1 + descriptionHeadingStart, endIndex: 1 + descriptionHeadingStart + 'Описание\n'.length, value: 'HEADING_1' },
      { kind: 'link', startIndex: 1 + contentsStart, endIndex: 1 + contentsStart + '📗 Содержание 📗'.length, url: `https://docs.google.com/document/d/${contentsDocumentId}/edit` },
      ...(coverStart >= 0 ? [{ kind: 'link', startIndex: 1 + coverStart, endIndex: 1 + coverStart + '🖼️ Обложка'.length, url: coverUrl }] : [])
    ]
  };
}

async function replaceGoogleDocumentDirect(documentId, content, options = {}) {
  const document = await googleJsonRequest(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
    options
  );
  const lastEnd = Number(document.body?.content?.at(-1)?.endIndex || 1);
  const requests = [];
  if (lastEnd > 1) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: lastEnd - 1 } } });
  }
  requests.push({ insertText: { location: { index: 1 }, text: content.text } });
  for (const style of content.styles || []) {
    if (style.kind === 'named') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: style.startIndex, endIndex: style.endIndex },
          paragraphStyle: { namedStyleType: style.value },
          fields: 'namedStyleType'
        }
      });
    } else if (style.kind === 'link') {
      requests.push({
        updateTextStyle: {
          range: { startIndex: style.startIndex, endIndex: style.endIndex },
          textStyle: { link: { url: style.url } },
          fields: 'link'
        }
      });
    }
  }
  const body = { requests };
  if (document.revisionId) body.writeControl = { requiredRevisionId: document.revisionId };
  await googleJsonRequest(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    { ...options, method: 'POST', body }
  );
}

async function writeNovelDocumentsDirect(folderId, novel, author, options = {}) {
  const files = await listGoogleDriveFolderFiles(folderId, options);
  let contentsId = files.find(file => (
    file.name === 'Содержание' && file.mimeType === 'application/vnd.google-apps.document'
  ))?.id;
  let descriptionId = files.find(file => (
    file.name === 'Описание' && file.mimeType === 'application/vnd.google-apps.document'
  ))?.id;
  if (!contentsId) contentsId = await createGoogleDocumentInFolderDirect('Содержание', folderId, options);
  if (!descriptionId) descriptionId = await createGoogleDocumentInFolderDirect('Описание', folderId, options);

  const title = String(novel.title || 'Без названия');
  const contentsText = `${title}\nОглавление будет заполнено автоматически при добавлении глав.\n`;
  await Promise.all([
    replaceGoogleDocumentDirect(contentsId, {
      text: contentsText,
      styles: [
        { kind: 'named', startIndex: 1, endIndex: 1 + title.length + 1, value: 'TITLE' },
        { kind: 'link', startIndex: 1, endIndex: 1 + title.length, url: `https://docs.google.com/document/d/${descriptionId}/edit` }
      ]
    }, options),
    replaceGoogleDocumentDirect(
      descriptionId,
      buildNovelDescriptionDocument(novel, author, contentsId),
      options
    )
  ]);
  return { contentsId, descriptionId };
}

async function createNovelDriveResourcesDirect(novelId, data, user, storageType, options = {}) {
  if (options.createNovelDriveResources) {
    return options.createNovelDriveResources(novelId, data, user, storageType, options);
  }
  const rootId = (options.googleConfig || getGoogleConfig()).rootFolderId;
  let target = await getOrCreateGoogleDriveFolder(
    rootId,
    storageType === 'owner' ? 'Owner Novels' : storageType === 'personal' ? 'Personal Novels' : 'Community Novels',
    options
  );
  if (storageType === 'personal') {
    target = await getOrCreateGoogleDriveFolder(
      target.id,
      `user_${user.user_id}_${String(user.username || 'user')}`.slice(0, 100),
      options
    );
  }
  const folder = await createGoogleDriveFolderDirect(target.id, `${novelId} - ${String(data.title).trim()}`, options);
  try {
    const imageFolder = await getOrCreateGoogleDriveFolder(folder.id, 'Картинки', options);
    const cover = await processNovelCoverDirect(data, imageFolder.id, options);
    const novelForDocument = {
      ...data,
      cover_urls: cover.url ? [cover.url] : [],
      original_status: data.original_status || 'Продолжается',
      translation_status: data.translation_status || 'Продолжается'
    };
    const documents = await writeNovelDocumentsDirect(
      folder.id,
      novelForDocument,
      String(data.author || '').trim(),
      options
    );
    return { folderId: folder.id, cover, ...documents };
  } catch (error) {
    await googleJsonRequest(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder.id)}?supportsAllDrives=true`,
      { ...options, method: 'PATCH', body: { trashed: true } }
    ).catch(() => {});
    throw error;
  }
}

async function getNovelCreationLimitDirect(user, storageType, options = {}) {
  if (user.role === 'owner' || String(user.user_id) === '0') return Infinity;
  const db = options.dbRequest || supabaseRestRequest;
  const rows = await db('users', {
    user_id: `eq.${user.user_id}`,
    select: 'custom_limit_personal,custom_limit_community',
    limit: 1
  }, options);
  const field = storageType === 'personal' ? 'custom_limit_personal' : 'custom_limit_community';
  const fallback = storageType === 'personal' ? 10 : 50;
  const value = rows[0]?.[field];
  return value === null || value === undefined ? fallback : Number(value);
}

export async function createNovelDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const title = String(data.title || '').trim();
  const author = String(data.author || '').trim();
  if (!title) return { success: false, error: 'Укажите название новеллы' };

  const storageType = user.role === 'owner' || String(user.user_id) === '0'
    ? 'owner'
    : isTruthyFormValue(data.is_personal) ? 'personal' : 'community';
  const limit = await getNovelCreationLimitDirect(user, storageType, options);
  const currentRows = await db('novels', {
    creator_id: `eq.${user.user_id}`,
    storage_type: `eq.${storageType}`,
    is_deleted: 'eq.false',
    select: 'novel_id'
  }, options);
  if (currentRows.length >= limit) {
    return { success: false, error: `Достигнут лимит новелл (${limit})` };
  }

  const authorId = author ? await findOrCreateAuthorDirect(author, options) : null;
  if (authorId) {
    const duplicates = await db('novel_authors', {
      author_id: `eq.${authorId}`,
      select: 'novel_id,novels!inner(title,is_deleted)',
      'novels.title': `eq.${title}`,
      'novels.is_deleted': 'eq.false',
      limit: 1
    }, options);
    if (duplicates.length) {
      return { success: false, error: 'Новелла с таким названием и автором уже существует' };
    }
  }

  const slug = await ensureUniqueNovelSlugDirect(title, options);
  const now = new Date().toISOString();
  let novelId = null;
  let driveResources = null;
  try {
    const inserted = await db('novels', {}, {
      ...options,
      method: 'POST',
      body: {
        title,
        description: String(data.description || ''),
        language: String(data.language || ''),
        original_status: 'processing',
        translation_status: 'processing',
        original_chapter_count: Number(data.original_chapter_count || 0),
        cover_urls: [],
        cover_file_ids: [],
        owner_id: user.user_id,
        creator_id: user.user_id,
        storage_type: storageType,
        created_at: now,
        updated_at: now,
        is_deleted: false,
        slug,
        access_type: storageType === 'personal' ? 'private' : String(data.access_type || 'public')
      }
    });
    novelId = inserted[0]?.novel_id;
    if (!novelId) throw new Error('Supabase не вернул ID созданной новеллы');

    driveResources = await createNovelDriveResourcesDirect(novelId, { ...data, title }, user, storageType, options);
    const finalPatch = {
      original_status: String(data.original_status || 'Продолжается'),
      translation_status: String(data.translation_status || 'Продолжается'),
      folder_id: driveResources.folderId,
      cover_urls: driveResources.cover?.url ? [driveResources.cover.url] : [],
      cover_file_ids: driveResources.cover?.file_id ? [driveResources.cover.file_id] : [],
      alt_titles: String(data.alt_titles || ''),
      year: data.year || '',
      era: String(data.era || ''),
      perspective: String(data.perspective || ''),
      orientation: String(data.orientation || ''),
      original_word_count: Number(data.original_word_count || 0),
      additional_links: String(data.additional_links || ''),
      updated_at: new Date().toISOString()
    };
    await db('novels', { novel_id: `eq.${novelId}` }, {
      ...options,
      method: 'PATCH',
      body: finalPatch
    });
    await syncNovelAuthorDirect(novelId, author, options, authorId);
    await syncNovelTagsDirect(novelId, data.tags, options);
    return {
      success: true,
      novel_id: novelId,
      slug,
      status: finalPatch.translation_status,
      message: 'Новелла успешно создана'
    };
  } catch (error) {
    if (driveResources?.folderId) {
      await googleJsonRequest(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveResources.folderId)}?supportsAllDrives=true`,
        { ...options, method: 'PATCH', body: { trashed: true } }
      ).catch(() => {});
    }
    if (novelId) {
      await db('novels', { novel_id: `eq.${novelId}` }, { ...options, method: 'DELETE' })
        .catch(async () => {
          await db('novels', { novel_id: `eq.${novelId}` }, {
            ...options,
            method: 'PATCH',
            body: { original_status: 'error', updated_at: new Date().toISOString() }
          }).catch(() => {});
        });
    }
    return { success: false, error: error.message };
  }
}

async function getNovelIncludingDeletedDirect(novelId, options = {}) {
  const db = options.dbRequest || supabaseRestRequest;
  const rows = await db('novels', {
    novel_id: `eq.${Number(novelId)}`,
    select: '*,novel_authors(authors(name))',
    limit: 1
  }, options);
  return rows[0] || null;
}

function canManageNovelDirect(novel, user) {
  return Boolean(novel && user && (
    String(user.user_id) === '0' ||
    String(novel.creator_id) === String(user.user_id) ||
    user.role === 'admin' ||
    user.role === 'owner'
  ));
}

export async function updateNovelDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const novelId = Number(data.novel_id ?? data.novelId);
  if (!Number.isFinite(novelId)) return { success: false, error: 'Не передан ID новеллы' };
  const current = await getNovelIncludingDeletedDirect(novelId, options);
  if (!current || current.is_deleted) return { success: false, error: 'Новелла не найдена' };
  const editable = canManageNovelDirect(current, user) || await canEditNovelDirect(current, user, options);
  if (!editable) return { success: false, error: 'У вас нет прав на редактирование этой новеллы' };

  const title = String(data.title || current.title || '').trim();
  if (!title) return { success: false, error: 'Укажите название новеллы' };
  const currentCoverUrl = Array.isArray(current.cover_urls) ? current.cover_urls[0] || '' : '';
  const hasNewCover = Boolean(data.cover_base64) || (
    String(data.cover_url || '').trim() && String(data.cover_url).trim() !== currentCoverUrl
  );
  let newCover = null;
  let imageFolder = null;
  try {
    if (hasNewCover) {
      if (!current.folder_id) throw new Error('У новеллы отсутствует папка Google Drive');
      imageFolder = await getOrCreateGoogleDriveFolder(current.folder_id, 'Картинки', options);
      newCover = await processNovelCoverDirect(data, imageFolder.id, options);
    }
    const patch = {
      title,
      alt_titles: String(data.alt_titles || ''),
      description: String(data.description || ''),
      language: String(data.language || ''),
      year: data.year || '',
      original_status: String(data.original_status || 'Продолжается'),
      translation_status: String(data.translation_status || 'Продолжается'),
      era: String(data.era || ''),
      perspective: String(data.perspective || ''),
      orientation: String(data.orientation || ''),
      original_word_count: Number(data.original_word_count || 0),
      original_chapter_count: Number(data.original_chapter_count || 0),
      access_type: String(data.access_type || 'public'),
      additional_links: String(data.additional_links || ''),
      cover_urls: newCover ? (newCover.url ? [newCover.url] : []) : (current.cover_urls || []),
      cover_file_ids: newCover ? (newCover.file_id ? [newCover.file_id] : []) : (current.cover_file_ids || []),
      updated_at: new Date().toISOString()
    };
    await db('novels', { novel_id: `eq.${novelId}` }, { ...options, method: 'PATCH', body: patch });
    if (data.author !== undefined) await syncNovelAuthorDirect(novelId, data.author, options);
    if (Array.isArray(data.tags)) await syncNovelTagsDirect(novelId, data.tags, options);

    const driveWarnings = [];
    if (current.folder_id) {
      if (title !== current.title) {
        await googleJsonRequest(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(current.folder_id)}?supportsAllDrives=true`,
          { ...options, method: 'PATCH', body: { name: `${novelId} - ${title}` } }
        ).catch(error => driveWarnings.push(error.message));
      }
      const author = data.author !== undefined
        ? String(data.author || '').trim()
        : current.novel_authors?.[0]?.authors?.name || '';
      await writeNovelDocumentsDirect(current.folder_id, { ...current, ...patch }, author, options)
        .catch(error => driveWarnings.push(error.message));
    }
    if (newCover) {
      for (const oldId of current.cover_file_ids || []) {
        if (!oldId || oldId === newCover.file_id) continue;
        await googleJsonRequest(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(oldId)}?supportsAllDrives=true`,
          { ...options, method: 'PATCH', body: { trashed: true } }
        ).catch(error => driveWarnings.push(error.message));
      }
    }
    return {
      success: true,
      message: 'Новелла успешно обновлена',
      drive_warning: driveWarnings.length ? driveWarnings.join('; ') : undefined
    };
  } catch (error) {
    if (newCover?.file_id) {
      await googleJsonRequest(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(newCover.file_id)}?supportsAllDrives=true`,
        { ...options, method: 'PATCH', body: { trashed: true } }
      ).catch(() => {});
    }
    return { success: false, error: error.message };
  }
}

export async function deleteNovelDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const novelId = Number(data.novel_id ?? data.novelId);
  if (!Number.isFinite(novelId)) return { success: false, error: 'Не передан ID новеллы' };
  const novel = await getNovelIncludingDeletedDirect(novelId, options);
  if (!novel) return { success: false, error: 'Новелла не найдена' };
  if (!canManageNovelDirect(novel, user)) return { success: false, error: 'У вас нет прав на удаление этой новеллы' };

  if (!isTruthyFormValue(data.permanent)) {
    const now = new Date().toISOString();
    await db('novels', { novel_id: `eq.${novelId}` }, {
      ...options,
      method: 'PATCH',
      body: { is_deleted: true, deleted_at: now, updated_at: now }
    });
    return { success: true };
  }

  if (
    !['admin', 'owner'].includes(user.role) &&
    String(user.user_id) !== '0' &&
    !novel.is_deleted
  ) {
    return { success: false, error: 'Сначала переместите новеллу в корзину' };
  }

  const trashedIds = [];
  const idsToTrash = novel.folder_id ? [novel.folder_id] : (novel.cover_file_ids || []);
  try {
    for (const fileId of idsToTrash.filter(Boolean)) {
      await googleJsonRequest(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
        { ...options, method: 'PATCH', body: { trashed: true } }
      );
      trashedIds.push(fileId);
    }
    await db('novels', { novel_id: `eq.${novelId}` }, { ...options, method: 'DELETE' });
    return { success: true, drive_trashed: trashedIds.length };
  } catch (error) {
    for (const fileId of trashedIds) {
      await googleJsonRequest(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
        { ...options, method: 'PATCH', body: { trashed: false } }
      ).catch(() => {});
    }
    return { success: false, error: error.message };
  }
}

export async function restoreNovelDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const novelId = Number(data.novel_id ?? data.novelId);
  if (!Number.isFinite(novelId)) return { success: false, error: 'Не передан ID новеллы' };
  const novel = await getNovelIncludingDeletedDirect(novelId, options);
  if (!novel) return { success: false, error: 'Новелла не найдена' };
  if (!canManageNovelDirect(novel, user)) return { success: false, error: 'У вас нет прав на восстановление этой новеллы' };
  await db('novels', { novel_id: `eq.${novelId}` }, {
    ...options,
    method: 'PATCH',
    body: { is_deleted: false, deleted_at: null, updated_at: new Date().toISOString() }
  });
  return { success: true, message: 'Новелла восстановлена' };
}

async function setGoogleDriveTrashedDirect(fileId, trashed, options = {}) {
  if (options.setDriveTrashed) return options.setDriveTrashed(fileId, trashed, options);
  return googleJsonRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed&supportsAllDrives=true`,
    { ...options, method: 'PATCH', body: { trashed } }
  );
}

export async function restoreFromTrashDirect(data, user, options = {}) {
  if (!user || !['admin', 'owner'].includes(user.role)) {
    return { success: false, error: 'Нет прав на восстановление из корзины' };
  }
  const itemType = String(data.itemType || data.item_type || '');
  const itemId = Number(data.itemId ?? data.item_id);
  if (!Number.isFinite(itemId) || !['novel', 'chapter'].includes(itemType)) {
    return { success: false, error: 'Некорректный элемент корзины' };
  }
  if (itemType === 'novel') {
    return restoreNovelDirect({ novelId: itemId }, user, options);
  }

  const db = options.dbRequest || supabaseRestRequest;
  const rows = await db('chapters', {
    chapter_id: `eq.${itemId}`,
    select: '*',
    limit: 1
  }, options);
  const chapter = rows[0];
  if (!chapter || !chapter.is_deleted) return { success: false, error: 'Глава не найдена в корзине' };

  let driveRestored = false;
  try {
    if (chapter.file_id) {
      await setGoogleDriveTrashedDirect(chapter.file_id, false, options);
      driveRestored = true;
    }
    const updated = await db('chapters', { chapter_id: `eq.${itemId}` }, {
      ...options,
      method: 'PATCH',
      body: { is_deleted: false, deleted_at: null, updated_at: new Date().toISOString() }
    });
    const restoredChapter = updated[0] || { ...chapter, is_deleted: false };
    const warnings = [];
    const updateStats = options.updateNovelStats || updateNovelStatsDirect;
    const updateVolumes = options.updateNovelVolumeStructure || updateNovelVolumeStructureDirect;
    const syncContents = options.syncContents || updateContentsDocumentDirect;
    await Promise.all([
      updateStats(restoredChapter.novel_id, options),
      updateVolumes(restoredChapter.novel_id, options),
      syncContents(restoredChapter.novel_id, options)
    ]).catch(error => warnings.push(error.message));
    const active = sortChapterRows(await db('chapters', {
      novel_id: `eq.${Number(restoredChapter.novel_id)}`,
      is_deleted: 'eq.false',
      select: 'chapter_id',
      order: 'volume_order.asc,chapter_number.asc'
    }, options));
    const index = active.findIndex(row => Number(row.chapter_id) === itemId);
    const navigationIds = [
      active[index - 1]?.chapter_id,
      itemId,
      active[index + 1]?.chapter_id
    ].filter(Boolean);
    const syncNavigation = options.syncNavigation || syncChapterNavigationDirect;
    await syncNavigation(restoredChapter.novel_id, navigationIds, options)
      .then(result => {
        if (!result.success) warnings.push(...result.errors);
      })
      .catch(error => warnings.push(error.message));
    return {
      success: true,
      message: 'Глава восстановлена',
      warning: warnings.length ? warnings.join('; ') : undefined
    };
  } catch (error) {
    if (driveRestored && chapter.file_id) {
      await setGoogleDriveTrashedDirect(chapter.file_id, true, options).catch(() => {});
    }
    return { success: false, error: error.message };
  }
}

export async function permanentDeleteNovelDirect(data, user, options = {}) {
  return deleteNovelDirect({
    novelId: data.novelId ?? data.novel_id,
    permanent: true
  }, user, options);
}

export async function permanentDeleteChapterDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const chapterId = Number(data.chapterId ?? data.chapter_id);
  if (!Number.isFinite(chapterId)) return { success: false, error: 'Не передан ID главы' };
  const rows = await db('chapters', {
    chapter_id: `eq.${chapterId}`,
    select: '*',
    limit: 1
  }, options);
  const chapter = rows[0];
  if (!chapter) return { success: false, error: 'Глава не найдена' };
  const novel = await getNovelIncludingDeletedDirect(chapter.novel_id, options);
  const isAdministrator = ['admin', 'owner'].includes(user.role) || String(user.user_id) === '0';
  const isCreator = novel && String(novel.creator_id) === String(user.user_id);
  if (!isAdministrator && (!isCreator || !chapter.is_deleted)) {
    return { success: false, error: 'У вас нет прав на полное удаление этой главы' };
  }
  if (!isAdministrator && !chapter.is_deleted) {
    return { success: false, error: 'Сначала переместите главу в корзину' };
  }

  try {
    if (chapter.file_id) await setGoogleDriveTrashedDirect(chapter.file_id, true, options);
    await db('chapters', { chapter_id: `eq.${chapterId}` }, { ...options, method: 'DELETE' });
    const warnings = [];
    if (chapter.novel_id) {
      const updateStats = options.updateNovelStats || updateNovelStatsDirect;
      const updateVolumes = options.updateNovelVolumeStructure || updateNovelVolumeStructureDirect;
      const syncContents = options.syncContents || updateContentsDocumentDirect;
      await Promise.all([
        updateStats(chapter.novel_id, options),
        updateVolumes(chapter.novel_id, options),
        syncContents(chapter.novel_id, options)
      ]).catch(error => warnings.push(error.message));
    }
    return {
      success: true,
      message: `Глава ${chapterId} полностью удалена`,
      warning: warnings.length ? warnings.join('; ') : undefined
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function emptyTrashDirect(_data, user, options = {}) {
  if (!user || !['admin', 'owner'].includes(user.role)) {
    return { success: false, error: 'Нет прав на очистку корзины' };
  }
  const db = options.dbRequest || supabaseRestRequest;
  const [chapters, novels] = await Promise.all([
    db('chapters', { is_deleted: 'eq.true', select: 'chapter_id' }, options),
    db('novels', { is_deleted: 'eq.true', select: 'novel_id' }, options)
  ]);
  let deletedCount = 0;
  const errors = [];
  for (const chapter of chapters) {
    const result = await permanentDeleteChapterDirect({ chapterId: chapter.chapter_id }, user, options);
    if (result.success) deletedCount += 1;
    else errors.push(`Глава ${chapter.chapter_id}: ${result.error}`);
  }
  for (const novel of novels) {
    const result = await permanentDeleteNovelDirect({ novelId: novel.novel_id }, user, options);
    if (result.success) deletedCount += 1;
    else errors.push(`Новелла ${novel.novel_id}: ${result.error}`);
  }
  if (errors.length) {
    return {
      success: false,
      error: `Удалено: ${deletedCount}. Не удалось удалить: ${errors.length}. ${errors.join('; ')}`,
      deleted_count: deletedCount,
      errors
    };
  }
  return {
    success: true,
    message: `Корзина очищена. Удалено навсегда: ${deletedCount}`,
    deleted_count: deletedCount
  };
}

export async function grantPermissionDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const novelId = Number(data.novelId ?? data.novel_id);
  const targetUserId = Number(data.targetUserId ?? data.target_user_id);
  const permission = String(data.permission || '');
  if (!Number.isFinite(novelId) || !Number.isFinite(targetUserId)) {
    return { success: false, error: 'Некорректные данные доступа' };
  }
  if (!['read', 'edit', 'translate'].includes(permission)) {
    return { success: false, error: 'Право должно быть read, edit или translate' };
  }
  const novel = await getNovelIncludingDeletedDirect(novelId, options);
  if (!novel || novel.is_deleted) return { success: false, error: 'Новелла не найдена' };
  if (!canManageNovelDirect(novel, user)) {
    return { success: false, error: 'Нет прав на управление доступом' };
  }
  if (String(novel.creator_id) === String(targetUserId)) {
    return { success: false, error: 'Создатель уже имеет полный доступ к новелле' };
  }
  const target = await db('users', {
    user_id: `eq.${targetUserId}`,
    select: 'user_id',
    limit: 1
  }, options);
  if (!target.length) return { success: false, error: 'Пользователь не найден' };
  const payload = {
    novel_id: novelId,
    user_id: targetUserId,
    permission,
    granted_at: new Date().toISOString()
  };
  const updated = await db('novel_permissions', {
    novel_id: `eq.${novelId}`,
    user_id: `eq.${targetUserId}`
  }, { ...options, method: 'PATCH', body: payload });
  if (!updated.length) {
    await db('novel_permissions', {}, { ...options, method: 'POST', body: payload });
  }
  return { success: true, message: `Права «${permission}» выданы` };
}

export async function revokePermissionDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const novelId = Number(data.novelId ?? data.novel_id);
  const targetUserId = Number(data.targetUserId ?? data.target_user_id);
  if (!Number.isFinite(novelId) || !Number.isFinite(targetUserId)) {
    return { success: false, error: 'Некорректные данные доступа' };
  }
  const novel = await getNovelIncludingDeletedDirect(novelId, options);
  if (!novel || !canManageNovelDirect(novel, user)) {
    return { success: false, error: 'Нет прав на управление доступом' };
  }
  await db('novel_permissions', {
    novel_id: `eq.${novelId}`,
    user_id: `eq.${targetUserId}`
  }, { ...options, method: 'DELETE' });
  return { success: true, message: 'Права отозваны' };
}

export async function createAuthorSubmissionDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const name = String(data.name || '').trim();
  const bio = String(data.bio || '').trim();
  const rawAliases = Array.isArray(data.aliases)
    ? data.aliases
    : String(data.aliases || '').split(/\r?\n|,|;/);
  const aliases = [...new Map(rawAliases
    .map(alias => String(alias || '').trim())
    .filter(Boolean)
    .map(alias => [alias.toLocaleLowerCase(), alias])).values()];
  if (!name) return { success: false, error: 'Укажите основное имя автора' };
  if (name.length > 200) return { success: false, error: 'Имя автора слишком длинное' };
  if (aliases.length > 30) return { success: false, error: 'Можно указать не более 30 альтернативных имён' };
  if (bio.length > 3000) return { success: false, error: 'Краткая информация слишком длинная' };

  const existingAuthors = await db('authors', {
    name: `ilike.${name}`,
    select: 'author_id,name',
    limit: 1
  }, options);
  if (existingAuthors.length) {
    return { success: false, error: `Автор «${existingAuthors[0].name}» уже существует` };
  }
  const existingSubmissions = await db('submissions', {
    submission_type: 'eq.author',
    status: 'eq.pending',
    created_by: `eq.${user.user_id}`,
    title: `ilike.${name}`,
    select: 'submission_id',
    limit: 1
  }, options);
  if (existingSubmissions.length) {
    return { success: false, error: 'Вы уже отправляли заявку на этого автора' };
  }
  const created = await db('submissions', {}, {
    ...options,
    method: 'POST',
    body: {
      submission_type: 'author',
      title: name,
      body: bio,
      payload: { aliases },
      status: 'pending',
      created_by: user.user_id
    }
  });
  if (!created[0]?.submission_id) throw new Error('База не вернула созданную заявку');
  return {
    success: true,
    submission_id: created[0].submission_id,
    message: 'Заявка отправлена на модерацию'
  };
}

function extractGoogleDriveFileId(url) {
  const value = String(url || '');
  const driveMatch = /googleusercontent\.com\/d\/([^/?#]+)/i.exec(value);
  if (driveMatch) return driveMatch[1];
  const legacyMatch = /picture\/0([^/?#]+)/i.exec(value);
  return legacyMatch ? legacyMatch[1] : '';
}

export async function uploadAvatarDirect(data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const image = parseNovelCoverDataUrl(data.avatar_base64);
  const currentRows = await db('users', {
    user_id: `eq.${user.user_id}`,
    select: 'avatar_url',
    limit: 1
  }, options);
  if (!currentRows.length) return { success: false, error: 'Пользователь не найден' };
  const usersFolderId = String(
    options.usersFolderId || process.env.GOOGLE_DRIVE_USERS_FOLDER_ID || GOOGLE_DRIVE_USERS_FOLDER_ID
  );
  const avatarsFolder = await getOrCreateGoogleDriveFolder(usersFolderId, 'Avatars', options);
  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  }[image.mimeType];
  const uploaded = await uploadGoogleDriveFileDirect({
    parentId: avatarsFolder.id,
    name: `avatar_${user.user_id}_${Date.now()}.${extension}`,
    mimeType: image.mimeType,
    bytes: image.bytes
  }, options);
  const avatarUrl = `https://lh3.googleusercontent.com/d/${uploaded.id}`;
  try {
    const updated = await db('users', { user_id: `eq.${user.user_id}` }, {
      ...options,
      method: 'PATCH',
      body: { avatar_url: avatarUrl }
    });
    if (!updated.length) throw new Error('Не удалось обновить профиль');
  } catch (error) {
    await setGoogleDriveTrashedDirect(uploaded.id, true, options).catch(() => {});
    return { success: false, error: error.message };
  }
  const oldFileId = extractGoogleDriveFileId(currentRows[0].avatar_url);
  if (oldFileId && oldFileId !== uploaded.id) {
    await setGoogleDriveTrashedDirect(oldFileId, true, options).catch(() => {});
  }
  return { success: true, avatar_url: avatarUrl };
}

export async function deleteAvatarDirect(_data, user, options = {}) {
  const authError = requireSignedInUser(user);
  if (authError) return authError;
  const db = options.dbRequest || supabaseRestRequest;
  const currentRows = await db('users', {
    user_id: `eq.${user.user_id}`,
    select: 'avatar_url',
    limit: 1
  }, options);
  if (!currentRows.length) return { success: false, error: 'Пользователь не найден' };
  const oldFileId = extractGoogleDriveFileId(currentRows[0].avatar_url);
  let fileTrashed = false;
  try {
    if (oldFileId) {
      await setGoogleDriveTrashedDirect(oldFileId, true, options);
      fileTrashed = true;
    }
    const updated = await db('users', { user_id: `eq.${user.user_id}` }, {
      ...options,
      method: 'PATCH',
      body: { avatar_url: null }
    });
    if (!updated.length) throw new Error('Не удалось обновить профиль');
    return { success: true };
  } catch (error) {
    if (fileTrashed && oldFileId) {
      await setGoogleDriveTrashedDirect(oldFileId, false, options).catch(() => {});
    }
    return { success: false, error: error.message };
  }
}

async function setSettingDirect(key, value, options = {}) {
  const db = options.dbRequest || supabaseRestRequest;
  const updated = await db('settings', { key: `eq.${key}` }, {
    ...options,
    method: 'PATCH',
    body: { value }
  });
  if (!updated.length) {
    await db('settings', {}, { ...options, method: 'POST', body: { key, value } });
  }
}

export async function updateUserRoleDirect(data, user, options = {}) {
  const accessError = requireAdministrator(user, true);
  if (accessError) return accessError;
  const db = options.dbRequest || supabaseRestRequest;
  const userId = Number(data.user_id ?? data.userId);
  const newRole = String(data.new_role ?? data.newRole ?? '');
  if (!Number.isFinite(userId)) return { success: false, error: 'Пользователь не найден' };
  if (String(userId) === '0') return { success: false, error: 'Нельзя изменить роль владельца' };
  if (!['reader', 'creator', 'admin'].includes(newRole)) {
    return { success: false, error: 'Несуществующая роль' };
  }
  const updated = await db('users', { user_id: `eq.${userId}` }, {
    ...options,
    method: 'PATCH',
    body: { role: newRole }
  });
  if (!updated.length) return { success: false, error: 'Пользователь не найден' };
  return { success: true, message: `Роль пользователя обновлена на ${newRole}` };
}

export async function setRoleThemeDirect(data, user, options = {}) {
  const accessError = requireAdministrator(user);
  if (accessError) return accessError;
  const theme = String(data.theme || '').trim();
  if (!theme || theme.length > 50) return { success: false, error: 'Некорректная тема ролей' };
  await setSettingDirect('roleTheme', theme, options);
  return { success: true, message: `Тема изменена на ${theme}` };
}

export async function setGlobalLimitsDirect(data, user, options = {}) {
  const accessError = requireAdministrator(user, true);
  if (accessError) return accessError;
  const personal = Number.parseInt(data.personalLimit, 10);
  const community = Number.parseInt(data.communityLimit, 10);
  if (!Number.isInteger(personal) || personal < 0 || !Number.isInteger(community) || community < 0) {
    return { success: false, error: 'Лимиты должны быть неотрицательными целыми числами' };
  }
  await Promise.all([
    setSettingDirect('global_limit_personal', personal, options),
    setSettingDirect('global_limit_community', community, options)
  ]);
  return { success: true, message: 'Глобальные лимиты сохранены' };
}

export async function addTagDirect(data, user, options = {}) {
  const accessError = requireAdministrator(user);
  if (accessError) return accessError;
  const db = options.dbRequest || supabaseRestRequest;
  const name = String(data.name || '').trim();
  const description = String(data.description || '').trim();
  if (!name) return { success: false, error: 'Введите название тега' };
  const existing = await db('tags', { name: `ilike.${name}`, select: 'tag_id,is_active', limit: 1 }, options);
  if (existing.length) return { success: false, error: `Тег «${name}» уже существует` };
  const created = await db('tags', {}, {
    ...options,
    method: 'POST',
    body: { name, description, is_active: true }
  });
  if (!created[0]?.tag_id) return { success: false, error: 'Не удалось создать тег' };
  return { success: true, tag_id: created[0].tag_id };
}

export async function updateTagDirect(data, user, options = {}) {
  const accessError = requireAdministrator(user);
  if (accessError) return accessError;
  const db = options.dbRequest || supabaseRestRequest;
  const tagId = Number(data.id ?? data.tag_id);
  const name = String(data.name || '').trim();
  const description = String(data.description || '').trim();
  if (!Number.isFinite(tagId) || !name) return { success: false, error: 'Некорректные данные тега' };
  const duplicates = await db('tags', {
    name: `ilike.${name}`,
    tag_id: `neq.${tagId}`,
    select: 'tag_id',
    limit: 1
  }, options);
  if (duplicates.length) return { success: false, error: `Тег «${name}» уже существует` };
  const updated = await db('tags', { tag_id: `eq.${tagId}` }, {
    ...options,
    method: 'PATCH',
    body: { name, description }
  });
  return updated.length ? { success: true } : { success: false, error: 'Тег не найден' };
}

export async function deleteTagDirect(data, user, options = {}) {
  const accessError = requireAdministrator(user);
  if (accessError) return accessError;
  const db = options.dbRequest || supabaseRestRequest;
  const tagId = Number(data.id ?? data.tag_id);
  if (!Number.isFinite(tagId)) return { success: false, error: 'Тег не найден' };
  const updated = await db('tags', { tag_id: `eq.${tagId}` }, {
    ...options,
    method: 'PATCH',
    body: { is_active: false }
  });
  return updated.length
    ? { success: true, message: 'Тег деактивирован' }
    : { success: false, error: 'Тег не найден' };
}

export async function handleDirectMutation(action, data = {}, options = {}) {
  if (action === 'loginWithEmail') return loginWithEmailDirect(data, options);
  if (action === 'registerWithEmail') return registerWithEmailDirect(data, options);
  if (action === 'logout') return logoutDirect(data, options);

  const user = await resolveSessionUser(data, options);
  if (action === 'createNovel') return createNovelDirect(data, user, options);
  if (action === 'updateNovel') return updateNovelDirect(data, user, options);
  if (action === 'deleteNovel') return deleteNovelDirect(data, user, options);
  if (action === 'restoreNovel') return restoreNovelDirect(data, user, options);
  if (action === 'restoreFromTrash') return restoreFromTrashDirect(data, user, options);
  if (action === 'permanentDeleteNovel') return permanentDeleteNovelDirect(data, user, options);
  if (action === 'permanentDeleteChapter') return permanentDeleteChapterDirect(data, user, options);
  if (action === 'emptyTrash') return emptyTrashDirect(data, user, options);
  if (action === 'grantPermission') return grantPermissionDirect(data, user, options);
  if (action === 'revokePermission') return revokePermissionDirect(data, user, options);
  if (action === 'createAuthorSubmission') return createAuthorSubmissionDirect(data, user, options);
  if (action === 'uploadAvatar') return uploadAvatarDirect(data, user, options);
  if (action === 'deleteAvatar') return deleteAvatarDirect(data, user, options);
  if (action === 'updateUserRole') return updateUserRoleDirect(data, user, options);
  if (action === 'setRoleTheme') return setRoleThemeDirect(data, user, options);
  if (action === 'setGlobalLimits') return setGlobalLimitsDirect(data, user, options);
  if (action === 'addTag') return addTagDirect(data, user, options);
  if (action === 'updateTag') return updateTagDirect(data, user, options);
  if (action === 'deleteTag') return deleteTagDirect(data, user, options);
  if (action === 'addChapter') return addChapterDirect(data, user, options);
  if (action === 'updateChapter') return updateChapterDirect(data, user, options);
  if (action === 'deleteChapter') return deleteChapterDirect(data, user, options);
  if (action === 'addToReadingList') return addToReadingListDirect(data, user, options);
  if (action === 'removeFromReadingList') return removeFromReadingListDirect(data, user, options);
  if (action === 'updateReadingProgress' || action === 'markChapterRead') {
    return updateReadingProgressDirectMutation(data, user, options);
  }
  if (action === 'markChapterUnread') return markChapterUnreadDirect(data, user, options);
  return { success: false, error: 'Это изменение ещё не перенесено на новый сервер' };
}

async function canReadNovel(novel, requestedId, user, options = {}) {
  if (!novel || novel.deleted_at || novel.is_deleted === true) return false;
  const hasUser = user && user.user_id !== null && user.user_id !== undefined;
  if (hasUser && String(user.user_id) === '0') return true;
  if (hasUser && String(novel.creator_id) === String(user.user_id)) return true;
  if (hasUser && (user.role === 'admin' || user.role === 'owner')) return true;
  if (novel.access_type === 'public') return true;

  if (hasUser) {
    const [permissions, shelves] = await Promise.all([
      supabaseRestRequest('novel_permissions', {
        user_id: `eq.${user.user_id}`,
        novel_id: `eq.${novel.novel_id}`,
        select: 'permission',
        limit: 1
      }, options),
      supabaseRestRequest('reading_lists', {
        user_id: `eq.${user.user_id}`,
        novel_id: `eq.${novel.novel_id}`,
        select: 'novel_id',
        limit: 1
      }, options)
    ]);
    if (permissions.length || shelves.length) return true;
  }

  const requestedById = /^\d+$/.test(String(requestedId || ''));
  return novel.access_type === 'link_only' && (!requestedById || !novel.slug);
}

async function getNovelDirect(params, options = {}) {
  const requestedId = String(params.id || '').trim();
  if (!requestedId) return { success: false, error: 'Новелла не найдена' };
  const lookup = /^\d+$/.test(requestedId)
    ? { novel_id: `eq.${Number(requestedId)}` }
    : { slug: `eq.${requestedId}` };

  const rows = await supabaseRestRequest('novels', {
    ...lookup,
    select: '*,creator:creator_id(user_id,username),novel_authors(authors(name)),novel_tags(tags(tag_id,name))',
    limit: 1
  }, options);
  if (!rows.length) return { success: false, error: 'Новелла не найдена' };

  const novelDb = rows[0];
  const user = await resolveSessionUser(params, options);
  if (!await canReadNovel(novelDb, requestedId, user, options)) {
    return { success: false, error: 'Доступ к этой новелле ограничен' };
  }

  const chapterPromise = supabaseRestRequest('chapters', {
    novel_id: `eq.${novelDb.novel_id}`,
    is_deleted: 'eq.false',
    select: 'chapter_id,novel_id,volume_name,volume_order,chapter_number,chapter_title,file_id,word_count,created_at,updated_at,publish_at',
    order: 'volume_order.asc,chapter_number.asc'
  }, options);
  const shelfPromise = user.user_id === null
    ? Promise.resolve([])
    : supabaseRestRequest('reading_lists', {
        user_id: `eq.${user.user_id}`,
        novel_id: `eq.${novelDb.novel_id}`,
        select: 'list_type'
      }, options);
  const [chapterRows, shelfRows] = await Promise.all([chapterPromise, shelfPromise]);

  const maySeeFuture = user.role === 'admin' || user.role === 'owner' ||
    String(user.user_id) === String(novelDb.creator_id);
  const now = new Date();
  const chapters = chapterRows
    .map(chapter => {
      const publishDate = chapter.publish_at ? new Date(chapter.publish_at) : null;
      const isFuture = Boolean(publishDate && publishDate > now);
      return { ...chapter, is_future: isFuture };
    })
    .filter(chapter => maySeeFuture || !chapter.is_future);

  const coverUrl = Array.isArray(novelDb.cover_urls) && novelDb.cover_urls.length
    ? novelDb.cover_urls[0]
    : (novelDb.cover_url || null);
  const novel = {
    ...novelDb,
    cover_url: coverUrl,
    creator: novelDb.creator ? {
      user_id: novelDb.creator.user_id,
      username: novelDb.creator.username
    } : null,
    author: novelDb.novel_authors?.[0]?.authors?.name || 'Автор не указан',
    tags: Array.isArray(novelDb.novel_tags)
      ? novelDb.novel_tags.map(row => row.tags ? {
          id: row.tags.tag_id,
          name: row.tags.name
        } : null).filter(Boolean)
      : [],
    chapters,
    userShelves: shelfRows.map(item => item.list_type),
    isOnShelf: shelfRows.length > 0
  };
  delete novel.novel_tags;
  return { success: true, novel };
}

async function getNovelRecordDirect(reference, options = {}) {
  const value = String(reference || '').trim();
  if (!value) return null;
  const lookup = /^\d+$/.test(value)
    ? { novel_id: `eq.${Number(value)}` }
    : { slug: `eq.${value}` };
  const rows = await supabaseRestRequest('novels', {
    ...lookup,
    is_deleted: 'eq.false',
    select: '*,creator:creator_id(user_id,username),novel_authors(authors(name)),novel_tags(tags(tag_id,name))',
    limit: 1
  }, options);
  return rows[0] || null;
}

async function canEditNovelDirect(novel, user, options = {}) {
  const hasUser = user && user.user_id !== null && user.user_id !== undefined;
  if (!hasUser || !novel) return false;
  if (String(user.user_id) === '0') return true;
  if (String(user.user_id) === String(novel.creator_id)) return true;
  if (user.role === 'admin' || user.role === 'owner') return true;
  const rows = await supabaseRestRequest('novel_permissions', {
    user_id: `eq.${user.user_id}`,
    novel_id: `eq.${novel.novel_id}`,
    select: 'permission',
    limit: 1
  }, options);
  return rows.some(row => row.permission === 'edit' || row.permission === 'translate');
}

async function resolveChapterRecordDirect(params, options = {}) {
  if (params.id !== undefined && params.id !== '') {
    const rows = await supabaseRestRequest('chapters', {
      chapter_id: `eq.${Number(params.id)}`,
      is_deleted: 'eq.false',
      select: '*',
      limit: 1
    }, options);
    if (!rows.length) return null;
    const novel = await getNovelRecordDirect(rows[0].novel_id, options);
    return novel ? { chapter: rows[0], novel, requestedNovelReference: novel.novel_id } : null;
  }

  const novel = await getNovelRecordDirect(params.novel, options);
  const chapterNumber = Number(params.chapter);
  if (!novel || !Number.isFinite(chapterNumber)) return null;
  const rows = await supabaseRestRequest('chapters', {
    novel_id: `eq.${novel.novel_id}`,
    chapter_number: `eq.${chapterNumber}`,
    is_deleted: 'eq.false',
    select: '*',
    limit: 1
  }, options);
  return rows.length
    ? { chapter: rows[0], novel, requestedNovelReference: params.novel }
    : null;
}

function filterVisibleChapterRows(rows, novel, user, includeFuture = false) {
  const maySeeFuture = includeFuture || user.role === 'admin' || user.role === 'owner' ||
    String(user.user_id) === String(novel.creator_id);
  const now = new Date();
  return rows
    .map(row => ({
      ...row,
      is_future: Boolean(row.publish_at && new Date(row.publish_at) > now)
    }))
    .filter(row => maySeeFuture || !row.is_future);
}

function mapNovelForEditor(novel, chapters) {
  const authors = (novel.novel_authors || [])
    .map(link => link.authors?.name)
    .filter(Boolean);
  const mapped = {
    ...novel,
    cover_url: Array.isArray(novel.cover_urls) && novel.cover_urls.length
      ? novel.cover_urls[0]
      : (novel.cover_url || null),
    creator: novel.creator || {
      user_id: novel.creator_id,
      username: 'Неизвестен'
    },
    author: authors.join(', ') || 'Автор не указан',
    tags: (novel.novel_tags || [])
      .map(link => link.tags ? { id: link.tags.tag_id, name: link.tags.name } : null)
      .filter(Boolean),
    chapters
  };
  delete mapped.novel_authors;
  delete mapped.novel_tags;
  return mapped;
}

async function getChapterDirect(params, options = {}, forEdit = false) {
  const userPromise = resolveSessionUser(params, options);
  const resolvedPromise = resolveChapterRecordDirect(params, options);
  const [user, resolved] = await Promise.all([userPromise, resolvedPromise]);
  if (!resolved) return { success: false, error: 'Глава не найдена' };
  const { chapter, novel, requestedNovelReference } = resolved;

  if (forEdit) {
    if (!await canEditNovelDirect(novel, user, options)) {
      return { success: false, error: 'У вас нет прав на редактирование этой главы' };
    }
  } else if (!await canReadNovel(novel, requestedNovelReference, user, options)) {
    return { success: false, error: 'Доступ к этой новелле ограничен' };
  }

  const chapterIsFuture = Boolean(chapter.publish_at && new Date(chapter.publish_at) > new Date());
  const maySeeFuture = forEdit || user.role === 'admin' || user.role === 'owner' ||
    String(user.user_id) === String(novel.creator_id);
  if (chapterIsFuture && !maySeeFuture) return { success: false, error: 'Глава не найдена' };

  const chapterRowsPromise = supabaseRestRequest('chapters', {
    novel_id: `eq.${novel.novel_id}`,
    is_deleted: 'eq.false',
    select: 'chapter_id,novel_id,volume_name,volume_order,chapter_number,chapter_title,file_id,word_count,created_at,updated_at,publish_at',
    order: 'volume_order.asc,chapter_number.asc'
  }, options);
  const progressPromise = user.user_id === null
    ? Promise.resolve([])
    : supabaseRestRequest('reading_progress', {
        user_id: `eq.${user.user_id}`,
        novel_id: `eq.${novel.novel_id}`,
        select: 'read_chapters',
        limit: 1
      }, options);
  const contentPromise = chapter.file_id
    ? readChapterGoogleDocument(chapter.file_id, options)
    : Promise.resolve({ content: '[Файл главы отсутствует]', content_rich: null });
  const [rawChapterRows, progressRows, extracted] = await Promise.all([
    chapterRowsPromise,
    progressPromise,
    contentPromise
  ]);
  const allChapters = filterVisibleChapterRows(rawChapterRows, novel, user, forEdit);
  const readChapterIds = new Set((progressRows[0]?.read_chapters || []).map(Number));
  const currentIndex = allChapters.findIndex(row => String(row.chapter_id) === String(chapter.chapter_id));
  const previous = currentIndex > 0 ? allChapters[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < allChapters.length - 1
    ? allChapters[currentIndex + 1]
    : null;
  const chapterResult = {
    ...chapter,
    ...extracted,
    isRead: readChapterIds.has(Number(chapter.chapter_id)),
    prevChapterId: previous?.chapter_id || null,
    nextChapterId: next?.chapter_id || null,
    prevChapterNumber: previous?.chapter_number ?? null,
    nextChapterNumber: next?.chapter_number ?? null,
    allChapters: allChapters.map(row => ({
      chapter_id: row.chapter_id,
      chapter_number: row.chapter_number,
      chapter_title: row.chapter_title,
      volume_name: row.volume_name,
      isRead: readChapterIds.has(Number(row.chapter_id))
    })),
    novel_title: novel.title,
    novel_slug: novel.slug || null
  };

  if (forEdit) {
    return {
      success: true,
      chapter: chapterResult,
      novel: mapNovelForEditor(novel, allChapters)
    };
  }
  return { success: true, chapter: chapterResult };
}

export async function handleDirectQuery(action, params = {}, options = {}) {
  if (action === 'getInitialData' && (params.scope === 'session' || params.scope === 'full')) {
    const user = await resolveSessionUser(params, options);

    if (params.scope === 'full') {
      const [novels, tags, roleTheme] = await Promise.all([
        getVisibleNovelsDirect(user, options),
        getTagsDirect(options),
        getRoleThemeDirect(options)
      ]);
      return {
        success: true,
        user,
        novels,
        config: CLIENT_CONFIG,
        tags,
        roleTheme,
        scope: 'full'
      };
    }

    return {
      success: true,
      user,
      novels: [],
      config: {},
      tags: [],
      roleTheme: 'default',
      scope: 'session'
    };
  }

  if (action === 'getNovel') {
    return getNovelDirect(params, options);
  }

  if (action === 'getChapter') {
    return getChapterDirect(params, options, false);
  }

  if (action === 'getChapterForEdit') {
    return getChapterDirect(params, options, true);
  }

  if (action === 'getReadingLists') {
    const user = await resolveSessionUser(params, options);
    return getReadingListsDirect(user, options);
  }

  if (action === 'getReadingProgress') {
    const user = await resolveSessionUser(params, options);
    return getReadingProgressDirect(params, user, options);
  }

  if (action === 'getMyCreatedNovels') {
    const user = await resolveSessionUser(params, options);
    return getMyCreatedNovelsDirect(user, options);
  }

  if (action === 'getTrash') {
    const user = await resolveSessionUser(params, options);
    return getTrashDirect(user, options);
  }

  if (action === 'getNovelPermissions') {
    const user = await resolveSessionUser(params, options);
    return getNovelPermissionsDirect(params, user, options);
  }

  if (action === 'searchUserForPermission') {
    const user = await resolveSessionUser(params, options);
    return searchUserForPermissionDirect(params, user, options);
  }

  if (action === 'getUserPublicProfile') {
    const user = await resolveSessionUser(params, options);
    return getUserPublicProfileDirect(params, user, options);
  }

  if (action === 'getSubmissions') {
    const user = await resolveSessionUser(params, options);
    return getSubmissionsDirect(params, user, options);
  }

  if (action === 'getDashboardData') {
    const user = await resolveSessionUser(params, options);
    return getDashboardDataDirect(user, options);
  }

  if (action === 'getAllUsers') {
    const user = await resolveSessionUser(params, options);
    return getAllUsersDirect(user, options);
  }

  if (action === 'searchUsers') {
    const user = await resolveSessionUser(params, options);
    return searchUsersDirect(params, user, options);
  }

  if (action === 'getSetting') {
    const user = await resolveSessionUser(params, options);
    return getSettingDirect(params, user, options);
  }

  if (action === 'cleanupSessions') {
    const user = await resolveSessionUser(params, options);
    return cleanupSessionsDirect(user, options);
  }

  if (action === 'getTags') {
    return {
      success: true,
      tags: await getTagsDirect(options)
    };
  }

  if (action === 'searchAuthors') {
    const query = String(params.query || '').trim().replace(/[,*()]/g, '');
    if (query.length < 2) return { success: true, authors: [] };
    const rows = await supabaseRestRequest('authors', {
      or: `(name.ilike.*${query}*,aliases.ilike.*${query}*)`,
      select: 'author_id,name,aliases',
      limit: 5
    }, options);
    return {
      success: true,
      authors: rows.map(author => ({
        id: author.author_id,
        name: author.name,
        aliases: author.aliases || ''
      }))
    };
  }

  if (action === 'getNextChapterNumber') {
    const novelId = Number(params.novel_id);
    if (!Number.isFinite(novelId)) return { success: false, error: 'Не передан ID новеллы' };

    const rows = await supabaseRestRequest('chapters', {
      novel_id: `eq.${novelId}`,
      is_deleted: 'eq.false',
      select: 'chapter_number',
      order: 'chapter_number.desc',
      limit: 1
    }, options);
    const maxNumber = rows.length ? Number(rows[0].chapter_number) || 0 : 0;
    return {
      success: true,
      next_number: Math.floor(maxNumber) + 1,
      max_existing: maxNumber
    };
  }

  if (action === 'checkChapterNumber') {
    const novelId = Number(params.novel_id);
    const chapterNumber = Number(params.chapter_number);
    if (!Number.isFinite(novelId) || !Number.isFinite(chapterNumber)) {
      return { success: false, error: 'Некорректные данные главы' };
    }

    const query = {
      novel_id: `eq.${novelId}`,
      chapter_number: `eq.${chapterNumber}`,
      is_deleted: 'eq.false',
      select: 'chapter_id,chapter_title',
      limit: 1
    };
    if (params.exclude_chapter_id) {
      query.chapter_id = `neq.${Number(params.exclude_chapter_id)}`;
    }
    const rows = await supabaseRestRequest('chapters', query, options);
    if (!rows.length) return { success: true, exists: false };
    return {
      success: true,
      exists: true,
      existing_chapter: {
        id: rows[0].chapter_id,
        title: rows[0].chapter_title
      }
    };
  }

  return { success: false, error: 'Этот запрос ещё не перенесён на новый сервер' };
}

export function getMutationLockKey(action, data = {}) {
  if (action === 'registerWithEmail' && data.email) {
    const emailHash = crypto.createHash('sha256')
      .update(String(data.email).trim().toLowerCase())
      .digest('hex')
      .slice(0, 16);
    return `registration:${emailHash}`;
  }
  if ([
    'logout',
    'addToReadingList',
    'removeFromReadingList',
    'updateReadingProgress',
    'markChapterRead',
    'markChapterUnread',
    'uploadAvatar',
    'deleteAvatar',
    'createAuthorSubmission',
    'updateUserRole',
    'setRoleTheme',
    'setGlobalLimits',
    'addTag',
    'updateTag',
    'deleteTag'
  ].includes(action) && data.session_token) {
    const sessionHash = crypto.createHash('sha256')
      .update(String(data.session_token))
      .digest('hex')
      .slice(0, 16);
    const resourceId = data.novel_id || data.chapter_id || 'session';
    return `user:${sessionHash}:${resourceId}`;
  }
  if (action === 'updateChapter' && data.novel_id) {
    return `novel:${data.novel_id}:chapters`;
  }
  if (['updateChapter', 'deleteChapter'].includes(action) && (data.chapter_id || data.chapterId)) {
    return `chapter:${data.chapter_id || data.chapterId}`;
  }
  if (action === 'addChapter' && data.novel_id) {
    return `novel:${data.novel_id}:chapters`;
  }
  if (['updateNovel', 'deleteNovel', 'restoreNovel', 'permanentDeleteNovel'].includes(action) && (data.novel_id || data.novelId)) {
    return `novel:${data.novel_id || data.novelId}`;
  }
  if (['permanentDeleteChapter'].includes(action) && (data.chapter_id || data.chapterId)) {
    return `chapter:${data.chapter_id || data.chapterId}`;
  }
  if (action === 'restoreFromTrash' && data.itemId) {
    return `${data.itemType === 'novel' ? 'novel' : 'chapter'}:${data.itemId}`;
  }
  if (action === 'emptyTrash') return 'trash:all';
  if (['grantPermission', 'revokePermission'].includes(action) && (data.novelId || data.novel_id)) {
    return `novel:${data.novelId || data.novel_id}:permissions`;
  }
  return null;
}

export function createRequestCoordinator(ttlMs = 5 * 60 * 1000) {
  const locks = new Map();
  const mutations = new Map();

  const prune = () => {
    const now = Date.now();
    for (const [id, entry] of mutations) {
      if (entry.expiresAt <= now) mutations.delete(id);
    }
  };

  const runLocked = (key, task) => {
    if (!key) return Promise.resolve().then(task);
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    locks.set(key, current);
    const cleanup = () => {
      if (locks.get(key) === current) locks.delete(key);
    };
    current.then(cleanup, cleanup);
    return current;
  };

  return {
    run({ mutationId, lockKey, task }) {
      prune();
      if (mutationId && mutations.has(mutationId)) {
        return mutations.get(mutationId).promise;
      }

      const promise = runLocked(lockKey, task);
      if (mutationId) {
        mutations.set(mutationId, {
          promise,
          expiresAt: Date.now() + ttlMs
        });
        promise.catch(() => mutations.delete(mutationId));
      }
      return promise;
    }
  };
}

export function parseJsonp(text, callbackName) {
  const prefix = `${callbackName}(`;
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith(');')) {
    throw new Error('Apps Script вернул некорректный ответ статуса');
  }
  return JSON.parse(trimmed.slice(prefix.length, -2));
}

export async function forwardAppsScriptAction(action, data, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const scriptUrl = options.scriptUrl || process.env.APPS_SCRIPT_URL || DEFAULT_SCRIPT_URL;
  const timeoutMs = options.timeoutMs || 180000;
  const pollIntervalMs = options.pollIntervalMs || 1000;
  const requestId = `node_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const callbackName = `serverStatus_${crypto.randomBytes(6).toString('hex')}`;
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;

  const form = new URLSearchParams({
    action,
    request_id: requestId,
    data: JSON.stringify(data || {})
  });

  let postError = null;
  const postRequest = fetchImpl(scriptUrl, {
    method: 'POST',
    body: form,
    redirect: 'follow',
    signal: controller.signal
  }).then(response => {
    if (!response.ok) throw new Error(`Apps Script отклонил POST: HTTP ${response.status}`);
  }).catch(error => {
    if (error.name !== 'AbortError') postError = error;
  });

  let lastStatus = 'not_found';
  try {
    while (Date.now() < deadline) {
      if (postError) throw postError;

      const statusUrl = new URL(scriptUrl);
      statusUrl.searchParams.set('action', 'getPostStatus');
      statusUrl.searchParams.set('request_id', requestId);
      statusUrl.searchParams.set('callback', callbackName);
      if (data?.session_token) statusUrl.searchParams.set('session_token', data.session_token);

      try {
        const response = await fetchImpl(statusUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const status = parseJsonp(await response.text(), callbackName);
        lastStatus = status.status || 'not_found';

        if (lastStatus === 'completed') return status.result;
        if (lastStatus === 'error') {
          const serverError = new Error(status.error || 'Apps Script не смог выполнить запрос');
          serverError.isAppsScriptResponse = true;
          throw serverError;
        }
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (error.isAppsScriptResponse) throw error;
      }

      await sleep(pollIntervalMs);
    }
  } finally {
    controller.abort();
    await postRequest;
  }

  throw new Error(`Apps Script не завершил запрос за ${Math.round(timeoutMs / 1000)} секунд (последний статус: ${lastStatus})`);
}

export async function runMutationAction(action, data = {}, options = {}) {
  const directMutation = options.directMutation || handleDirectMutation;
  const forwardAction = options.forwardAction || forwardAppsScriptAction;
  const syncContents = options.syncContents || updateContentsDocumentDirect;
  let novelId = Number(data.novel_id);

  const deleteChapterId = data.chapter_id ?? data.chapterId;
  if (action === 'deleteChapter' && !Number.isFinite(novelId) && deleteChapterId) {
    const rows = await supabaseRestRequest('chapters', {
      chapter_id: `eq.${Number(deleteChapterId)}`,
      select: 'novel_id',
      limit: 1
    }, options);
    novelId = Number(rows[0]?.novel_id);
  }

  const isDirect = DIRECT_MUTATION_ACTIONS.has(action);
  const result = isDirect
    ? await directMutation(action, data, options)
    : await forwardAction(action, data, options);

  if (
    !isDirect &&
    action === 'addChapter' &&
    result?.success !== false &&
    result?.chapter_id &&
    !String(data.volume_name || '').trim()
  ) {
    await supabaseRestRequest('chapters', { chapter_id: `eq.${Number(result.chapter_id)}` }, {
      ...options,
      method: 'PATCH',
      body: {
        volume_name: '',
        volume_order: 1,
        updated_at: new Date().toISOString()
      }
    });
  }

  if (
    !isDirect &&
    result?.success !== false &&
    Number.isFinite(novelId) &&
    (action === 'addChapter' || action === 'deleteChapter')
  ) {
    try {
      const contentsResult = await syncContents(novelId, options);
      return { ...result, contents_updated: true, contents_chapter_count: contentsResult.chapter_count };
    } catch (error) {
      console.error(`[contents] Не удалось обновить содержание новеллы ${novelId}:`, error);
      return { ...result, contents_updated: false, contents_warning: error.message };
    }
  }
  return result;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function sendHtml(response, statusCode, title, message) {
  const escapeHtml = value => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const body = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>body{font-family:system-ui;max-width:680px;margin:15vh auto;padding:24px;line-height:1.55}` +
    `h1{font-size:1.6rem}p{color:#444}</style><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></html>`;
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

async function readJsonBody(request, maxBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Содержимое главы превышает допустимый размер');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  let relativePath = decodeURIComponent(requestUrl.pathname);
  if (relativePath === '/') relativePath = '/index.html';
  relativePath = relativePath.replace(/^\/+/, '');

  if (PRIVATE_FILES.has(relativePath) || relativePath.startsWith('.') || relativePath.includes('..')) {
    sendJson(response, 404, { success: false, error: 'Файл не найден' });
    return;
  }

  const filePath = path.resolve(ROOT_DIR, relativePath);
  if (!filePath.startsWith(ROOT_DIR + path.sep)) {
    sendJson(response, 404, { success: false, error: 'Файл не найден' });
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error('Not a file');
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': content.length
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { success: false, error: 'Файл не найден' });
  }
}

function getEdgeCorsHeaders(request, options = {}) {
  const configuredOrigins = options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '*';
  const allowedOrigins = Array.isArray(configuredOrigins)
    ? configuredOrigins
    : String(configuredOrigins).split(',').map(value => value.trim()).filter(Boolean);
  const requestOrigin = request.headers.get('origin') || '';
  const allowAnyOrigin = configuredOrigins === '*' || allowedOrigins.includes('*');
  const allowedOrigin = allowAnyOrigin
    ? '*'
    : (allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0] || '*');

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function edgeJson(request, status, payload, options = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...getEdgeCorsHeaders(request, options),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function getEdgeApiRoute(pathname) {
  const functionMarker = '/functions/v1/api';
  const functionIndex = pathname.lastIndexOf(functionMarker);
  if (functionIndex !== -1) {
    return pathname.slice(functionIndex + functionMarker.length) || '/';
  }

  const apiMarker = '/api';
  const apiIndex = pathname.lastIndexOf(apiMarker);
  if (apiIndex !== -1) {
    return pathname.slice(apiIndex + apiMarker.length) || '/';
  }

  return pathname || '/';
}

const edgeRequestCoordinator = createRequestCoordinator();

export async function handleEdgeRequest(request, options = {}) {
  const requestUrl = new URL(request.url);
  const route = getEdgeApiRoute(requestUrl.pathname);
  const coordinator = options.coordinator || edgeRequestCoordinator;
  const directQuery = options.directQuery || handleDirectQuery;
  const forwardAction = options.forwardAction || forwardAppsScriptAction;
  const directMutation = options.directMutation || handleDirectMutation;
  const mutationAction = options.mutationAction || ((action, data) => runMutationAction(action, data, {
    ...options,
    forwardAction,
    directMutation
  }));

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getEdgeCorsHeaders(request, options)
    });
  }

  if (request.method === 'GET' && route === '/health') {
    const supabase = getSupabaseConfig();
    return edgeJson(request, 200, {
      success: true,
      service: 'novel-lair-edge-function',
      mode: 'supabase-edge',
      supabase_configured: supabase.configured
    }, options);
  }

  if (request.method === 'GET' && route === '/supabase/health') {
    try {
      return edgeJson(request, 200, await checkSupabaseConnection(options), options);
    } catch (error) {
      return edgeJson(request, 503, { success: false, error: error.message }, options);
    }
  }

  if (request.method === 'GET' && route === '/google/health') {
    try {
      const result = await checkGoogleDriveConnection(options);
      return edgeJson(request, result.success ? 200 : 503, result, options);
    } catch (error) {
      const config = getGoogleConfig();
      return edgeJson(request, 503, {
        success: false,
        credentials_configured: config.credentialsConfigured,
        connected: false,
        error: error.message
      }, options);
    }
  }

  if (request.method === 'GET' && route === '/query') {
    try {
      const params = Object.fromEntries(requestUrl.searchParams.entries());
      const result = await directQuery(params.action, params, options);
      return edgeJson(request, result.success === false ? 400 : 200, result, options);
    } catch (error) {
      return edgeJson(request, 502, { success: false, error: error.message }, options);
    }
  }

  if (request.method === 'POST' && route === '/action') {
    const startedAt = Date.now();
    try {
      const payload = await request.json();
      const action = String(payload.action || '').trim();
      if (!action) {
        return edgeJson(request, 400, { success: false, error: 'Не указано действие' }, options);
      }

      const data = payload.data || {};
      const result = await coordinator.run({
        mutationId: String(payload.mutation_id || '').trim() || null,
        lockKey: getMutationLockKey(action, data),
        task: () => mutationAction(action, data)
      });
      return edgeJson(request, 200, {
        ...(result && typeof result === 'object' ? result : { success: true, result }),
        server_duration_ms: Date.now() - startedAt
      }, options);
    } catch (error) {
      return edgeJson(request, 502, {
        success: false,
        error: error.message || 'Ошибка серверного запроса',
        server_duration_ms: Date.now() - startedAt
      }, options);
    }
  }

  return edgeJson(request, 404, { success: false, error: 'Маршрут не найден' }, options);
}

export function createServer(options = {}) {
  const forwardAction = options.forwardAction || forwardAppsScriptAction;
  const directMutation = options.directMutation || handleDirectMutation;
  const mutationAction = options.mutationAction || ((action, data) => runMutationAction(action, data, {
    ...options,
    forwardAction,
    directMutation
  }));
  const coordinator = options.coordinator || createRequestCoordinator();

  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      });
      response.end();
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      const supabase = getSupabaseConfig();
      sendJson(response, 200, {
        success: true,
        service: 'novel-lair-server',
        mode: 'hybrid-migration',
        supabase_configured: supabase.configured
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/supabase/health') {
      try {
        const result = await checkSupabaseConnection();
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 503, { success: false, error: error.message });
      }
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/google/health') {
      try {
        const result = await checkGoogleDriveConnection();
        sendJson(response, result.success ? 200 : 503, result);
      } catch (error) {
        const config = getGoogleConfig();
        sendJson(response, 503, {
          success: false,
          credentials_configured: config.credentialsConfigured,
          connected: false,
          error: error.message
        });
      }
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/google/oauth/start') {
      try {
        response.writeHead(302, {
          Location: createGoogleAuthorizationUrl(),
          'Cache-Control': 'no-store'
        });
        response.end();
      } catch (error) {
        sendHtml(response, 503, 'Google Диск ещё не настроен', error.message);
      }
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/google/oauth/callback') {
      try {
        await completeGoogleAuthorization(requestUrl);
        sendHtml(
          response,
          200,
          'Google Диск подключён',
          'Разрешение сохранено. Эту вкладку можно закрыть и вернуться к сайту.'
        );
      } catch (error) {
        sendHtml(response, 400, 'Не удалось подключить Google Диск', error.message);
      }
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/query') {
      try {
        const params = Object.fromEntries(requestUrl.searchParams.entries());
        const result = await handleDirectQuery(params.action, params);
        sendJson(response, result.success === false ? 400 : 200, result);
      } catch (error) {
        sendJson(response, 502, { success: false, error: error.message });
      }
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/action') {
      const startedAt = Date.now();
      try {
        const payload = await readJsonBody(request);
        const action = String(payload.action || '').trim();
        if (!action) {
          sendJson(response, 400, { success: false, error: 'Не указано действие' });
          return;
        }

        const data = payload.data || {};
        const result = await coordinator.run({
          mutationId: String(payload.mutation_id || '').trim() || null,
          lockKey: getMutationLockKey(action, data),
          task: () => mutationAction(action, data)
        });
        sendJson(response, 200, {
          ...(result && typeof result === 'object' ? result : { success: true, result }),
          server_duration_ms: Date.now() - startedAt
        });
      } catch (error) {
        sendJson(response, 502, {
          success: false,
          error: error.message || 'Ошибка серверного запроса',
          server_duration_ms: Date.now() - startedAt
        });
      }
      return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 404, { success: false, error: 'Маршрут не найден' });
  });
}

export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const host = options.host || process.env.HOST || '127.0.0.1';
  const server = createServer(options);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer();
  const address = server.address();
  console.log(`Логово новелл: http://${address.address}:${address.port}`);
}
