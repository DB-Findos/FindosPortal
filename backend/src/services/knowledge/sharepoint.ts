import { randomUUID, createHash } from 'node:crypto';
import { httpError } from '../../shared/errors.js';
export const defaultKnowledgeStorage = {
  site: 'https://findos.sharepoint.com/sites/DataundAI587',
  driveId: 'b!5iSXuwWroUeBbhEsy1HldenAZ_COry1AmxJuZjCxOsvtgH_0Tj0JRKWoJioePOKC',
  folderId: '014FO3VMPW4MJG3QTLP5GJ34BRYAMVX2W6',
  folderName: 'KM',
};
const env = (...keys: string[]) => keys.map((key) => process.env[key]?.trim()).find(Boolean) || '';
const credentials = () => ({
  tenant: env(
    'MS_TENANT_ID',
    'AZURE_TENANT_ID',
    'MICROSOFT_TENANT_ID',
    'GRAPH_TENANT_ID',
    'GRAPH_TENANT',
    'SHAREPOINT_TENANT_ID'
  ),
  client: env(
    'MS_CLIENT_ID',
    'AZURE_CLIENT_ID',
    'MICROSOFT_CLIENT_ID',
    'GRAPH_CLIENT_ID',
    'GRAPH_APPLICATION_ID',
    'SHAREPOINT_CLIENT_ID'
  ),
  secret: env(
    'MS_CLIENT_SECRET',
    'AZURE_CLIENT_SECRET',
    'MICROSOFT_CLIENT_SECRET',
    'GRAPH_CLIENT_SECRET',
    'GRAPH_VALUE',
    'SHAREPOINT_CLIENT_SECRET'
  ),
});
const target = () => ({
  driveId: env('KM_SHAREPOINT_DRIVE_ID') || defaultKnowledgeStorage.driveId,
  folderId: env('KM_SHAREPOINT_FOLDER_ID') || defaultKnowledgeStorage.folderId,
});
export function knowledgeStorageStatus() {
  const c = credentials();
  return {
    configured: Boolean(c.tenant && c.client && c.secret),
    site: defaultKnowledgeStorage.site,
    folder: 'KM',
    maxBytes: 26214400,
  };
}
let cachedToken: { value: string; expires: number } | null = null;
function storageError(message: string, status = 502) {
  return Object.assign(httpError(status, message), { publicMessage: true });
}
async function microsoftFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    throw storageError(
      'Microsoft ist derzeit nicht erreichbar. Bitte den Upload erneut versuchen.'
    );
  }
}
async function token() {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const c = credentials();
  if (!c.tenant || !c.client || !c.secret)
    throw storageError(
      'Die SharePoint-Verbindung ist im Backend noch nicht vollständig konfiguriert.',
      503
    );
  const response = await microsoftFetch(
    `https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.client,
        client_secret: c.secret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!response.ok)
    throw storageError(
      'Microsoft-Anmeldung fehlgeschlagen. Bitte die hinterlegte App-Registrierung prüfen.'
    );
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw storageError('Microsoft hat kein Zugriffstoken geliefert.');
  cachedToken = { value: data.access_token, expires: Date.now() + (data.expires_in || 300) * 1000 };
  return cachedToken.value;
}
async function graph(path: string, init: RequestInit = {}) {
  const response = await microsoftFetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${await token()}` },
    redirect: init.redirect ?? 'error',
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok && !(init.redirect === 'manual' && response.status === 302)) {
    if (response.status === 401) cachedToken = null;
    throw storageError(
      response.status === 403
        ? 'Der App-Registrierung fehlt der Schreibzugriff auf die SharePoint-Site Data und AI.'
        : response.status === 404
          ? 'Der konfigurierte SharePoint-Ordner KM wurde nicht gefunden.'
          : `SharePoint-Anfrage fehlgeschlagen (${response.status}).`
    );
  }
  return response;
}
const types: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  zip: 'application/zip',
};
export function templateFile(name: string, bytes: Buffer) {
  const original = name.replaceAll('\\', '/').split('/').at(-1)!.trim();
  const extension = original.split('.').at(-1)?.toLowerCase() || '';
  if (!original || original.length > 180 || !types[extension])
    throw httpError(
      400,
      'Bitte eine Word-, Excel-, PowerPoint-, PDF-, Text- oder ZIP-Vorlage auswählen.'
    );
  if (!bytes.length || bytes.length > 26214400)
    throw httpError(400, 'Vorlagen dürfen maximal 25 MB groß sein.');
  return {
    name: original,
    extension,
    mime_type: types[extension],
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size_bytes: bytes.length,
  };
}
export async function uploadKnowledgeTemplate(name: string, bytes: Buffer) {
  const meta = templateFile(name, bytes),
    destination = target(),
    id = randomUUID();
  const folder = (await (
    await graph(
      `/drives/${encodeURIComponent(destination.driveId)}/items/${encodeURIComponent(destination.folderId)}?$select=id,name,webUrl,folder`
    )
  ).json()) as { id: string; name: string; webUrl: string; folder?: unknown };
  if (
    !folder.folder ||
    folder.name !== 'KM' ||
    !folder.webUrl.startsWith(defaultKnowledgeStorage.site + '/')
  )
    throw storageError('Der Upload-Ordner gehört nicht zur vorgesehenen SharePoint-Site.');
  const storedName = `${id}__${meta.name.replace(/["*:<>?\/\\|#%]/g, '_')}`;
  const response = await graph(
    `/drives/${encodeURIComponent(destination.driveId)}/items/${encodeURIComponent(destination.folderId)}:/${encodeURIComponent(storedName)}:/content`,
    { method: 'PUT', headers: { 'Content-Type': meta.mime_type }, body: new Uint8Array(bytes) }
  );
  const item = (await response.json()) as { id: string; webUrl: string; size: number };
  if (!item.id || !item.webUrl?.startsWith(defaultKnowledgeStorage.site + '/'))
    throw storageError('SharePoint hat keine gültige Dateireferenz geliefert.');
  // Office documents may be rewritten by SharePoint metadata processing. A successful
  // PUT is authoritative; retain the actual stored size instead of rejecting a valid file.
  const storedSize = Number(item.size);
  if (!Number.isSafeInteger(storedSize) || storedSize <= 0 || storedSize > 26214400) {
    try {
      await removeNewKnowledgeUpload(destination.driveId, item.id);
    } catch {}
    throw storageError(
      'SharePoint hat keine gültige Dateigröße innerhalb der Grenze von 25 MB geliefert.'
    );
  }
  return {
    objectId: id,
    ...meta,
    size_bytes: storedSize,
    url: item.webUrl,
    drive_id: destination.driveId,
    item_id: item.id,
    uploaded_at: new Date().toISOString(),
    storage_path: `KM/${storedName}`,
  };
}
export async function removeNewKnowledgeUpload(driveId: string, itemId: string) {
  await graph(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  });
}

export async function downloadKnowledgeTemplate(driveId: string, itemId: string) {
  let response = await graph(
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
    { redirect: 'manual' }
  );
  for (let hop = 0; hop < 4 && [301, 302, 303, 307, 308].includes(response.status); hop++) {
    const location = response.headers.get('location');
    if (!location) throw storageError('SharePoint hat keinen Download geliefert.');
    const url = new URL(location, response.url || 'https://graph.microsoft.com');
    if (
      url.protocol !== 'https:' ||
      url.hostname !== new URL(defaultKnowledgeStorage.site).hostname ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    )
      throw storageError('SharePoint hat ein unerwartetes Download-Ziel geliefert.');
    await response.body?.cancel();
    // Never forward the Graph token to a redirect. Neither URL nor token reaches the browser.
    response = await microsoftFetch(url.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(60000),
    });
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw storageError('Das Dokument konnte nicht von SharePoint heruntergeladen werden.');
  }
  return response.body;
}
