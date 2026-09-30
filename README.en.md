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

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/create` | Create a text paste. Body: `content` / `expire` (seconds, ≥60) / `isPrivate` / `language` / `share_password`. The plaintext password for a private paste is returned **only once**, in this response |
| `GET` | `/api/get?id=&share_password=` | Fetch content and metadata (never returns the password) |
| `POST` | `/api/upload` | Upload a file (form field `file`, max 25MB) |
| `GET` | `/raw/:id?share_password=` | Fetch the content as plain text |
| `GET` | `/file/:id` | Fetch a file; only images are inlined, everything else is forced as a download |

## Security Notes

- **Content sanitization**: Markdown is sanitized with DOMPurify before rendering, so a paste cannot become a stored XSS.
- **File types**: `/file/:id` only inlines images; anything else is served as
  `attachment` with `X-Content-Type-Options: nosniff` and a `Content-Security-Policy`,
  so uploading HTML/SVG cannot execute scripts on this origin.
- **Passwords**: only `SHA-256(salt + password)` is stored, compared in constant time,
  and never returned by the API.
- **CORS**: `/api/*` only allows origins listed in `ALLOWED_ORIGINS`.
- **Write protection (recommended)**: `/api/create` and `/api/upload` are fully public.
  Consider adding
  1. **Security > WAF > Rate limiting rules** for `/api/*` per IP;
  2. **Turnstile** on the upload endpoint for stronger protection;
  3. usage alerts on the domain so KV writes cannot be abused silently.
