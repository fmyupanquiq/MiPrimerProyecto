// Prueba de humo de STAGING (ADR 0021, docs/GUIA_DESPLIEGUE.md): recorre la API real con datos
// FICTICIOS y comprueba en PostgreSQL y en disco que lo creado persiste. Crea proyectos, apuestas,
// un ticket y una cuenta de prueba: NUNCA la ejecutes contra la base de producción.
//
//   node scripts/staging-smoke.mjs create   # login, proyecto, ticket (+IA), apuesta 1, permisos
//   (reinicia la API)
//   node scripts/staging-smoke.mjs verify   # tras el reinicio: apuesta 1 intacta, apuesta 2, logout
//
// Variables: SMOKE_API_URL (p. ej. http://localhost:3100), SMOKE_ORIGIN (= APP_BASE_URL de la API),
// SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD, SMOKE_DATABASE_URL, SMOKE_TICKETS_DIR, SMOKE_STATE_FILE
// y opcionalmente SMOKE_ANALYZE=true para analizar el ticket con la IA real (consume la API).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
};
const API = env('SMOKE_API_URL');
const ORIGIN = env('SMOKE_ORIGIN');
const STATE_FILE = env('SMOKE_STATE_FILE');
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, path, { cookie, json, form } = {}) {
  const headers = { Origin: ORIGIN };
  if (cookie) headers.Cookie = cookie;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const response = await fetch(`${API}${path}`, { method, headers, body });
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, headers: response.headers };
}

async function login(email, password) {
  const response = await call('POST', '/api/auth/login', { json: { email, password } });
  const setCookie = response.headers.get('set-cookie') ?? '';
  return { status: response.status, setCookie, cookie: setCookie.split(';')[0] };
}

