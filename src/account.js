// Đăng nhập bằng tài khoản VET VIRAL để xem tài khoản và nhận thông báo (tính năng mới, khuyến mãi).
// Cách đăng nhập: mã xác nhận. PDF Editor xin mã, người dùng mở vetviral.com/connect và bấm "Cho phép",
// PDF Editor nhận một token ứng dụng riêng (vvapp_…). PDF Editor không bao giờ thấy mật khẩu hay phiên web
// của VET VIRAL, và token này chỉ đọc được tài khoản và thông báo. Tài liệu PDF không được gửi đi.
// Giao thức: docs/app-connections.md trong repo VET VIRAL.

export const VETVIRAL_URL = 'https://vetviral.com';
export const APP_ID = 'pdf-editor';
const TOKEN_KEY = 'pdfEditor.vetviralToken';

// ---------- pure helpers ----------

/** Tên thiết bị gửi kèm yêu cầu, để người dùng nhận ra kết nối trong Cài đặt của VET VIRAL. */
export function clientNameFrom(userAgent) {
  const ua = String(userAgent ?? '');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Trình duyệt';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return `${browser}${os ? ` trên ${os}` : ''}`;
}

export function unreadCount(announcements) {
  return (announcements ?? []).filter((item) => !item.read).length;
}

/**
 * Đường dẫn trong thông báo (nút hành động, ảnh): đường dẫn tương đối của VET VIRAL thành tuyệt đối;
 * chỉ nhận https. Giá trị khác (javascript:, http:, //host) trả null để không hiện.
 */
export function resolveVetviralUrl(value, base = VETVIRAL_URL) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  if (v.startsWith('//')) return null;
  try {
    const url = v.startsWith('/') ? new URL(v, base) : new URL(v);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Nhãn gói hiển thị: mã gói của VET VIRAL, hoặc "Miễn phí". */
export function planLabel(user) {
  if (!user?.plan) return 'Miễn phí';
  const until = user.planExpiresAt ? new Date(user.planExpiresAt) : null;
  return until && !Number.isNaN(until.getTime()) ? `${user.plan} (đến ${until.toLocaleDateString('vi-VN')})` : user.plan;
}

// ---------- errors ----------

export class AccountError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Token không còn dùng được (thu hồi, đăng xuất ở nơi khác, đổi mật khẩu): cần đăng nhập lại. */
export const isSessionExpired = (err) => err instanceof AccountError && err.status === 401;

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

/** localStorage nếu dùng được; trình duyệt chặn bộ nhớ (chế độ riêng tư…) thì chỉ giữ trong phiên. */
export function safeStorage() {
  try {
    const probe = '__pdfEditor_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return memoryStorage();
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AccountError('Đã hủy đăng nhập.', { code: 'aborted' }));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new AccountError('Đã hủy đăng nhập.', { code: 'aborted' }));
    }, { once: true });
  });

// ---------- client ----------

export class AccountClient {
  constructor({ baseUrl = VETVIRAL_URL, fetchImpl = (...args) => globalThis.fetch(...args), storage = memoryStorage() } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.storage = storage;
  }

  get token() {
    try {
      return this.storage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  set token(value) {
    try {
      if (value) this.storage.setItem(TOKEN_KEY, value);
      else this.storage.removeItem(TOKEN_KEY);
    } catch {
      // Bộ nhớ bị chặn: phiên chỉ còn trong trang này.
    }
  }

  get signedIn() {
    return Boolean(this.token);
  }

  async request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new AccountError('Không kết nối được VET VIRAL. Hãy kiểm tra mạng rồi thử lại.', { code: 'network' });
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && auth) this.token = null;
      throw new AccountError(data.error || `VET VIRAL trả lỗi ${response.status}.`, { status: response.status, code: data.code || '' });
    }
    return { status: response.status, data };
  }

  /** Bước 1: xin mã. Trả { deviceCode, userCode, verificationUrl, expiresIn, interval }. */
  async startLogin(clientName) {
    return (await this.request('/api/app-auth/device', { method: 'POST', body: { app: APP_ID, clientName }, auth: false })).data;
  }

  /** Hỏi một lần: { status: 'pending' } hoặc { status: 'approved', token, user }. */
  async pollOnce(deviceCode) {
    return (await this.request('/api/app-auth/token', { method: 'POST', body: { deviceCode }, auth: false })).data;
  }

  /**
   * Bước 2: chờ người dùng bấm "Cho phép" trên vetviral.com. Lưu token khi được cấp, trả user.
   * Từ chối, hết hạn hay hủy thì ném AccountError (code: access_denied, expired_token, aborted).
   */
  async waitForApproval({ deviceCode, interval = 3, expiresIn = 600 }, { signal, onPending } = {}) {
    const deadline = Date.now() + expiresIn * 1000;
    while (Date.now() < deadline) {
      await sleep(interval * 1000, signal);
      const result = await this.pollOnce(deviceCode);
      if (result.status === 'approved' && result.token) {
        this.token = result.token;
        return result.user;
      }
      onPending?.();
    }
    throw new AccountError('Mã đã hết hạn. Hãy đăng nhập lại.', { status: 410, code: 'expired_token' });
  }

  async me() {
    return (await this.request(`/api/apps/${APP_ID}/me`)).data.user;
  }

  async announcements() {
    return (await this.request(`/api/apps/${APP_ID}/announcements`)).data.announcements ?? [];
  }

  async markRead(id) {
    await this.request(`/api/apps/${APP_ID}/announcements/${encodeURIComponent(id)}/read`, { method: 'POST' });
  }

  async markAllRead() {
    await this.request(`/api/apps/${APP_ID}/announcements/read-all`, { method: 'POST' });
  }

  async dismiss(id) {
    await this.request(`/api/apps/${APP_ID}/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Thu hồi kết nối ở máy chủ rồi xóa token; mất mạng thì vẫn xóa token trên máy. */
  async logout() {
    try {
      if (this.token) await this.request(`/api/apps/${APP_ID}/logout`, { method: 'POST' });
    } finally {
      this.token = null;
    }
  }
}
