import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');


function walk(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, results);
    else results.push(full);
  }
  return results;
}

function parseInterface(src, name) {
  const re = new RegExp(`export\\s+interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = src.match(re);
  if (!m) return [];
  const body = m[1];
  const fieldRe = /^\s{2}(\w+)(\??):\s*(.+?);?\s*$/gm;
  const fields = [];
  let fm;
  while ((fm = fieldRe.exec(body)) !== null) {
    fields.push({ name: fm[1], optional: fm[2] === '?', rawType: fm[3].trim() });
  }
  return fields;
}

function toSchema(rawType) {
  const nullable = rawType.includes('| null');
  const base = rawType.replace(/\s*\|\s*null/, '').replace(/\s*\|\s*undefined/, '').trim();

  let s;
  if (base === 'number' || base === 'integer') s = { type: 'integer' };
  else if (base === 'boolean') s = { type: 'boolean' };
  else if (base.startsWith("'") || base === 'string') s = { type: 'string' };
  else if (base.includes("'")) s = { type: 'string', enum: base.split('|').map(v => v.trim().replace(/'/g, '')) };
  else s = { type: 'string' };

  if (nullable) s = { ...s, nullable: true };
  return s;
}

function fieldsToSchema(fields, description) {
  const properties = {};
  const required = [];
  for (const f of fields) {
    properties[f.name] = toSchema(f.rawType);
    if (!f.optional) required.push(f.name);
  }
  const schema = { type: 'object', properties };
  if (required.length) schema.required = required;
  if (description) schema.description = description;
  return schema;
}


const appSrc = readFileSync(join(root, 'src/app.ts'), 'utf8');

const allFiles = walk(join(root, 'src/api'));
const v1Files = allFiles.filter(f => f.endsWith('.v1.routes.ts'));

if (v1Files.length === 0) {
  console.log('No v1 route files found. Run gt gen v1 <entity> first.');
  process.exit(0);
}

const schemas = {};
const paths = {};
const tags = [];

for (const v1File of v1Files) {
  const entity = v1File.split('/').pop().replace('.v1.routes.ts', '');
  const pascal = entity.charAt(0).toUpperCase() + entity.slice(1);

  const mountRe = new RegExp(`app\\.use\\('(/v1/[^']+)'\\s*,\\s*${entity}V1Routes\\)`);
  const mountMatch = appSrc.match(mountRe);
  const mountPath = mountMatch ? mountMatch[1] : `/v1/${entity}s`;

  const typesPath = join(root, 'src/api', entity, `${entity}.types.ts`);
  if (!existsSync(typesPath)) {
    console.warn(`  Warning: ${typesPath} not found, skipping ${entity}`);
    continue;
  }
  const typesSrc = readFileSync(typesPath, 'utf8');

  const entityFields   = parseInterface(typesSrc, pascal);
  const createFields   = parseInterface(typesSrc, `Create${pascal}Dto`);
  const updateFields   = parseInterface(typesSrc, `Update${pascal}Dto`);

  schemas[pascal] = fieldsToSchema(entityFields);
  schemas[`Create${pascal}`] = fieldsToSchema(createFields);
  schemas[`Update${pascal}`] = {
    ...fieldsToSchema(updateFields.map(f => ({ ...f, optional: true }))),
    description: 'All fields optional for partial update',
  };

  tags.push({ name: pascal, description: `${pascal} endpoints` });

  const listPath = mountPath;
  const itemPath = `${mountPath}/{id}`;

  const listResponseSchema = {
    type: 'object',
    properties: {
      data:        { type: 'array', items: { $ref: `#/components/schemas/${pascal}` } },
      nextCursor:  { type: 'string', nullable: true },
      hasMore:     { type: 'boolean' },
      total:       { type: 'integer', nullable: true },
    },
  };

  paths[listPath] = {
    get: {
      tags: [pascal],
      summary: `List ${pascal}s`,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'q',      in: 'query', schema: { type: 'string' },  description: 'Search query' },
        { name: 'page',   in: 'query', schema: { type: 'integer' }, description: 'Page number' },
        { name: 'limit',  in: 'query', schema: { type: 'integer' }, description: 'Items per page' },
        { name: 'cursor', in: 'query', schema: { type: 'string' },  description: 'Cursor for pagination' },
        { name: 'sort',   in: 'query', schema: { type: 'string' },  description: 'Sort field' },
        { name: 'order',  in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
      ],
      responses: {
        200: {
          description: `Paginated list of ${pascal}s`,
          content: { 'application/json': { schema: listResponseSchema } },
        },
        401: { description: 'Unauthorized' },
      },
    },
    post: {
      tags: [pascal],
      summary: `Create ${pascal}`,
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: `#/components/schemas/Create${pascal}` } } },
      },
      responses: {
        201: {
          description: `${pascal} created`,
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${pascal}` } } },
        },
        400: { description: 'Validation error' },
        401: { description: 'Unauthorized' },
      },
    },
  };

  paths[itemPath] = {
    get: {
      tags: [pascal],
      summary: `Get ${pascal} by ID`,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: {
        200: {
          description: `${pascal} found`,
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${pascal}` } } },
        },
        401: { description: 'Unauthorized' },
        404: { description: 'Not found' },
      },
    },
    patch: {
      tags: [pascal],
      summary: `Update ${pascal}`,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: `#/components/schemas/Update${pascal}` } } },
      },
      responses: {
        200: {
          description: `${pascal} updated`,
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${pascal}` } } },
        },
        400: { description: 'Validation error' },
        401: { description: 'Unauthorized' },
        404: { description: 'Not found' },
      },
    },
  };

  console.log(`  ✓ ${pascal}  →  GET/POST ${listPath}  ·  GET/PATCH ${itemPath}`);
}

paths['/oauth/token'] = {
  post: {
    tags: ['Authentication'],
    summary: 'Get access token (client credentials)',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['client_id', 'client_secret'],
            properties: {
              client_id:     { type: 'string', description: 'API client ID from project settings' },
              client_secret: { type: 'string', description: 'API client secret from project settings' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Access token issued',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                access_token: { type: 'string' },
                token_type:   { type: 'string', example: 'Bearer' },
                expires_in:   { type: 'integer', example: 3600 },
              },
            },
          },
        },
      },
      400: { description: 'Missing credentials' },
      401: { description: 'Invalid credentials' },
    },
  },
};

tags.unshift({ name: 'Authentication', description: 'OAuth 2.0 client credentials flow' });

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'v1 API',
    version: '1.0.0',
    description: [
      '## Authentication',
      '',
      'All `/v1/*` endpoints require a Bearer token.',
      '',
      '1. Obtain `client_id` and `client_secret` from **Settings → API Keys** in the dashboard.',
      '2. POST to `/oauth/token` to receive an `access_token`.',
      '3. Pass `Authorization: Bearer <access_token>` on every request.',
      '',
      'Tokens expire after **1 hour**.',
    ].join('\n'),
  },
  tags,
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Obtain a token from POST /oauth/token',
      },
    },
    schemas,
  },
};

const outDir = join(root, 'frontend/public');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const outPath = join(outDir, 'openapi.json');
writeFileSync(outPath, JSON.stringify(spec, null, 2));
console.log(`\nOpenAPI spec written to ${outPath}`);
console.log(`Entities: ${Object.keys(schemas).filter(k => !k.startsWith('Create') && !k.startsWith('Update')).join(', ')}`);