/** PDF mínimo de un ticket ficticio (texto plano, Helvetica). */
function fakeTicketPdf(lines) {
  const text = lines
    .map((line, i) => `BT /F1 11 Tf 20 ${370 - i * 18} Td (${line}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function simpleBet(houseId, overrides = {}) {
  return {
    houseId,
    stake: '2',
    visibleTotalOdds: '1.95',
    placedAt: new Date().toISOString(),
    selections: [
      {
        eventGroup: 0,
        position: 0,
        sport: 'Futbol',
        event: 'Equipo Alfa vs Equipo Beta',
        market: 'Resultado del partido',
        selection: 'Equipo Alfa gana',
        visibleOdds: '1.95',
      },
    ],
    ...overrides,
  };
}

async function withDb(fn) {
  const client = new pg.Client({ connectionString: env('SMOKE_DATABASE_URL') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function create() {
  const health = await call('GET', '/api/health');
  check(
    'health: API viva y PostgreSQL arriba',
    health.status === 200 && health.data.database === 'up',
  );

  check('sin sesión: 401', (await call('GET', '/api/projects')).status === 401);

  const admin = await login(env('SMOKE_ADMIN_EMAIL'), env('SMOKE_ADMIN_PASSWORD'));
  check('login', admin.status === 200 || admin.status === 201, `HTTP ${admin.status}`);
  check(
    'cookie de sesión __Host-, Secure, HttpOnly, SameSite=Lax',
    /^__Host-letfer_session=/.test(admin.setCookie) &&
      /;\s*Secure/i.test(admin.setCookie) &&
      /;\s*HttpOnly/i.test(admin.setCookie) &&
      /;\s*SameSite=Lax/i.test(admin.setCookie),
  );
  const wrong = await call('POST', '/api/auth/login', {
    json: { email: env('SMOKE_ADMIN_EMAIL'), password: 'contraseña-incorrecta' },
  });
  check(
    'contraseña incorrecta: 401 sin detalles internos',
    wrong.status === 401 && !wrong.data.stack,
  );

  const crossSite = await fetch(`${API}/api/projects`, {
    method: 'POST',
    headers: {
      Origin: 'https://sitio-ajeno.example',
      Cookie: admin.cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'CSRF' }),
  });
  check('CSRF: origen ajeno rechazado (403)', crossSite.status === 403);

  const stamp = new Date().toISOString().slice(0, 19);
  const project = await call('POST', '/api/projects', {
    cookie: admin.cookie,
    json: { name: `Smoke staging ${stamp}`, timezone: 'America/Lima' },
  });
  check('crear proyecto', project.status === 201, `HTTP ${project.status}`);
  const projectId = project.data.id;
  const setup = await call('POST', `/api/projects/${projectId}/setup`, {
    cookie: admin.cookie,
    json: { unitStake: '10.00', houses: [{ name: 'Casa Staging', initialAmount: '500.00' }] },
  });
  check(
    'setup (etapa 1, casa, banca inicial)',
    setup.status === 201 || setup.status === 200,
    `HTTP ${setup.status}`,
  );
  const houses = await call('GET', `/api/projects/${projectId}/houses`, { cookie: admin.cookie });
  const houseId = (Array.isArray(houses.data) ? houses.data : houses.data.houses)[0].id;

  const pdf = fakeTicketPdf([
    'CASA STAGING - Comprobante de apuesta (FICTICIO)',
    `Fecha: ${stamp.slice(0, 10)} 14:30`,
    'Apuesta Simple',
    'Futbol - Equipo Alfa vs Equipo Beta',
    'Mercado: Resultado del partido',
    'Seleccion: Equipo Alfa gana    Cuota 1.95',
    'Apuesta: S/ 20.00',
    'Ganancias potenciales: S/ 39.00',
    'Estado: Pendiente',
  ]);
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'ticket-staging.pdf');
  const ticket = await call('POST', `/api/projects/${projectId}/tickets`, {
    cookie: admin.cookie,
    form,
  });
  check('subir ticket (PDF)', ticket.status === 201, `HTTP ${ticket.status}`);
  const ticketId = ticket.data.id;

  if (process.env.SMOKE_ANALYZE === 'true') {
    const started = Date.now();
    const analysis = await call('POST', `/api/projects/${projectId}/tickets/${ticketId}/analyze`, {
      cookie: admin.cookie,
    });
    const ex = analysis.data.extraction ?? {};
    const raw = JSON.stringify(analysis.data);
    check(
      'IA real: análisis completado',
      (analysis.status === 200 || analysis.status === 201) && analysis.data.status === 'COMPLETED',
      `HTTP ${analysis.status}, ${Math.round((Date.now() - started) / 1000)} s, modelo ${analysis.data.model}`,
    );
    console.log(`     extracción: ${JSON.stringify(ex)}`);
    check(
      'IA: importe 20.00 y cuota 1.95 leídos',
      /^20(\.00?)?$/.test(ex.officialAmount ?? '') && ex.officialTotalOdds === '1.95',
    );
    check('IA: la respuesta no contiene la clave', !/sk-ant-/.test(raw));
  }

  const bet1 = await call('POST', `/api/projects/${projectId}/bets`, {
    cookie: admin.cookie,
    json: simpleBet(houseId, {
      ticketId,
      officialAmount: '20.00',
      officialPotentialReturn: '39.00',
    }),
  });
  check(
    'crear apuesta 1 (con ticket)',
    bet1.status === 201,
    `HTTP ${bet1.status} ${bet1.status !== 201 ? JSON.stringify(bet1.data) : ''}`,
  );
  const fetched = await call('GET', `/api/projects/${projectId}/bets/${bet1.data.id}`, {
    cookie: admin.cookie,
  });
  check(
    'consultar apuesta 1 = respuesta de creación',
    JSON.stringify(fetched.data) === JSON.stringify(bet1.data),
  );

  await withDb(async (db) => {
    const { rows } = await db.query('SELECT id, status, effective_amount FROM bets WHERE id = $1', [
      bet1.data.id,
    ]);
    check('apuesta 1 existe en PostgreSQL', rows.length === 1, JSON.stringify(rows[0] ?? {}));
    const sel = await db.query('SELECT count(*)::int AS n FROM bet_selections WHERE bet_id = $1', [
      bet1.data.id,
    ]);
    check('selección persistida', sel.rows[0].n === 1);
    const t = await db.query('SELECT bet_id, storage_key, checksum FROM tickets WHERE id = $1', [
      ticketId,
    ]);
    check('ticket vinculado a la apuesta 1 en PostgreSQL', t.rows[0]?.bet_id === bet1.data.id);
    const path = join(env('SMOKE_TICKETS_DIR'), t.rows[0].storage_key);
    const onDisk = existsSync(path) ? readFileSync(path) : null;
    check(
      'archivo del ticket en TICKETS_DIR con el mismo SHA-256',
      onDisk && createHash('sha256').update(onDisk).digest('hex') === t.rows[0].checksum,
      path,
    );
  });

  // Aislamiento: una persona de OTRO proyecto no ve este (404) ni entra a la administración (403).
  const other = await call('POST', '/api/projects', {
    cookie: admin.cookie,
    json: { name: `Smoke ajeno ${stamp}` },
  });
  const roles = await call('GET', `/api/projects/${other.data.id}/members/assignable-roles`, {
    cookie: admin.cookie,
  });
  const roleList = Array.isArray(roles.data) ? roles.data : (roles.data.roles ?? []);
  const collaborator = roleList.find((r) => r.key === 'COLLABORATOR');
  const invitation = await call('POST', `/api/projects/${other.data.id}/invitations`, {
    cookie: admin.cookie,
    json: { roleId: collaborator?.id },
  });
  check('invitación creada', invitation.status === 201, `HTTP ${invitation.status}`);
  const outsiderEmail = `ajeno.${Date.now()}@letfer.test`;
  const outsiderPassword = `Smk-${randomBytes(12).toString('base64url')}`;
  const registered = await call('POST', '/api/auth/register', {
    json: {
      token: invitation.data.token,
      firstName: 'Persona',
      lastName: 'Ajena',
      email: outsiderEmail,
      password: outsiderPassword,
    },
  });
  check('registro por invitación', registered.status === 201, `HTTP ${registered.status}`);
  const outsider = (registered.headers.get('set-cookie') ?? '').split(';')[0];
  check(
    'ajeno: proyecto de otro → 404',
    (await call('GET', `/api/projects/${projectId}`, { cookie: outsider })).status === 404,
  );
  check(
    'ajeno: apuestas de otro → 404',
    (await call('GET', `/api/projects/${projectId}/bets/${bet1.data.id}`, { cookie: outsider }))
      .status === 404,
  );
  check(
    'ajeno: archivo de ticket de otro → 404',
    (await call('GET', `/api/projects/${projectId}/tickets/${ticketId}/file`, { cookie: outsider }))
      .status === 404,
  );
  check(
    'ajeno: administración → 403',
    (await call('GET', '/api/admin/users', { cookie: outsider })).status === 403,
  );

  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        projectId,
        houseId,
        ticketId,
        bet1: bet1.data,
        pdfSha: createHash('sha256').update(pdf).digest('hex'),
      },
      null,
      2,
    ),
  );
}

async function verify() {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  const admin = await login(env('SMOKE_ADMIN_EMAIL'), env('SMOKE_ADMIN_PASSWORD'));
  check('tras reiniciar: login', admin.status === 200 || admin.status === 201);
  const { projectId, houseId } = state;

  const again = await call('GET', `/api/projects/${projectId}/bets/${state.bet1.id}`, {
    cookie: admin.cookie,
  });
  check(
    'tras reiniciar: apuesta 1 idéntica',
    JSON.stringify(again.data) === JSON.stringify(state.bet1),
  );
  const file = await call('GET', `/api/projects/${projectId}/tickets/${state.ticketId}/file`, {
    cookie: admin.cookie,
  });
  check(
    'tras reiniciar: archivo del ticket servido íntegro',
    file.status === 200 && createHash('sha256').update(file.data).digest('hex') === state.pdfSha,
  );

  const bet2 = await call('POST', `/api/projects/${projectId}/bets`, {
    cookie: admin.cookie,
    json: simpleBet(houseId, {
      stake: '3',
      visibleTotalOdds: '2.10',
      selections: [
        {
          ...simpleBet(houseId).selections[0],
          event: 'Equipo Gamma vs Equipo Delta',
          selection: 'Empate',
          visibleOdds: '2.10',
        },
      ],
    }),
  });
  check('crear apuesta 2', bet2.status === 201, `HTTP ${bet2.status}`);
  check('apuesta 2 tiene otro id', bet2.data.id && bet2.data.id !== state.bet1.id);
  const one = await call('GET', `/api/projects/${projectId}/bets/${state.bet1.id}`, {
    cookie: admin.cookie,
  });
  check('apuesta 1 no fue sobrescrita', JSON.stringify(one.data) === JSON.stringify(state.bet1));

  const list = await call('GET', `/api/projects/${projectId}/bets`, { cookie: admin.cookie });
  const items = Array.isArray(list.data) ? list.data : (list.data.items ?? list.data.bets ?? []);
  const ids = items.map((b) => b.id);
  check(
    'historial lista las dos apuestas',
    ids.includes(state.bet1.id) && ids.includes(bet2.data.id),
    `${ids.length} apuestas`,
  );

  const status = await call('GET', `/api/projects/${projectId}/dashboard/status`, {
    cookie: admin.cookie,
  });
  console.log(`     dashboard/status: ${JSON.stringify(status.data)}`);
  const expectedCommitted = (20 + 30).toFixed(2); // 20.00 oficial + 3 × unidad 10.00
  check(
    'dashboard refleja lo comprometido (50.00)',
    JSON.stringify(status.data).includes(`"${expectedCommitted}"`),
  );

  await withDb(async (db) => {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM bets WHERE project_id = $1', [
      projectId,
    ]);
    check('PostgreSQL: 2 apuestas en el proyecto', rows[0].n === 2);
  });

  const logout = await call('POST', '/api/auth/logout', { cookie: admin.cookie });
  check('logout', logout.status === 200 || logout.status === 204, `HTTP ${logout.status}`);
  check(
    'tras logout la sesión ya no sirve (401)',
    (await call('GET', '/api/auth/me', { cookie: admin.cookie })).status === 401,
  );
}

const mode = process.argv[2];
if (mode === 'create') await create();
else if (mode === 'verify') await verify();
else throw new Error('Uso: node scripts/staging-smoke.mjs <create|verify>');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas.`);
process.exit(failed.length ? 1 : 0);
