import { prisma } from "@/lib/prisma";
import { BACKUP_SECRET_KEY } from "@/lib/backup-schedule";

/**
 * Google Drive access for backups, over plain `fetch` — no `googleapis`
 * package, which is large and brings far more than four endpoints' worth.
 *
 * The shop owner creates their own OAuth client in Google Cloud and pastes its
 * Client ID and Secret into Settings → Backup; "Connect" then runs Google's
 * consent screen once and keeps the resulting refresh token. Everything is
 * stored in the `Setting` row `backup_google`, which backups leave out and a
 * restore leaves alone (see lib/backup.ts).
 *
 * Scope is `drive.file`: the app can see and touch only files it created
 * itself, never the rest of someone's Drive. That is also why a folder with the
 * same name that the owner made by hand is *not* reused — it is invisible here.
 *
 * Gotcha worth knowing: while the OAuth consent screen is in "Testing" status,
 * Google expires the refresh token after 7 days and every upload then fails
 * with `invalid_grant`. The Settings screen tells the owner to publish it.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export type GoogleSecrets = {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  email?: string;
  folderId?: string;
  folderName?: string;
};

/** What the browser is allowed to know. The secret and the token never leave the server. */
export type GoogleStatus = {
  hasClient: boolean;
  clientId: string;
  hasSecret: boolean;
  connected: boolean;
  email: string | null;
};

export type DriveFile = { id: string; name: string; bytes: number; mtimeMs: number };

// ─── Stored credentials ───────────────────────────────────────────────────────

export async function loadSecrets(): Promise<GoogleSecrets> {
  const row = await prisma.setting.findUnique({ where: { key: BACKUP_SECRET_KEY } });
  const empty: GoogleSecrets = { clientId: "", clientSecret: "" };
  if (!row) return empty;
  try {
    return { ...empty, ...JSON.parse(row.value) };
  } catch {
    return empty;
  }
}

async function saveSecrets(next: GoogleSecrets): Promise<void> {
  const value = JSON.stringify(next);
  await prisma.setting.upsert({
    where: { key: BACKUP_SECRET_KEY },
    create: { key: BACKUP_SECRET_KEY, value },
    update: { value },
  });
}

export async function getStatus(): Promise<GoogleStatus> {
  const s = await loadSecrets();
  return {
    hasClient: Boolean(s.clientId && s.clientSecret),
    clientId: s.clientId,
    hasSecret: Boolean(s.clientSecret),
    connected: Boolean(s.refreshToken),
    email: s.email ?? null,
  };
}

/**
 * Saves the Client ID and, only when one is supplied, the Secret — the form
 * never has the stored secret to send back. Changing the Client ID invalidates
 * any existing connection, since the refresh token belongs to the old client.
 */
export async function saveClient(clientId: string, clientSecret?: string): Promise<void> {
  const current = await loadSecrets();
  const id = clientId.trim();
  const changed = id !== current.clientId || (clientSecret?.trim() && clientSecret.trim() !== current.clientSecret);
  await saveSecrets({
    clientId: id,
    clientSecret: clientSecret?.trim() || current.clientSecret,
    ...(changed ? {} : { refreshToken: current.refreshToken, email: current.email, folderId: current.folderId, folderName: current.folderName }),
  });
  tokenCache = null;
}

/** Forgets the connection (and the revoke at Google's end), optionally the client too. */
export async function disconnect(forgetClient: boolean): Promise<void> {
  const s = await loadSecrets();
  if (s.refreshToken) {
    // Best effort: if Google is unreachable the local copy is still dropped.
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: s.refreshToken }),
    }).catch(() => undefined);
  }
  await saveSecrets(forgetClient ? { clientId: "", clientSecret: "" } : { clientId: s.clientId, clientSecret: s.clientSecret });
  tokenCache = null;
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

/**
 * The address the *browser* used to reach the app. Behind ngrok (or any proxy)
 * the server itself only ever sees `http://localhost:3000`, but Google must be
 * sent back to the public https address that is registered in Google Cloud —
 * a different scheme or host is a `redirect_uri_mismatch`. Proxies announce the
 * original address in `X-Forwarded-*`; without them, the request's own origin
 * is right.
 */
export function publicOrigin(req: { headers: Headers; nextUrl: { origin: string; protocol?: string } }): string {
  const first = (name: string) => req.headers.get(name)?.split(",")[0]?.trim();
  const host = first("x-forwarded-host") ?? req.headers.get("host");
  const proto = first("x-forwarded-proto");
  if (!host) return req.nextUrl.origin;
  return `${proto ?? req.nextUrl.protocol?.replace(":", "") ?? "http"}://${host}`;
}

export const CALLBACK_PATH = "/api/settings/backup/google/callback";

export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    // `offline` + `consent` is what makes Google hand back a refresh token — and
    // hand back a *new* one when the owner reconnects after disconnecting.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function googleError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  const detail = body?.error_description ?? body?.error?.message ?? (typeof body?.error === "string" ? body.error : null);
  return detail ? `${detail} (HTTP ${res.status})` : `HTTP ${res.status}`;
}

