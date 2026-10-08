# Pastebin-ui

A lightweight content relay built on Cloudflare Workers and KV, for developers who need a simple and efficient way to store and share content. It does not rely on R2 buckets, is easy to deploy, and suits small projects.

This project is extracted from a historical version of the original project as I found it useful. It is open-sourced under the original project's license. If there are any infringement issues, please contact me for removal.

Original project repository: [Pastebin Worker - Historical Version](https://github.com/xiadd/pastebin-worker)

## Layout

```
src/                    Worker backend (Hono)
static/                 Frontend (React + Vite + TS)
scripts/                Tooling scripts
wrangler.toml.example   Deployment template (the real wrangler.toml is not committed)
```

## Deployment Documentation

### 1. Manual Deployment (Recommended)

#### Obtain Cloudflare API Token

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Click on your profile icon in the top-right corner and select **My Profile**.
3. Go to the **API Tokens** page.
4. Click `Create Token` and choose the `Edit Cloudflare Workers` template.
5. Configure and create the token, then copy the generated API Token.

> Least privilege: prefer a custom token with only
> `Account > Workers Scripts > Edit`, `Account > Workers KV Storage > Edit`,
> `Zone > Workers Routes > Edit` (only if you use a custom domain), plus read-only
> `User > User Details` and `Account > Account Settings`. Never use the Global API Key.

![Obtain API Token](./docs/get_api.png)

#### Create KV Storage

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Click on **Storage & Database** in the left menu and select `KV`.
3. Create two `KV` namespaces named `PB` (text) and `PBIMGS` (files).
4. Save the namespace `IDs` for later use.

![Create KV](./docs/create_kv.png)

#### Configure GitHub Secret and Variable

Go to **Settings > Secrets and variables > Actions** in your repository.
**No real ID is committed to the repo** — CI renders `wrangler.toml` at build time
from the items below (template: `wrangler.toml.example`):

| Type | Name | Required | Description |
| --- | --- | --- | --- |
| Secret | `CF_API_TOKEN` | ✅ | The API Token created above |
| Secret | `CF_ACCOUNT_ID` | ✅ | Cloudflare Account ID |
| Secret | `PB_KV_ID` | ✅ | Namespace id of the text KV (`PB`) |
| Secret | `PBIMGS_KV_ID` | ✅ | Namespace id of the file KV (`PBIMGS`) |
| Secret | `ADMIN_TOKEN` | ⬜ | Admin console token. **Leave it unset and the console stays fully disabled** (`/api/admin/*` returns 503) |
| Variable | `BASE_URL` | ✅ | Site URL, e.g. `https://note.example.com` |
| Variable | `ALLOWED_ORIGINS` | ⬜ | Comma-separated origins allowed to call the API; defaults to `BASE_URL` |

![Set GitHub Secret](./docs/set_secret.png)

#### Configure Frontend Environment Variables

Set the Worker URL the frontend should call in `./static/.env`:

```env
VITE_API_URL=<Your Cloudflare Worker Deployment URL>
```

> Production builds read `static/.env.production`, where `VITE_API_URL` is empty by
> default. That means the frontend and the Worker are served from the same origin and
> simply call `/api/*`, so no domain needs to be hard-coded.

![Set Environment Variables](./docs/set_env.png)

#### Deploy to Cloudflare

- Every push to the `main` branch automatically triggers the deployment workflow.
- To manually trigger a deployment:
  1. Open the GitHub Actions page.
  2. Find the appropriate Action and click `Run workflow`.

![Run Deployment Action](./docs/run_action.png)

### 2. Local Development Deployment (DEV)

#### Configure Cloudflare Workers KV Namespace

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Create two KV namespaces named `PB` (text) and `PBIMGS` (files).
3. Save their `IDs` for later use.

#### Generate `wrangler.toml`

Copy the template and fill in your values:

```bash
cp wrangler.toml.example wrangler.toml
```

Or generate it from environment variables:

```bash
CF_ACCOUNT_ID=<account_id> \
PB_KV_ID=<PB kv id> \
PBIMGS_KV_ID=<PBIMGS kv id> \
BASE_URL=https://note.example.com \
node scripts/gen-wrangler.mjs
```

`wrangler.toml` is ignored by `.gitignore` — do not commit it. If you already
committed it before, run `git rm --cached wrangler.toml` once to untrack it.

#### Local Variables (Optional)

```bash
cp .dev.vars.example .dev.vars
```

### Start the Service

#### Start Backend

```bash
yarn install
wrangler dev
```

#### Start Frontend

```bash
cd static
yarn install
yarn dev
```

After starting:
- Backend address: `http://localhost:8787`
- Frontend address: `http://localhost:5173`

> When debugging across ports, include `http://localhost:5173` in `ALLOWED_ORIGINS`,
> otherwise `/api/*` will not send CORS headers.

#### Test Frontend Build

Run the following in the `static` directory:

```bash
yarn build
```

Access `http://localhost:8787` to view the built frontend.

## Development Documentation

### Environment Initialization

1. Install Wrangler CLI:

   ```bash
   npm i -g wrangler
   ```

2. Log in to your Cloudflare account:

   ```bash
   wrangler login
   ```

3. Verify login:

   ```bash
   wrangler whoami
   ```

   Your username should appear if the login is successful.

### Install Dependencies

```bash
yarn install
cd static && yarn install
```

### Configuration Files

Refer to [Generate `wrangler.toml`](#generate-wranglertoml) in the deployment docs.

### Testing

- Access `http://localhost:5173` locally to test the frontend.
- Backend API address: `http://localhost:8787`.

### Deploy to Cloudflare

Refer to [Deployment Documentation](#deployment-documentation).

## Admin Console

The site ships with an admin console for **reviewing, copying and deleting** everything
anyone has uploaded, sorted by upload time. Its main purpose is to catch and take down
illegal or spammy content quickly.

- URL: `https://<your-domain>/admin`
- Auth: you enter `ADMIN_TOKEN` on the login screen and the frontend sends it as the
  `x-admin-token` header. The token lives in `sessionStorage` and is dropped when the
  tab closes.

### Configure the token

`ADMIN_TOKEN` is a credential, so it is **deliberately kept out of `wrangler.toml`**.
Pick whichever option suits you:

1. **GitHub Actions (recommended)**: add `ADMIN_TOKEN` to the repository Secrets.
   `deploy.yml` already hands it to wrangler-action, which stores it as an encrypted
   Worker secret.
2. **Manually**:
   ```bash
   wrangler secret put ADMIN_TOKEN
   ```
3. **Local development**: put it in `.dev.vars` (already git-ignored):
   ```
   ADMIN_TOKEN=dev-token
   ```

> If it is not configured, every `/api/admin/*` request returns `503` and the console
> stays disabled. That is intentional — it guarantees there is never an
> unauthenticated admin entry point.

### What it can do

| Feature | Description |
| --- | --- |
| Browse by time | Newest first by default, switchable to oldest first |
| Filter by type | All / text / file |
| Keyword search | Matches ID, file name, content preview and source IP |
| Deep scan | Reads every body to match a keyword (slower, capped). Use it to hunt for sensitive words inside content |
| Preview | Open an item to see the full body, file info and source IP / UA |
| Copy | One-click copy of the share link or the body, handy for keeping evidence |
| Delete | Delete one item, or tick several and delete in bulk. Links stop working immediately |
| Source tracing | Every record carries the uploader's IP and User-Agent (disable with `LOG_CLIENT_INFO=0`) |

### Why "sort by upload time" needs explaining

Cloudflare KV's `list()` returns keys in lexicographic order only; it exposes
**neither a creation time nor any notion of business time**. So the sorting works
like this:

- on upload, `create_time` (a millisecond timestamp) is written into the KV metadata;
- when listing, that metadata — which `list()` returns anyway — is sorted in memory.

One caveat, stated plainly: **items uploaded before this code was deployed have no
`create_time`**. The console labels them "Unknown time" and pins them to the bottom of
the list, but viewing, copying and deleting still work normally.

### Uploader info and privacy

The uploader's IP and User-Agent are recorded in metadata by default; that is the only
lead available when you need to trace someone after the fact. If you would rather not
keep it, set `LOG_CLIENT_INFO` to `0` (the source column then stays empty).

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/create` | Create a text paste. Body: `content` / `expire` (seconds, ≥60) / `isPrivate` / `language` / `share_password`. The plaintext password for a private paste is returned **only once**, in this response |
| `GET` | `/api/get?id=&share_password=` | Fetch content and metadata (never returns the password) |
| `POST` | `/api/upload` | Upload a file (form field `file`, max 25MB) |
| `GET` | `/raw/:id?share_password=` | Fetch the content as plain text |
| `GET` | `/file/:id` | Fetch a file; only images are inlined, everything else is forced as a download |
| `GET` | `/api/admin/list` | Console listing. Query: `type` (all/text/file), `keyword`, `order` (desc/asc), `page`, `pageSize` |
| `GET` | `/api/admin/content?id=&type=` | Fetch one full item (text returns the body, file returns metadata) |
| `GET` | `/api/admin/search?keyword=` | Read bodies for a full-text match; scans at most 300 items |
| `POST` | `/api/admin/delete` | Delete. Body: `{ items: [{ id, type }] }`, up to 200 per call |

> Every `/api/admin/*` route requires the `x-admin-token` header.

## Security Notes

- **Content sanitization**: Markdown is sanitized with DOMPurify before rendering, so a paste cannot become a stored XSS.
- **File types**: `/file/:id` only inlines images; anything else is served as
  `attachment` with `X-Content-Type-Options: nosniff` and a `Content-Security-Policy`,
  so uploading HTML/SVG cannot execute scripts on this origin.
- **Passwords**: only `SHA-256(salt + password)` is stored, compared in constant time,
  and never returned by the API.
- **CORS**: `/api/*` only allows origins listed in `ALLOWED_ORIGINS`.
- **Admin console**: `/api/admin/*` verifies `x-admin-token` in constant time and adds a
  300ms delay on failure; with `ADMIN_TOKEN` unset the whole group returns 503. These
  routes send **no CORS headers at all**, so cross-origin calls are rejected during the
  browser preflight and there is no CSRF surface. Content is always rendered as plain
  text in the console — someone else's upload is never executed as HTML.
- **Uploader records**: metadata keeps the uploader's IP / User-Agent
  (turn off with `LOG_CLIENT_INFO=0`) so illegal uploads can be traced afterwards.
- **Write protection (recommended)**: `/api/create` and `/api/upload` are fully public.
  Consider adding
  1. **Security > WAF > Rate limiting rules** for `/api/*` per IP;
  2. **Turnstile** on the upload endpoint for stronger protection;
  3. usage alerts on the domain so KV writes cannot be abused silently.
