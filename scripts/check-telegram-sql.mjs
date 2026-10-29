// Изолированная PostgreSQL/WASM-проверка. Доступа к настоящей базе нет.
// node scripts/check-telegram-sql.mjs <путь-к-pglite-package/dist/index.js>
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

if (!process.argv[2]) throw new Error('Укажите локальный путь к dist/index.js пакета @electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const migration = await readFile(new URL('../supabase/migrations/202610290001_telegram_login.sql', import.meta.url), 'utf8');
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
for (const tokenType of ['text', 'uuid']) {
    const db = new PGlite();
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role;
            create table public.users(user_id bigint generated always as identity primary key,
              telegram_id text unique,username text not null,role text not null,email text unique,password_hash text,
              email_verification_required boolean not null default false,is_banned boolean default false,
              created_at timestamptz default now(),last_active timestamptz,avatar_url text,bio text);
            create table public.sessions(token ${tokenType} primary key,user_id bigint references users(user_id),
              created_at timestamptz,last_used timestamptz,expires_at timestamptz);
            insert into users(telegram_id,username,role,email,password_hash,avatar_url,bio)
              values('100','Existing owner','owner','owner@example.test','legacy-hash','avatar','biography');
            insert into users(telegram_id,username,role,is_banned) values('101','Banned','reader',true);`);
        await db.exec(migration);
        await db.exec(migration);
        const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args)).rows[0].result;
        const begin = async () => {
            const c = { id: crypto.randomUUID(), client: '123456789', proof: 'a'.repeat(64), nonce: 'b'.repeat(64) };
            check(await call('auth_begin_telegram_login', [c.id, c.client, c.nonce, c.proof]), 'Challenge issues');
            return c;
        };
        const finish = (c, id = '200', overrides = {}) => {
            const args = { ...c, telegram: id, name: 'New reader', session: crypto.randomUUID(), ...overrides };
            return call('auth_finish_telegram_login', [args.id, args.client, args.proof, args.nonce, args.telegram, args.name, args.session]);
        };
        const c = await begin();
        const ttl = (await db.query('select extract(epoch from expires_at-created_at)::int as ttl from telegram_login_challenges where challenge_id=$1', [c.id])).rows[0].ttl;
        check(ttl === 600, 'Challenge expires in ten minutes');
        for (const overrides of [{ proof: 'c'.repeat(64) }, { nonce: 'c'.repeat(64) }, { client: 'other' }, { telegram: null }, { telegram: '-1' }]) {
            check(await finish(c, '200', overrides) === null, 'Wrong browser, nonce, client or ID rejected');
        }
        check((await db.query('select count(*)::int as n from users')).rows[0].n === 2, 'Rejected requests create no user');
        const first = await finish(c);
        check(first.success && first.user.role === 'reader' && first.user.email === null, 'New Telegram user enters without email as reader');
        check(!JSON.stringify(first).includes('password_hash'), 'Response contains no password hash');
        check(await finish(c) === null, 'Challenge cannot be replayed');
        check((await db.query('select count(*)::int as n from sessions')).rows[0].n === 1, 'Replay creates no session');
        const simultaneous = await Promise.all([begin(), begin()]);
        const repeated = await Promise.all(simultaneous.map(item => finish(item)));
        check(repeated.every(item => item.user.user_id === first.user.user_id), 'Two browser logins reuse one Telegram user');
        check((await db.query("select count(*)::int as n from users where telegram_id='200'")).rows[0].n === 1, 'No duplicate Telegram account');
        const owner = await finish(await begin(), '100');
        check(owner.user.role === 'owner' && owner.user.username === 'Existing owner' && owner.user.email === 'owner@example.test', 'Existing role, name and email preserved');
        check(owner.user.avatar_url === 'avatar' && owner.user.bio === 'biography', 'Existing profile preserved');
        check((await db.query("select password_hash from users where telegram_id='100'")).rows[0].password_hash === 'legacy-hash', 'Password untouched');
        const blocked = await begin();
        const sessionsBefore = (await db.query('select count(*)::int as n from sessions')).rows[0].n;
        check(await finish(blocked, '101') === null, 'Banned user cannot enter');
        check((await db.query('select count(*)::int as n from sessions')).rows[0].n === sessionsBefore, 'Banned user gets no session');
        const expired = await begin();
        await db.query("update telegram_login_challenges set expires_at=now()-interval '1 second' where challenge_id=$1", [expired.id]);
        check(await finish(expired, '201') === null, 'Expired challenge refused');
        await begin();
        check((await db.query('select count(*)::int as n from telegram_login_challenges where challenge_id=$1', [expired.id])).rows[0].n === 0, 'Expired challenges cleaned up');
        const collision = await begin();
        const existingToken = (await db.query('select token from sessions limit 1')).rows[0].token;
        await assert.rejects(finish(collision, '202', { session: existingToken }), /duplicate key/i);
        check((await db.query("select count(*)::int as n from users where telegram_id='202'")).rows[0].n === 0, 'Failed session rolls back newly created account');
        check((await finish(collision, '202')).success, 'Failed transaction leaves challenge reusable');
        for (const role of ['anon', 'authenticated']) {
            await db.exec(`set role ${role}`);
            await assert.rejects(call('auth_begin_telegram_login', [crypto.randomUUID(), c.client, c.nonce, c.proof]), /permission denied/i);
            await assert.rejects(finish(c), /permission denied/i);
            await assert.rejects(db.query('select * from telegram_login_challenges'), /permission denied/i);
            checks += 3;
            await db.exec('reset role');
        }
        const rls = (await db.query("select relrowsecurity from pg_class where oid='public.telegram_login_challenges'::regclass")).rows[0].relrowsecurity;
        check(rls, 'Challenge table protected by RLS');
        await db.exec(`insert into telegram_login_challenges(challenge_id,client_id,nonce_hash,proof_hash)
            select md5('synthetic-capacity-'||i)::uuid,'123456789',repeat('a',64),repeat('b',64) from generate_series(1,10000) i;`);
        check(!await call('auth_begin_telegram_login', [crypto.randomUUID(), c.client, c.nonce, c.proof]), 'Anonymous challenge storage is bounded');
    } finally { await db.close(); }
}
console.log(`Telegram PostgreSQL: ${checks} проверок пройдено; настоящая база не использовалась.`);
