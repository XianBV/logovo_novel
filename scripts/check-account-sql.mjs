// Изолированная проверка миграции на PostgreSQL/WASM. Никаких сетевых подключений.
// node scripts/check-account-sql.mjs <путь-к-pglite-package/dist/index.js>
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

if (!process.argv[2]) throw new Error('Укажите локальный путь к dist/index.js пакета @electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const migration = await readFile(new URL('../supabase/migrations/202610280001_account_email.sql', import.meta.url), 'utf8');
const codeMigration = await readFile(new URL('../supabase/migrations/202610280002_confirmation_codes.sql', import.meta.url), 'utf8');
const hash = char => `pbkdf2-sha256$600000$${char.repeat(32)}$${char.repeat(64)}`;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

for (const tokenType of ['text', 'uuid']) {
    const db = new PGlite();
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role;
            create table public.users(user_id bigint primary key, password_hash varchar(101), is_banned boolean default false);
            create table public.sessions(token ${tokenType} primary key, user_id bigint references public.users(user_id), created_at timestamptz, last_used timestamptz, expires_at timestamptz);`);
        const legacy = 'legacy:' + 'a'.repeat(64);
        await db.query('insert into public.users(user_id, password_hash) select generate_series(1,12), $1', [legacy]);
        await db.exec(migration);
        await db.exec(codeMigration);
        await db.exec(codeMigration);
        check((await db.query('select password_hash from public.users where user_id=1')).rows[0].password_hash === legacy, 'Existing password hash preserved');
        await db.query('update public.users set password_hash=$1', [hash('a')]);
        await db.exec(migration);
        const call = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as ok`, args)).rows[0].ok;
        check((await db.query('select email_verification_required from public.users where user_id=1')).rows[0].email_verification_required === false, 'Existing users stay enabled');
        check(await call('auth_issue_email_token', [1, 'password_reset', '1'.repeat(64)]), 'First token issues');
        check(!await call('auth_issue_email_token', [1, 'password_reset', '2'.repeat(64)]), 'One-minute cooldown');
        await db.exec("update public.account_email_tokens set created_at=now()-interval '2 minutes' where user_id=1");
        check(await call('auth_issue_email_token', [1, 'password_reset', '2'.repeat(64)]), 'Resend after cooldown');
        check(!await call('auth_consume_email_token', ['1'.repeat(64), 'password_reset', hash('b')]), 'Old link invalidated');
        await db.exec("update public.account_email_tokens set expires_at=now()-interval '1 second' where token_hash=repeat('2',64)");
        check(!await call('auth_consume_email_token', ['2'.repeat(64), 'password_reset', hash('b')]), 'Expired token refused');

        await db.exec('update public.users set email_verification_required=true where user_id=3');
        check(!await call('auth_create_email_session', [3, hash('a'), crypto.randomUUID()]), 'Unverified account cannot enter');
        check(await call('auth_issue_email_token', [3, 'email_confirm', '3'.repeat(64)]), 'Confirmation issues');
        check(!await call('auth_consume_email_token', ['3'.repeat(64), 'password_reset', hash('b')]), 'Wrong purpose refused');
        check(await call('auth_consume_email_token', ['3'.repeat(64), 'email_confirm', null]), 'Confirmation works');
        check(!await call('auth_consume_email_token', ['3'.repeat(64), 'email_confirm', null]), 'Confirmation single use');
        check(await call('auth_create_email_session', [3, hash('a'), crypto.randomUUID()]), 'Confirmed account enters');

        check(await call('auth_create_email_session', [4, hash('a'), crypto.randomUUID()]), 'Create old session');
        check(await call('auth_issue_email_token', [4, 'password_reset', '4'.repeat(64)]), 'Issue reset');
        check(await call('auth_consume_email_token', ['4'.repeat(64), 'password_reset', hash('b')]), 'Reset succeeds');
        check((await db.query('select count(*)::integer as count from public.sessions where user_id=4')).rows[0].count === 0, 'Reset closes sessions');
        check((await db.query('select password_hash from public.users where user_id=4')).rows[0].password_hash === hash('b'), 'Reset changes hash');
        check(!await call('auth_create_email_session', [4, hash('a'), crypto.randomUUID()]), 'Old password cannot create delayed session');
        check(!await call('auth_consume_email_token', ['4'.repeat(64), 'password_reset', hash('b')]), 'Reset single use');

        await db.exec('update public.users set is_banned=true where user_id=5');
        check(!await call('auth_issue_email_token', [5, 'password_reset', '5'.repeat(64)]), 'Banned user gets no token');
        check(!await call('auth_create_email_session', [5, hash('a'), crypto.randomUUID()]), 'Banned user gets no session');
        check(await call('auth_issue_email_token', [6, 'password_reset', '6'.repeat(64)]), 'Issue credential-bound token');
        await db.query('update public.users set password_hash=$1 where user_id=6', [hash('b')]);
        check(!await call('auth_consume_email_token', ['6'.repeat(64), 'password_reset', hash('c')]), 'Password change invalidates previous token');
        for (let i = 1; i <= 6; i++) {
            await db.exec("update public.account_email_tokens set created_at=now()-interval '2 minutes' where user_id=7");
            check(await call('auth_issue_email_token', [7, 'password_reset', (100 + i).toString(16).padStart(64, '0')]) === (i <= 5), 'Five emails per hour');
        }
        for (let i = 1; i <= 11; i++) check(await call('auth_take_login_attempt', ['f'.repeat(64)]) === (i <= 10), 'Ten login attempts per minute');
        check(!await call('auth_take_login_attempt', [null]), 'Null rate key refused');
        check(!await call('auth_issue_email_token', [1, null, 'a'.repeat(64)]), 'Null token purpose refused');
        check(!await call('auth_consume_email_token', ['3'.repeat(64), null, null]), 'Null consume purpose refused');
        await db.exec('update users set email_verification_required=true where user_id between 8 and 12');
        const challenge8 = crypto.randomUUID();
        check(await call('auth_issue_confirmation_code', [8, '8'.repeat(64), challenge8]), 'Confirmation code issued');
        check((await db.query('select expires_at<=now()+interval \'10 minutes\' as ok from account_email_tokens where challenge_id=$1', [challenge8])).rows[0].ok, 'Code expires after ten minutes');
        for (let i = 0; i < 4; i++) check(!await call('auth_confirm_email_code', [challenge8, 'f'.repeat(64)]), 'Wrong code rejected');
        check(await call('auth_confirm_email_code', [challenge8, '8'.repeat(64)]), 'Correct fifth attempt succeeds');
        check(!await call('auth_confirm_email_code', [challenge8, '8'.repeat(64)]), 'Code cannot be reused');
        const challenge9 = crypto.randomUUID();
        check(await call('auth_issue_confirmation_code', [9, '9'.repeat(64), challenge9]), 'Second challenge issued');
        for (let i = 0; i < 5; i++) check(!await call('auth_confirm_email_code', [challenge9, 'f'.repeat(64)]), 'Five failed attempts counted');
        check(!await call('auth_confirm_email_code', [challenge9, '9'.repeat(64)]), 'Locked code rejects correct value');
        check((await db.query('select failed_attempts from account_email_tokens where challenge_id=$1', [challenge9])).rows[0].failed_attempts === 5, 'Attempt counter stops at five');
        const challenge10 = crypto.randomUUID(), replacement10 = crypto.randomUUID();
        check(await call('auth_issue_confirmation_code', [10, 'a'.repeat(64), challenge10]), 'Issue replaceable code');
        check(!await call('auth_issue_confirmation_code', [10, 'b'.repeat(64), replacement10]), 'Code resend cooldown enforced');
        await db.exec("update account_email_tokens set created_at=now()-interval '2 minutes' where user_id=10");
        check(await call('auth_issue_confirmation_code', [10, 'b'.repeat(64), replacement10]), 'Code resent after cooldown');
        check(!await call('auth_confirm_email_code', [challenge10, 'a'.repeat(64)]), 'Previous code invalidated');
        check(await call('auth_confirm_email_code', [replacement10, 'b'.repeat(64)]), 'Replacement code works');
        const challenge11 = crypto.randomUUID();
        check(await call('auth_issue_confirmation_code', [11, 'c'.repeat(64), challenge11]), 'Issue expiring code');
        await db.query("update account_email_tokens set expires_at=now()-interval '1 second' where challenge_id=$1", [challenge11]);
        check(!await call('auth_confirm_email_code', [challenge11, 'c'.repeat(64)]), 'Expired confirmation code refused');
        const challenge12 = crypto.randomUUID();
        check(await call('auth_issue_confirmation_code', [12, 'd'.repeat(64), challenge12]), 'Issue password-bound code');
        await db.query('update users set password_hash=$1 where user_id=12', [hash('b')]);
        check(!await call('auth_confirm_email_code', [challenge12, 'd'.repeat(64)]), 'Credential change invalidates code');
        await db.exec('set role anon');
        await assert.rejects(call('auth_issue_email_token', [1, 'password_reset', 'a'.repeat(64)]), /permission denied/i);
        await assert.rejects(db.query('select * from public.account_email_tokens'), /permission denied/i);
        await assert.rejects(call('auth_confirm_email_code', [challenge8, '8'.repeat(64)]), /permission denied/i);
        checks += 2;
        checks += 1;
        await db.exec('reset role');
    } finally { await db.close(); }
}
console.log(`PostgreSQL: ${checks} проверок пройдено; миграция повторяема, token совместим с text и uuid.`);