/** Trades the one-time consent `code` for a refresh token and stores it. */
export async function completeConnection(code: string, redirectUri: string): Promise<string | null> {
  const s = await loadSecrets();
  if (!s.clientId || !s.clientSecret) throw new Error("Save the Client ID and Client Secret first.");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: s.clientId,
      client_secret: s.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google refused the sign-in: ${await googleError(res)}`);
  const token = await res.json();
  if (!token.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and connect again."
    );
  }

  let email: string | undefined;
  try {
    const about = await fetch(`${API}/about?fields=user(emailAddress)`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (about.ok) email = (await about.json())?.user?.emailAddress;
  } catch {
    // The address is a label for the screen only; the connection works without it.
  }

  await saveSecrets({ ...s, refreshToken: token.refresh_token, email, folderId: undefined, folderName: undefined });
  tokenCache = { token: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 };
  return email ?? null;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

/** A valid access token, refreshed a minute before it lapses. */
async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.token;

  const s = await loadSecrets();
  if (!s.refreshToken) throw new Error("Google Drive is not connected. Connect it in Settings → Backup.");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: s.clientId,
      client_secret: s.clientSecret,
      refresh_token: s.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.clone().json().catch(() => null);
    if (body?.error === "invalid_grant") {
      throw new Error(
        "Google Drive access has expired or was revoked. Reconnect it in Settings → Backup. " +
          "(If this keeps happening every week, set the Google consent screen to “In production”.)"
      );
    }
    throw new Error(`Could not get a Google access token: ${await googleError(res)}`);
  }
  const token = await res.json();
  tokenCache = { token: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

async function api(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${await accessToken()}` },
  });
  if (!res.ok) throw new Error(`Google Drive: ${await googleError(res)}`);
  return res;
}

// ─── Folder + files ───────────────────────────────────────────────────────────

/** Escapes a value for use inside a single-quoted Drive query string. */
function qv(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * The backups folder's id, creating the folder on first use. The id is cached in
 * the stored credentials and re-checked, so a folder trashed by hand is simply
 * made again instead of failing every upload after it.
 */
export async function ensureFolder(name: string): Promise<string> {
  const s = await loadSecrets();

  if (s.folderId && s.folderName === name) {
    try {
      const res = await api(`${API}/files/${encodeURIComponent(s.folderId)}?fields=id,trashed`);
      if (!(await res.json()).trashed) return s.folderId;
    } catch {
      // Gone or inaccessible — fall through and look for / create one.
    }
  }

  const found = await api(
    `${API}/files?` +
      new URLSearchParams({
        q: `name='${qv(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`,
        fields: "files(id)",
        pageSize: "1",
      })
  );
  let id: string | undefined = (await found.json()).files?.[0]?.id;

  if (!id) {
    const created = await api(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    });
    id = (await created.json()).id as string;
  }

  await saveSecrets({ ...(await loadSecrets()), folderId: id, folderName: name });
  return id;
}

/** Uploads one file into `folderId` with Drive's resumable protocol; returns the new file's id. */
export async function uploadFile(
  name: string,
  bytes: Uint8Array,
  folderId: string,
  contentType = "application/gzip"
): Promise<string> {
  const start = await api(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": contentType,
      "X-Upload-Content-Length": String(bytes.byteLength),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const session = start.headers.get("Location");
  if (!session) throw new Error("Google Drive did not start an upload session.");

  // The session URL already carries its own authorisation; adding the bearer
  // header to it is harmless but unnecessary.
  const put = await fetch(session, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(bytes.byteLength) },
    body: bytes as BodyInit,
  });
  if (!put.ok) throw new Error(`Google Drive upload failed: ${await googleError(put)}`);
  const id = (await put.json()).id as string | undefined;
  if (!id) throw new Error("Google Drive accepted the upload but returned no file id.");
  return id;
}

export async function listFiles(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await api(
      `${API}/files?` +
        new URLSearchParams({
          q: `'${qv(folderId)}' in parents and trashed=false`,
          fields: "nextPageToken,files(id,name,size,modifiedTime)",
          orderBy: "modifiedTime desc",
          pageSize: "200",
          ...(pageToken ? { pageToken } : {}),
        })
    );
    const body = await res.json();
    for (const f of body.files ?? []) {
      out.push({ id: f.id, name: f.name, bytes: Number(f.size ?? 0), mtimeMs: Date.parse(f.modifiedTime) });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

export async function deleteFile(id: string): Promise<void> {
  await api(`${API}/files/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function downloadFile(id: string): Promise<Buffer> {
  const res = await api(`${API}/files/${encodeURIComponent(id)}?alt=media`);
  return Buffer.from(await res.arrayBuffer());
}

/** Test hook: forget the in-memory token between cases. */
export function resetTokenCache(): void {
  tokenCache = null;
}
