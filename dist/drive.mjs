import { id } from './ledger.mjs';
import { parseBackup } from './exports.mjs';
import { dialog, formError, modal, select } from './forms.mjs';
import { option } from './views.mjs';

export function createDriveActions(config, snapshot, restorePreview, notify) {
  const scope = 'https://www.googleapis.com/auth/drive.file';
  if (config.googleClientId) {
    const script = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    document.head.append(script);
  }
  function authorize() {
    if (!globalThis.google?.accounts?.oauth2) throw new Error('Google Drive belum siap. Periksa koneksi dan coba lagi.');
    return new Promise((resolve, reject) => {
      google.accounts.oauth2.initTokenClient({
        client_id: config.googleClientId, scope,
        callback: result => result.access_token ? resolve(result.access_token) : reject(new Error('Izin Google Drive belum diberikan.')),
        error_callback: () => reject(new Error('Jendela izin Google Drive ditutup atau diblokir.')),
      }).requestAccessToken({ prompt: '' });
    });
  }
  async function request(token, path, options = {}) {
    const response = await fetch('https://www.googleapis.com/' + path, {
      ...options, headers: { ...options.headers, Authorization: 'Bearer ' + token },
    });
    if (!response.ok) throw new Error('Google Drive tidak dapat menyelesaikan tindakan ini.');
    return response.json();
  }
  return {
    async save() {
      const data = snapshot();
      const token = await authorize();
      const boundary = 'arus_' + id();
      const metadata = JSON.stringify({ name: data.name, mimeType: 'application/json', appProperties: { arusBackup: '1' } });
      const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata +
        '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + data.snapshot + '\r\n--' + boundary + '--';
      await request(token, 'upload/drive/v3/files?uploadType=multipart', {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
      });
      notify('Backup tersimpan di Google Drive.');
    },
    async restore() {
      const token = await authorize();
      const params = new URLSearchParams({ q: "trashed=false and appProperties has { key='arusBackup' and value='1' }",
        orderBy: 'createdTime desc', pageSize: '100', fields: 'nextPageToken,files(id,name,createdTime,size)' });
      const files = [];
      let page;
      do {
        if (page) params.set('pageToken', page);
        const result = await request(token, 'drive/v3/files?' + params);
        files.push(...(result.files || []));
        page = result.nextPageToken;
      } while (page);
      if (!files.length) return notify('Belum ada backup Arus di Google Drive ini.');
      modal('Pilih backup Google Drive', select('file', 'File backup', files.map(file =>
        option(file.id, file.name + ' · ' + new Date(file.createdTime).toLocaleString('id-ID'))).join('')), null);
      document.querySelector('#dialog-actions').insertAdjacentHTML('beforeend', '<button type="button" class="primary" id="drive-preview">Pratinjau</button>');
      document.querySelector('#drive-preview').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const file = files.find(item => item.id === document.querySelector('[name=file]').value);
          if (Number(file.size) > 20 * 1024 * 1024) throw new Error('Ukuran file melebihi 20 MB.');
          const value = await request(token, 'drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media');
          if (dialog.open && button.isConnected) restorePreview(parseBackup(JSON.stringify(value)));
        } catch (error) { formError.textContent = error.message; }
        finally { button.disabled = false; }
      });
    },
  };
}
