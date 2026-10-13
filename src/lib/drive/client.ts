/**
 * Google Drive, connected with the user's own OAuth client (created in their own Google Cloud
 * Console, pasted into Settings — this app ships no client secret and runs no server, so there is
 * nothing central to leak). Scope is `drive.file`: Chomugiri can only see files it created itself,
 * never the rest of the user's Drive. The access token lives in memory only (see store.ts) and is
 * never written to IndexedDB, so it cannot be read back by anything after the tab closes.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => void;
            error_callback?: (err: { message?: string }) => void;
          }) => { requestAccessToken: () => void };
          revoke: (token: string, done: () => void) => void;
        };
      };
    };
  }
}

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Drive only works in a browser tab.'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load Google's sign-in script — check your connection."));
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

export interface DriveToken {
  accessToken: string;
  expiresAt: number;
}

/** Opens Google's consent popup and resolves once the user grants (or refuses) drive.file access. */
export function requestDriveToken(clientId: string): Promise<DriveToken> {
  const id = clientId.trim();
  if (!id) return Promise.reject(new Error('Paste your Google OAuth Client ID first.'));
  return loadGis().then(
    () =>
      new Promise<DriveToken>((resolve, reject) => {
        const oauth2 = window.google?.accounts?.oauth2;
        if (!oauth2) { reject(new Error("Google's sign-in did not load.")); return; }
        try {
          const client = oauth2.initTokenClient({
            client_id: id,
            scope: SCOPE,
            callback: (resp) => {
              if (resp.error || !resp.access_token) { reject(new Error(resp.error_description || resp.error || 'Google sign-in was refused.')); return; }
              resolve({ accessToken: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
            },
            error_callback: (err) => reject(new Error(err?.message || 'Google sign-in was cancelled or blocked (check for a popup blocker).')),
          });
          client.requestAccessToken();
        } catch (err) {
          reject(new Error((err as Error).message || 'Google rejected this Client ID — check it was created as a Web application and this origin is in its authorized JavaScript origins.'));
        }
      }),
  );
}

export function revokeDriveToken(accessToken: string): Promise<void> {
  return loadGis()
    .then(
      () =>
        new Promise<void>((resolve) => {
          const oauth2 = window.google?.accounts?.oauth2;
          if (oauth2?.revoke) oauth2.revoke(accessToken, () => resolve());
          else resolve();
        }),
    )
    .catch(() => undefined);
}

let appFolderId: string | null = null;

async function ensureAppFolder(accessToken: string): Promise<string> {
  if (appFolderId) return appFolderId;
  const q = encodeURIComponent("name = 'Chomugiri' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const headers = { Authorization: `Bearer ${accessToken}` };
  const found = await fetch(`${DRIVE_FILES}?q=${q}&spaces=drive&fields=files(id,name)`, { headers });
  if (found.ok) {
    const json = await found.json();
    if (json.files?.[0]?.id) { appFolderId = json.files[0].id as string; return appFolderId; }
  }
  const created = await fetch(DRIVE_FILES, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Chomugiri', mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!created.ok) throw new Error(`Drive would not create the Chomugiri folder (${created.status}).`);
  const json = await created.json();
  appFolderId = json.id as string;
  return appFolderId;
}

/** Uploads a blob into the app's own "Chomugiri" Drive folder (created on first use). Returns the file id. */
export async function uploadToDrive(accessToken: string, filename: string, blob: Blob): Promise<string> {
  const folderId = await ensureAppFolder(accessToken);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: filename, parents: [folderId] })], { type: 'application/json' }));
  form.append('file', blob);
  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const json = await res.json();
  return json.id as string;
}

/** Resets the cached folder id — call on disconnect so a later reconnect looks the folder up fresh. */
export function resetDriveFolderCache(): void {
  appFolderId = null;
}
