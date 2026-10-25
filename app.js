/**
 * LifeKeep - Core Application Logic
 * Offline-first, IndexedDB backed, Mobile PWA
 */

// Modal toggle helper
function toggleModal(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    el.classList.add('flex');
  } else {
    el.classList.add('hidden');
    el.classList.remove('flex');
  }
}
window.toggleModal = toggleModal;

// IndexedDB Storage Manager with Per-Account Isolation & Safe Migration
class StorageManager {
  constructor() {
    this.currentAccount = 'default';
    this.dbName = 'LifeKeepDB';
    this.version = 5;
    this.db = null;
  }

  setAccount(accountKey) {
    if (!accountKey) accountKey = 'default';
    const targetDbName = accountKey === 'default' ? 'LifeKeepDB' : `LifeKeepDB_${accountKey}`;
    if (this.dbName !== targetDbName) {
      if (this.db) {
        try {
          this.db.close();
        } catch (e) {}
        this.db = null;
      }
      this.currentAccount = accountKey;
      this.dbName = targetDbName;
    }
  }

  readStoreFromDb(dbName, storeName) {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(dbName);
        req.onerror = () => resolve([]);
        req.onsuccess = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            return resolve([]);
          }
          try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
              const res = getAllReq.result || [];
              db.close();
              resolve(res);
            };
            getAllReq.onerror = () => {
              db.close();
              resolve([]);
            };
          } catch (err) {
            db.close();
            resolve([]);
          }
        };
      } catch (err) {
        resolve([]);
      }
    });
  }

  async migrateLegacyDataIfNeeded(accountKey) {
    if (!accountKey || accountKey === 'default') return;
    const migrationFlagKey = `lifekeep_migrated_${accountKey}`;
    if (localStorage.getItem(migrationFlagKey)) return;

    try {
      // Check if target DB already has any items or transactions
      const currentItems = await this.getAllItems();
      const currentTxs = await this.getAllTransactions();
      if (currentItems.length > 0 || currentTxs.length > 0) {
        localStorage.setItem(migrationFlagKey, 'true');
        localStorage.setItem(`lifekeep_seeded_${accountKey}`, 'true');
        await this.saveSetting('has_initialized_seed', true);
        return;
      }

      // Read from legacy LifeKeepDB
      const legacyItems = await this.readStoreFromDb('LifeKeepDB', 'items');
      const legacyLogs = await this.readStoreFromDb('LifeKeepDB', 'logs');
      const legacyTxs = await this.readStoreFromDb('LifeKeepDB', 'transactions');
      const legacyCats = await this.readStoreFromDb('LifeKeepDB', 'customCategories');
      const legacyTmpls = await this.readStoreFromDb('LifeKeepDB', 'customTemplates');
      const legacySettings = await this.readStoreFromDb('LifeKeepDB', 'settings');

      // User custom items: filter out demo seed items ('seed-1', 'seed-2', 'seed-3', 'seed-4')
      // because the user explicitly deleted all demo reminders
      const userItems = legacyItems.filter(i => i.id && !i.id.startsWith('seed-'));
      for (const item of userItems) {
        await this.saveItem(item);
      }

      const userLogs = legacyLogs.filter(l => l.id && !l.id.startsWith('seed-'));
      for (const log of userLogs) {
        await this.saveLog(log);
      }

      // Migrate all user transactions (e.g. 2025 income, 2026 expenses)
      for (const tx of legacyTxs) {
        await this.saveTransaction(tx);
      }

      // Migrate custom categories
      for (const cat of legacyCats) {
        await this.saveCustomCategory(cat);
      }

      // Migrate custom templates
      for (const tmpl of legacyTmpls) {
        await this.saveCustomTemplate(tmpl);
      }

      // Migrate custom settings
      for (const s of legacySettings) {
        if (s && s.key) {
          await this.saveSetting(s.key, s.value);
        }
      }

      // Mark this account as migrated and initialized
      localStorage.setItem(migrationFlagKey, 'true');
      localStorage.setItem(`lifekeep_seeded_${accountKey}`, 'true');
      await this.saveSetting('has_initialized_seed', true);
    } catch (e) {
      console.warn('Migration check skipped:', e);
      localStorage.setItem(migrationFlagKey, 'true');
    }
  }

  async ensureDb() {
    if (this.db) return this.db;
    return await this.init();
  }

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      let isSettled = false;
      const request = indexedDB.open(this.dbName, this.version);

      request.onblocked = (e) => {
        console.warn(`${this.dbName} upgrade blocked by another connection or tab.`);
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('items')) {
          const itemStore = db.createObjectStore('items', { keyPath: 'id' });
          itemStore.createIndex('category', 'category', { unique: false });
          itemStore.createIndex('dueDate', 'dueDate', { unique: false });
        }
        if (!db.objectStoreNames.contains('logs')) {
          const logStore = db.createObjectStore('logs', { keyPath: 'id' });
          logStore.createIndex('itemId', 'itemId', { unique: false });
        }
        if (!db.objectStoreNames.contains('customTemplates')) {
          db.createObjectStore('customTemplates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txStore.createIndex('type', 'type', { unique: false });
          txStore.createIndex('date', 'date', { unique: false });
          txStore.createIndex('category', 'category', { unique: false });
        }
        if (!db.objectStoreNames.contains('customCategories')) {
          const catStore = db.createObjectStore('customCategories', { keyPath: 'id' });
          catStore.createIndex('type', 'type', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('notes')) {
          const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
          noteStore.createIndex('dueDate', 'dueDate', { unique: false });
          noteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        isSettled = true;
        this.db = e.target.result;
        this.db.onversionchange = () => {
          if (this.db) {
            this.db.close();
            this.db = null;
          }
          console.warn(`${this.dbName} connection closed due to versionchange in another tab.`);
        };
        resolve(this.db);
      };

      request.onerror = (e) => {
        isSettled = true;
        console.error(`${this.dbName} open error:`, e.target.error);
        reject(e.target.error);
      };

      setTimeout(() => {
        if (!isSettled && !this.db) {
          console.warn(`${this.dbName} init timeout. Proceeding with fallback checks.`);
        }
      }, 3000);
    });
  }

  async getAllItems() {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('items', 'readonly');
      const store = tx.objectStore('items');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveItem(item) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('items', 'readwrite');
      const store = tx.objectStore('items');
      const req = store.put(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteItem(id) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['items', 'logs'], 'readwrite');
      const itemStore = tx.objectStore('items');
      itemStore.delete(id);

      // Also clean up associated logs
      const logStore = tx.objectStore('logs');
      const index = logStore.index('itemId');
      const logReq = index.openCursor(IDBKeyRange.only(id));
      logReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getLogsForItem(itemId) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('logs', 'readonly');
      const store = tx.objectStore('logs');
      const index = store.index('itemId');
      const req = index.getAll(itemId);
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => new Date(b.date) - new Date(a.date));
        resolve(sorted);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getAllLogs() {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('logs', 'readonly');
      const store = tx.objectStore('logs');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveLog(log) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('logs', 'readwrite');
      const store = tx.objectStore('logs');
      const req = store.put(log);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteLog(id) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('logs', 'readwrite');
      const store = tx.objectStore('logs');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Custom Templates Store
  async getCustomTemplates() {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('customTemplates', 'readonly');
      const store = tx.objectStore('customTemplates');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveCustomTemplate(template) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('customTemplates', 'readwrite');
      const store = tx.objectStore('customTemplates');
      const req = store.put(template);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteCustomTemplate(id) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('customTemplates', 'readwrite');
      const store = tx.objectStore('customTemplates');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Transactions Store (Thu nhập & Chi tiêu hàng ngày)
  async getAllTransactions() {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('transactions', 'readonly');
      const store = tx.objectStore('transactions');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => new Date(b.date) - new Date(a.date));
        resolve(sorted);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveTransaction(transaction) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('transactions', 'readwrite');
      const store = tx.objectStore('transactions');
      const req = store.put(transaction);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteTransaction(id) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('transactions', 'readwrite');
      const store = tx.objectStore('transactions');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Custom Categories Store (Tùy chỉnh danh mục Thu / Chi cá nhân)
  async getCustomCategories() {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains('customCategories')) {
        return resolve([]);
      }
      const tx = this.db.transaction('customCategories', 'readonly');
      const store = tx.objectStore('customCategories');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveCustomCategory(category) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('customCategories', 'readwrite');
      const store = tx.objectStore('customCategories');
      const req = store.put(category);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteCustomCategory(id) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('customCategories', 'readwrite');
      const store = tx.objectStore('customCategories');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // App Settings & Monthly Budgets Store
  async getSetting(key) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains('settings')) {
        return resolve(null);
      }
      const tx = this.db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveSetting(key, value) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteSetting(key) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAllSettings() {
    return new Promise((resolve, reject) => {
      if (!this.db.objectStoreNames.contains('settings')) {
        return resolve([]);
      }
      const tx = this.db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllNotes() {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      if (!this.db.objectStoreNames.contains('notes')) {
        return resolve([]);
      }
      const tx = this.db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveNote(note) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const req = store.put(note);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteNote(id) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async importData(data) {
    const storesToClear = ['items', 'logs', 'customTemplates'];
    if (this.db.objectStoreNames.contains('transactions')) {
      storesToClear.push('transactions');
    }
    if (this.db.objectStoreNames.contains('customCategories')) {
      storesToClear.push('customCategories');
    }
    if (this.db.objectStoreNames.contains('settings')) {
      storesToClear.push('settings');
    }
    if (this.db.objectStoreNames.contains('notes')) {
      storesToClear.push('notes');
    }
    const tx = this.db.transaction(storesToClear, 'readwrite');
    const itemStore = tx.objectStore('items');
    const logStore = tx.objectStore('logs');
    const tmplStore = tx.objectStore('customTemplates');
    const txStore = this.db.objectStoreNames.contains('transactions') ? tx.objectStore('transactions') : null;
    const catStore = this.db.objectStoreNames.contains('customCategories') ? tx.objectStore('customCategories') : null;
    const settingsStore = this.db.objectStoreNames.contains('settings') ? tx.objectStore('settings') : null;
    const noteStore = this.db.objectStoreNames.contains('notes') ? tx.objectStore('notes') : null;

    itemStore.clear();
    logStore.clear();
    tmplStore.clear();
    if (txStore) txStore.clear();
    if (catStore) catStore.clear();
    if (settingsStore) settingsStore.clear();
    if (noteStore) noteStore.clear();

    if (data.items) {
      data.items.forEach(item => itemStore.put(item));
    }
    if (data.logs) {
      data.logs.forEach(log => logStore.put(log));
    }
    if (data.customTemplates) {
      data.customTemplates.forEach(t => tmplStore.put(t));
    }
    if (data.transactions && txStore) {
      data.transactions.forEach(t => txStore.put(t));
    }
    if (data.customCategories && catStore) {
      data.customCategories.forEach(c => catStore.put(c));
    }
    if (data.settings && settingsStore) {
      data.settings.forEach(s => settingsStore.put(s));
    }
    if (data.notes && noteStore) {
      data.notes.forEach(n => noteStore.put(n));
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Income Categories
const INCOME_CATEGORIES = [
  { id: 'salary', name: 'Tiền lương', icon: '💼' },
  { id: 'bonus', name: 'Thưởng / Dự án', icon: '🎁' },
  { id: 'business', name: 'Kinh doanh / Bán hàng', icon: '🏪' },
  { id: 'investment', name: 'Đầu tư / Tiền lãi', icon: '📈' },
  { id: 'other_income', name: 'Thu nhập khác', icon: '💵' }
];

// Daily Expense Categories
const EXPENSE_CATEGORIES = [
  { id: 'food', name: 'Ăn uống & Cà phê', icon: '🍜' },
  { id: 'market', name: 'Đi chợ & Siêu thị', icon: '🛒' },
  { id: 'bills', name: 'Hóa đơn Điện & Nước & Net', icon: '💡' },
  { id: 'transport', name: 'Xăng xe & Đi lại', icon: '🛵' },
  { id: 'shopping', name: 'Mua sắm & Đồ dùng', icon: '🛍️' },
  { id: 'entertainment', name: 'Giải trí & Du lịch', icon: '🎬' },
  { id: 'health', name: 'Thuốc men & Sức khỏe', icon: '💊' },
  { id: 'education', name: 'Học tập & Con cái', icon: '📚' },
  { id: 'other_expense', name: 'Chi tiêu khác', icon: '📦' }
];

// Initial Seed Transactions for immediate demonstration
const INITIAL_SEED_TRANSACTIONS = [
  {
    id: 'tx-seed-1',
    type: 'income',
    category: 'salary',
    categoryName: 'Tiền lương',
    amount: 25000000,
    date: '2026-10-05',
    notes: 'Lương tháng 10 chuyển khoản Techcombank'
  },
  {
    id: 'tx-seed-2',
    type: 'income',
    category: 'bonus',
    categoryName: 'Thưởng / Dự án',
    amount: 4500000,
    date: '2026-10-18',
    notes: 'Thưởng hoàn thành tiến độ dự án Q3'
  },
  {
    id: 'tx-seed-3',
    type: 'expense',
    category: 'food',
    categoryName: 'Ăn uống & Cà phê',
    amount: 1850000,
    date: '2026-10-12',
    notes: 'Tiền ăn uống, cà phê gặp gỡ bạn bè'
  },
  {
    id: 'tx-seed-4',
    type: 'expense',
    category: 'market',
    categoryName: 'Đi chợ & Siêu thị',
    amount: 2400000,
    date: '2026-10-15',
    notes: 'Mua thực phẩm tươi sống tuần tại siêu thị'
  },
  {
    id: 'tx-seed-5',
    type: 'expense',
    category: 'bills',
    categoryName: 'Hóa đơn Điện & Nước & Net',
    amount: 1450000,
    date: '2026-10-20',
    notes: 'Tiền điện sinh hoạt và internet tháng 10'
  },
  {
    id: 'tx-seed-6',
    type: 'expense',
    category: 'transport',
    categoryName: 'Xăng xe & Đi lại',
    amount: 750000,
    date: '2026-10-22',
    notes: 'Đổ xăng ô tô & nạp tài khoản ETC trạm thu phí'
  }
];

// Preset Vietnamese Templates for One-Tap Filling
const PRESET_TEMPLATES = [
  {
    name: "Đăng kiểm ô tô",
    category: "vehicle",
    cycleMonths: 12,
    provider: "Trung tâm Đăng kiểm xe cơ giới",
    notes: "Mang theo Đăng ký xe gốc, Bảo hiểm TNDS còn hạn, kiểm tra phạt nguội trước khi đi.",
    icon: "🚗",
    subItems: [
      { name: "Phí kiểm định xe cơ giới", cost: 340000 },
      { name: "Lệ phí cấp giấy chứng nhận", cost: 90000 },
      { name: "Phí bảo trì đường bộ (1 năm)", cost: 1560000 }
    ]
  },
  {
    name: "Bảo hiểm bắt buộc TNDS (Ô tô / Xe máy)",
    category: "vehicle",
    cycleMonths: 12,
    provider: "Bảo Việt / PVI / PTI / VBI",
    notes: "Lưu bản điện tử có mã QR trên điện thoại khi CSGT kiểm tra.",
    icon: "🛡️",
    subItems: [
      { name: "Phí bảo hiểm bắt buộc TNDS (kèm VAT)", cost: 480000 }
    ]
  },
  {
    name: "Thay dầu nhớt & Bảo dưỡng định kỳ",
    category: "vehicle",
    cycleMonths: 6,
    provider: "Gara / Hãng xe",
    notes: "Thay nhớt máy sau mỗi 5.000km hoặc 6 tháng. Kiểm tra lọc gió và nước làm mát.",
    icon: "🔧",
    subItems: [
      { name: "Dầu nhớt động cơ chính hãng", cost: 650000 },
      { name: "Cốc lọc dầu nhớt mới", cost: 120000 },
      { name: "Tiền công thợ bảo dưỡng", cost: 150000 }
    ]
  },
  {
    name: "Vệ sinh máy lạnh / Điều hòa",
    category: "home",
    cycleMonths: 6,
    provider: "Thợ điện lạnh quen",
    notes: "Vệ sinh lưới lọc và dàn nóng trước mùa nắng nóng để tiết kiệm điện và bền block máy.",
    icon: "❄️",
    subItems: [
      { name: "Xịt rửa bảo dưỡng dàn lạnh & dàn nóng", cost: 200000 },
      { name: "Nạp bổ sung gas lạnh R32", cost: 100000 }
    ]
  },
  {
    name: "Thay lõi lọc nước (Lõi 1, 2, 3)",
    category: "home",
    cycleMonths: 6,
    provider: "Đại lý máy lọc nước (Kangaroo / Karofi)",
    notes: "Lõi 1 (PP 5 micron): 3-6 tháng. Lõi 2 (Than hoạt tính): 6-9 tháng. Lõi 3 (PP 1 micron): 9-12 tháng.",
    icon: "💧",
    subItems: [
      { name: "Lõi lọc nước số 1 (PP 5 micron)", cost: 80000 },
      { name: "Lõi lọc số 2 (Than hoạt tính OCB)", cost: 100000 },
      { name: "Lõi lọc số 3 (PP 1 micron)", cost: 120000 }
    ]
  },
  {
    name: "Hợp đồng thuê nhà / Căn hộ",
    category: "home",
    cycleMonths: 12,
    provider: "Chủ nhà",
    notes: "Báo trước 30-45 ngày nếu muốn gia hạn hoặc kết thúc hợp đồng để nhận lại cọc.",
    icon: "🏠",
    subItems: [
      { name: "Tiền thuê nhà định kỳ", cost: 8000000 }
    ]
  },
  {
    name: "Gia hạn Hộ chiếu / CCCD",
    category: "identity",
    cycleMonths: 120, // 10 years
    provider: "Cục Quản lý Xuất nhập cảnh / Cổng DVC",
    notes: "Hộ chiếu nên đổi trước hạn 6 tháng vì nhiều quốc gia không chấp nhận hộ chiếu dưới 6 tháng hạn.",
    icon: "🛂",
    subItems: [
      { name: "Lệ phí cấp đổi hộ chiếu qua cổng DVC", cost: 160000 }
    ]
  },
  {
    name: "Bảo hiểm sức khỏe cá nhân",
    category: "identity",
    cycleMonths: 12,
    provider: "Bảo hiểm PJICO / Bảo Việt / Manulife",
    notes: "Đóng phí tái tục đúng hạn để không bị tính lại thời gian chờ các bệnh lý đặc biệt.",
    icon: "🏥",
    subItems: [
      { name: "Phí bảo hiểm sức khỏe tái tục năm", cost: 3500000 }
    ]
  },
  {
    name: "Bảo hành Laptop / Điện thoại",
    category: "tech",
    cycleMonths: 12,
    provider: "Trung tâm bảo hành chính hãng",
    notes: "Lưu hóa đơn VAT hoặc phiếu xuất kho để được hưởng bảo hành chính hãng.",
    icon: "💻",
    subItems: [
      { name: "Gia hạn gói bảo hành mở rộng / AppleCare", cost: 1800000 }
    ]
  }
];

// Sample Initial Seed Data with cost and sub-items breakdown
const INITIAL_SEED_ITEMS = [
  {
    id: 'seed-1',
    name: 'Đăng kiểm xe Mazda 3',
    category: 'vehicle',
    dueDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 6 days left
    cycleMonths: 12,
    provider: 'Trung tâm Đăng kiểm 50-01S',
    phone: '02838752402',
    cost: 1990000,
    subItems: [
      { name: 'Phí kiểm định xe cơ giới', cost: 340000 },
      { name: 'Lệ phí cấp giấy chứng nhận', cost: 90000 },
      { name: 'Phí bảo trì đường bộ (1 năm)', cost: 1560000 }
    ],
    notes: 'Biển số 51K-123.45. Cần kiểm tra tra cứu phạt nguội trước 1 ngày.',
    photos: []
  },
  {
    id: 'seed-2',
    name: 'Vệ sinh lưới lọc máy lạnh phòng khách',
    category: 'home',
    dueDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 20 days left
    cycleMonths: 6,
    provider: 'Anh Tuấn thợ điện lạnh',
    phone: '0908123456',
    cost: 350000,
    subItems: [
      { name: 'Vệ sinh dàn lạnh & dàn nóng', cost: 250000 },
      { name: 'Nạp bổ sung gas lạnh R32', cost: 100000 }
    ],
    notes: 'Điều hòa Daikin 1.5HP. Nhắc thợ kiểm tra luôn áp suất ga.',
    photos: []
  },
  {
    id: 'seed-3',
    name: 'Thay lõi lọc nước số 1 (Karofi)',
    category: 'home',
    dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Overdue 3 days!
    cycleMonths: 3,
    provider: 'Đại lý Karofi gần nhà',
    phone: '19006418',
    cost: 300000,
    subItems: [
      { name: 'Lõi số 1 PP 5 micron', cost: 80000 },
      { name: 'Lõi số 2 than hoạt tính OCB', cost: 100000 },
      { name: 'Lõi số 3 PP 1 micron', cost: 120000 }
    ],
    notes: 'Mua lõi bông PP 5 micron tự thay hoặc gọi dịch vụ thay tận nhà.',
    photos: []
  },
  {
    id: 'seed-4',
    name: 'Bảo hiểm TNDS bắt buộc Xe máy SH',
    category: 'vehicle',
    dueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 45 days left
    cycleMonths: 12,
    provider: 'Bảo hiểm PVI',
    phone: '1900545458',
    cost: 66000,
    subItems: [
      { name: 'Phí bảo hiểm bắt buộc TNDS 1 năm (kèm VAT)', cost: 66000 }
    ],
    notes: 'Phí 66.000đ/năm. Đã lưu thẻ điện tử trong máy.',
    photos: []
  }
];

// Sample Initial Seed Logs with detailed sub-items
const INITIAL_SEED_LOGS = [
  {
    id: 'seed-log-1',
    itemId: 'seed-1',
    itemName: 'Bảo dưỡng xe Mazda 3 (Cấp 40.000km)',
    category: 'vehicle',
    date: '2026-08-15',
    totalCost: 1020000,
    subItems: [
      { name: 'Thay dầu nhớt động cơ Castrol Edge', cost: 650000 },
      { name: 'Lọc nhớt chính hãng Mazda', cost: 120000 },
      { name: 'Tiền công thợ bảo dưỡng', cost: 150000 },
      { name: 'Cân bằng động & Đảo 4 lốp', cost: 100000 }
    ],
    provider: 'Gara Thành Phát (Quận 7)',
    notes: 'Bảo dưỡng định kỳ lúc 40.250km, xe chạy êm, thợ nhắc lần sau kiểm tra má phanh.',
    photos: []
  },
  {
    id: 'seed-log-2',
    itemId: 'seed-2',
    itemName: 'Vệ sinh lưới lọc máy lạnh phòng khách',
    category: 'home',
    date: '2026-06-20',
    totalCost: 350000,
    subItems: [
      { name: 'Vệ sinh xịt rửa dàn lạnh & dàn nóng', cost: 250000 },
      { name: 'Nạp bổ sung gas lạnh R32', cost: 100000 }
    ],
    provider: 'Anh Tuấn thợ điện lạnh',
    notes: 'Điều hòa Daikin làm lạnh sâu và tiết kiệm điện hơn.',
    photos: []
  },
  {
    id: 'seed-log-3',
    itemId: 'seed-3',
    itemName: 'Thay 3 lõi lọc nước thô Karofi',
    category: 'home',
    date: '2026-07-10',
    totalCost: 300000,
    subItems: [
      { name: 'Lõi số 1 PP 5 micron', cost: 80000 },
      { name: 'Lõi số 2 than hoạt tính OCB', cost: 100000 },
      { name: 'Lõi số 3 PP 1 micron', cost: 120000 }
    ],
    provider: 'Đại lý Karofi',
    notes: 'Tự mua về thay tại nhà, nước chảy mạnh và trong.',
    photos: []
  },
  {
    id: 'seed-log-4',
    itemId: 'seed-4',
    itemName: 'Bảo hiểm TNDS bắt buộc Xe máy SH',
    category: 'vehicle',
    date: '2026-09-05',
    totalCost: 66000,
    subItems: [
      { name: 'Phí bảo hiểm bắt buộc TNDS 1 năm (kèm VAT)', cost: 66000 }
    ],
    provider: 'Bảo hiểm PVI',
    notes: 'Lưu bản điện tử có mã QR trên điện thoại.',
    photos: []
  }
];

// Internationalization (i18n) Bilingual Dictionary (Vietnamese & English)
const I18N = {
  vi: {
    // App & Header
    app_subtitle: 'Trợ lý nhắc việc & tài chính, cá nhân',
    hero_btn_notes: 'Ghi chú',
    hero_btn_jobs: 'Nhắc việc',
    hero_btn_finance: 'Tài chính',
    hero_spending_title: 'TỔNG CHI TIÊU NĂM {year}',
    hero_spending_metric: 'Chi {year} 🪙',
    hero_safe_title: 'Mọi việc & giấy tờ đều trong tầm kiểm soát!',
    hero_safe_badge: 'An toàn',
    hero_btn_add: '+ Thêm mới',
    hero_btn_detail: 'Chi tiết',
    hero_btn_done: 'Xong',

    // Top metrics
    metric_urgent: 'Gấp / Hết',
    metric_soon: 'Sắp tới',
    safe_badge: 'An toàn',

    // Search & Tabs
    search_placeholder: 'Tìm kiếm theo tên mục, địa chỉ, ghi chú...',
    cat_all: '🌟 Tất cả',
    cat_vehicle: '🚗 Phương tiện',
    cat_home: '🏠 Gia dụng & Nhà',
    cat_identity: '🪪 Giấy tờ',
    cat_tech: '💻 Công nghệ',
    tab_pending: 'Việc cần làm',
    tab_history: 'Đã xong',
    tab_notes: 'Ghi chú',

    // Empty states
    empty_jobs_title: 'Không tìm thấy mục nào',
    empty_jobs_desc: 'Không có công việc nào cần làm. Hãy bấm thêm mới bên dưới để không bao giờ bỏ lỡ các kỳ hạn quan trọng.',
    empty_jobs_btn: '+ Thêm công việc đầu tiên',
    history_empty_title: 'Chưa có lịch sử bảo dưỡng nào được lưu',
    history_empty_desc: 'Khi bạn bấm "✓ Đã xong" trên việc cần làm, lịch sử và chi phí con sẽ được lưu vĩnh viễn tại đây để tra cứu.',
    notes_empty_title: 'Chưa có ghi chú nào',
    notes_empty_desc: 'Bấm nút bên dưới để tạo ghi chú đầu tiên của bạn',

    // Job Card & Details
    due_label: 'Hạn:',
    months_per_cycle: 'tháng/lần',
    btn_edit: 'Sửa',
    btn_done: 'Đã xong',
    btn_delete: 'Xóa',
    btn_close: 'Đóng',
    btn_save: 'Lưu thay đổi',
    has_photo: '📷 Có ảnh',
    sub_items_count: '{count} khoản',
    alarm_on_title: 'Chuông báo máy: Đang BẬT (Bấm để tắt)',
    alarm_off_title: 'Chuông báo máy: Đang TẮT (Bấm để bật)',

    // Status badges
    status_overdue: 'Quá hạn {days} ngày',
    status_today: 'Đến hạn hôm nay!',
    status_due_in: 'Còn {days} ngày nữa',
    status_days_left: 'Còn {days} ngày',
    status_no_due: 'Không có hạn',
    not_set: 'Chưa đặt',

    // Categories
    cat_vehicle_name: 'Phương tiện',
    cat_home_name: 'Gia dụng & Nhà',
    cat_identity_name: 'Giấy tờ',
    cat_tech_name: 'Công nghệ',
    cat_other_name: 'Khác',

    // Notes View
    notes_quick_add: '+ Viết nhanh một ghi chú mới...',
    notes_pinned_header: 'Đã ghim',
    notes_all_header: 'Tất cả ghi chú',
    note_modal_new: 'Thêm Ghi chú mới',
    note_modal_edit: 'Chỉnh sửa Ghi chú',
    note_title_label: 'Tiêu đề ghi chú',
    note_title_placeholder: 'Ví dụ: Mã số wifi nhà, Đơn thuốc, Ý tưởng...',
    note_content_label: 'Nội dung chi tiết',
    note_content_placeholder: 'Nhập nội dung ghi chú ở đây...',
    note_color_label: 'Màu sắc thẻ ghi chú',
    note_pin_checkbox: 'Ghim ghi chú này lên đầu danh sách',
    note_alarm_switch: 'Bật chuông báo giờ cho ghi chú này',
    note_alarm_date: 'Ngày hẹn báo',
    note_alarm_time: 'Giờ báo',
    note_alarm_phone: 'Rung & Chuông điện thoại',

    // Bottom Dock
    dock_home: 'Trang chủ',
    dock_help: 'Trợ giúp',
    dock_new_title: 'Menu tác vụ nhanh',
    dock_finance: 'Sổ thu chi',
    dock_backup: 'Dữ liệu',

    // Quick Action Modal
    quick_action_title: 'Tác vụ nhanh',
    quick_action_subtitle: 'Chọn tác vụ bạn muốn thực hiện tiếp theo',
    quick_action_note: 'Ghi chú mới',
    quick_action_note_desc: 'Viết nhanh giấy tờ, mật khẩu, ý tưởng, hẹn giờ báo thức...',
    quick_action_job: 'Thêm nhắc việc',
    quick_action_job_desc: 'Định kỳ thay dầu, hạn bảo hiểm, bảo dưỡng, đăng kiểm xe...',
    quick_action_tx: 'Ghi nhận thu chi',
    quick_action_tx_desc: 'Thêm khoản chi tiêu hàng ngày, thu nhập, hóa đơn sinh hoạt...',
    quick_action_open: 'Mở',

    // Notification Center
    notif_center_title: 'Trung tâm Thông báo',
    notif_center_subtitle: 'Tập trung toàn bộ việc đến hạn & ghi chú cần làm',
    notif_btn_test: '🔔 Thử chuông ngay',
    notif_tab_all: 'Tất cả',
    notif_tab_overdue: '🚨 Quá hạn',
    notif_tab_today: '⚠️ Hôm nay',
    notif_tab_notes: '📝 Ghi chú',
    notif_empty_title: 'Không có thông báo nào cần xử lý!',
    notif_empty_desc: 'Tất cả việc cần làm, gia hạn giấy tờ và ghi chú của bạn đều đang an toàn và đúng hạn.',
    notif_item_count: '{total} việc',
    notif_summary: '{total} mục cần chú ý ({overdue} quá hạn, {today} hôm nay)',
    notif_personal_note: 'Ghi chú cá nhân',
    notif_open: 'Mở',
    notif_view: 'Xem',

    // Settings Modal
    settings_title: 'Cài đặt & Tài khoản',
    settings_secured: 'Tài khoản bảo mật',
    settings_logout: 'Đăng xuất',
    settings_lang_title: 'Ngôn ngữ / Language',
    settings_lang_desc: 'Chọn ngôn ngữ hiển thị của ứng dụng',
    settings_tools_title: 'Công cụ & Tiện ích',
    settings_test_sound: 'Thử chuông & Rung máy',
    settings_manage_cats: 'Quản lý danh mục & Mẫu việc',
    settings_export_csv: 'Xuất báo cáo tài chính (CSV)',
    settings_backup_title: 'Sao lưu & Khôi phục dữ liệu',
    settings_backup_export: 'Xuất sao lưu (JSON)',
    settings_backup_import: 'Khôi phục dữ liệu (JSON)',
    settings_privacy_title: 'Bảo mật & Dữ liệu ngoại tuyến',
    settings_privacy_desc: 'Toàn bộ dữ liệu của bạn được lưu an toàn 100% trong bộ nhớ trình duyệt điện thoại (IndexedDB). Khi mở mạng, app hỗ trợ đồng bộ độc lập cho từng tài khoản.',

    // Home Finance Golden Card
    home_fin_title: 'Tài chính cá nhân',
    home_fin_badge: 'Số dư gốc',
    home_fin_desc: 'Theo dõi dòng tiền & chi tiêu từ số dư gốc',
    home_fin_btn_edit: 'Số dư gốc',
    home_fin_starting_label: '🏦 Số dư gốc:',
    home_fin_starting_unset: '(Chưa cài đặt số dư gốc)',
    home_fin_starting_init: 'Số vốn khởi điểm',
    home_fin_avail_label: '💵 Khả dụng:',
    home_fin_avail_sub: '(Gốc + Thu - Chi)',
    home_fin_spent_origin: 'Đã chi từ số dư gốc:',
    home_fin_origin_remain: 'Tiền gốc còn lại: {amount}',
    home_fin_origin_over: 'Đã tiêu hết gốc & thâm hụt: {amount}',
    home_fin_click_set: 'Bấm "Số dư gốc" để cài đặt',
    home_fin_open_book: 'Mở Sổ thu chi',

    // Finance Modal Header & Overview
    fin_header_title: 'Quản lý Tài chính cá nhân',
    fin_header_desc: 'Theo dõi Số dư gốc, Thu nhập & Chi tiêu',
    fin_btn_export_excel: 'Xuất Excel',
    fin_btn_record_tx: '+ Ghi thu/chi',
    fin_sb_title: 'Số dư gốc khi nhập lần đầu',
    fin_sb_desc: 'Căn cứ để biết từ số dư gốc đó đã chi tiêu thế nào',
    fin_sb_edit_btn: 'Sửa số dư gốc',
    fin_sb_label: '🏦 Số dư gốc:',
    fin_sb_hint: '(Vốn khởi điểm)',
    fin_avail_label: '💵 Khả dụng:',
    fin_avail_hint: '(Gốc + Thu - Chi)',
    fin_spent_origin_label: 'Đã chi tiêu từ số dư gốc:',
    fin_income_added: 'Tổng thu thêm: +{amount}',

    // Finance Period Tabs
    fin_tab_week: 'Tuần',
    fin_tab_month: 'Tháng',
    fin_tab_year: 'Năm',
    fin_tab_custom: 'Tùy chọn',
    fin_tab_all: 'Tất cả',
    fin_period_label: 'Kỳ hiển thị:',
    fin_period_year_report: 'Báo cáo cả năm:',
    fin_period_current_week: 'Tuần hiện tại:',
    fin_period_all_time: 'Toàn bộ lịch sử (Tất cả các năm)',
    fin_period_from: 'Từ:',
    fin_period_to: 'Đến:',

    // Monthly Budget Card
    fin_budget_title: 'Hạn mức Ngân sách',
    fin_budget_subtitle: 'Kiểm soát chi tiêu không vượt ngưỡng',
    fin_budget_btn_set: 'Đặt hạn mức',
    fin_budget_btn_edit: 'Sửa hạn mức',
    fin_budget_limit_label: 'Hạn mức:',
    fin_budget_spent_label: 'Đã chi:',
    fin_budget_remain_label: 'Còn lại:',
    fin_budget_over_label: 'Vượt mức:',

    // KPI Cards
    fin_kpi_income: '🟢 Tổng Thu nhập:',
    fin_kpi_expense: '🔴 Tổng Chi tiêu:',
    fin_kpi_expense_sub: 'Hàng ngày + Nhắc việc',
    fin_kpi_net: '💰 Số dư tích lũy (Thu - Chi):',
    fin_kpi_income_count: '{count} khoản thu trong kỳ',
    fin_savings_rate: 'Tiết kiệm: {rate}% thu nhập',
    fin_deficit_rate: 'Thâm hụt: {rate}%',
    fin_no_income_yet: 'Chưa có khoản thu',

    // Breakdown Card
    fin_breakdown_title: '📊 Bóc tách cấu trúc Chi tiêu:',
    fin_breakdown_daily: 'Sinh hoạt ngày:',
    fin_breakdown_maint: 'Nhắc việc / Xe:',

    // Charts & Feed
    fin_chart_trend: 'Diễn biến Thu nhập & Chi tiêu',
    fin_legend_income: 'Thu',
    fin_legend_expense: 'Chi',
    fin_chart_doughnut: 'Cơ cấu chi tiêu tổng hợp',
    fin_feed_title: 'Lịch sử Giao dịch',
    fin_feed_new: '+ Ghi mới',
    fin_filter_all: 'Tất cả',
    fin_filter_income: '🟢 Thu nhập',
    fin_filter_daily: '🔴 Chi hàng ngày',
    fin_filter_maint: '🔧 Chi nhắc việc',
    fin_feed_empty_title: 'Không có giao dịch nào trong bộ lọc này',
    fin_feed_empty_desc: 'Bấm nút "+ Ghi thu/chi" ở trên để lưu giao dịch đầu tiên.',
    fin_footer_add: 'Thêm khoản Thu / Chi mới',

    // Transaction Modal
    tx_modal_title: 'Ghi nhận Thu / Chi',
    tx_modal_edit_title: 'Chỉnh sửa Giao dịch',
    tx_type_label: 'Loại giao dịch',
    tx_type_expense: '🔴 Chi tiêu',
    tx_type_income: '🟢 Thu nhập',
    tx_amount_label: 'Số tiền (₫)',
    tx_amount_placeholder: 'Ví dụ: 150.000',
    tx_cat_label: 'Danh mục',
    tx_manage_cat: '⚙️ Quản lý danh mục',
    tx_date_label: 'Ngày phát sinh',
    tx_notes_label: 'Ghi chú & Chi tiết',
    tx_notes_placeholder: 'Ví dụ: Ăn trưa với đồng nghiệp, Mua đồ siêu thị...',
    tx_submit_btn: 'Lưu giao dịch',

    // Starting Balance Modal
    sb_modal_title: 'Cài đặt Số dư gốc ban đầu',
    sb_modal_subtitle: 'Theo dõi chi tiêu từ số vốn/tiền ban đầu',
    sb_modal_desc: '💡 <strong>Số dư gốc</strong> là tổng số tiền bạn có khi bắt đầu sử dụng App. Từ số tiền này, App sẽ tính toán chi tiết <strong>bạn đã chi tiêu hết bao nhiêu %</strong> và <strong>còn lại bao nhiêu tiền gốc</strong>.',
    sb_input_label: 'Nhập số dư gốc ban đầu (₫):',
    sb_quick_suggestions: '⚡ Gợi ý số tiền nhanh:',
    sb_save_btn: 'Lưu số dư gốc',
    sb_cancel_btn: 'Hủy',

    // Budget Modal
    budget_modal_title: 'Thiết lập Hạn mức Ngân sách',
    budget_applied_month: 'Tháng áp dụng',
    budget_max_limit_label: 'Hạn mức chi tiêu tối đa (₫)',
    budget_default_checkbox: 'Đặt làm ngân sách mặc định cho tất cả các tháng sau',
    budget_save_btn: 'Lưu hạn mức',
    budget_delete_btn: 'Xóa',

    // Category Modal
    cat_modal_title: 'Quản lý Danh mục Thu / Chi',
    cat_tab_expense: 'Chi tiêu',
    cat_tab_income: 'Thu nhập',
    cat_default_badge: 'Mặc định',
    cat_btn_add: '+ Thêm danh mục',
    cat_add_section: '+ Thêm danh mục mới:',
    cat_name_placeholder: 'Tên danh mục...',
    cat_select_icon: 'Chọn icon:',
    cat_btn_add_action: '+ Thêm danh mục này',
    cat_expense_heading: 'Danh mục Chi tiêu:',
    cat_income_heading: 'Danh mục Thu nhập:',

    // Unit & Quick Chips
    unit_million: 'triệu',
    quick_amount_suggestions: '⚡ Gợi ý số tiền nhanh:',
    budget_placeholder: 'Ví dụ: 15.000.000',
    budget_delete_title: 'Xóa ngân sách tháng này',
    sb_input_placeholder: 'Ví dụ: 10.000.000',

    // Excel Export Modal
    export_csv_modal_title: 'Xuất Báo cáo Excel (CSV)',
    export_csv_desc: 'File xuất ra định dạng <strong>CSV chuẩn UTF-8 BOM</strong>, nhấp đúp là mở trực tiếp bằng Microsoft Excel hoặc Google Sheets không bị lỗi font tiếng Việt, số tiền được định dạng chuẩn để tính toán.',
    export_csv_period_title: 'Xuất Thu - Chi kỳ đang xem',
    export_csv_period_desc: 'Chỉ gồm các giao dịch trong khoảng thời gian đang lọc',
    export_csv_all_title: 'Xuất Toàn bộ Thu - Chi & Bảo dưỡng',
    export_csv_all_desc: 'Toàn bộ lịch sử thu nhập, chi tiêu và chi phí nhắc việc từ trước tới nay',
    export_csv_maint_title: 'Xuất Sổ Nhật ký Bảo dưỡng & Giấy tờ',
    export_csv_maint_desc: 'Bao gồm ngày làm, nơi làm/gara, bóc tách chi phí con chi tiết',

    // Finance Toasts & Dialogs
    toast_save_tx_success: '💰 Đã lưu giao dịch thành công!',
    toast_delete_tx_success: '🗑️ Đã xóa giao dịch!',
    toast_save_budget_success: '🎯 Đã lưu hạn mức ngân sách: {amount}',
    toast_clear_budget_success: '🗑️ Đã xóa hạn mức ngân sách tháng này!',
    toast_save_sb_success: '✅ Đã lưu số dư gốc ban đầu: {amount}',
    toast_add_cat_success: '🏷️ Đã thêm danh mục mới!',
    toast_delete_cat_success: '🗑️ Đã xóa danh mục!',
    tx_confirm_delete: 'Bạn có chắc chắn muốn xóa giao dịch này không?',
    tx_alert_invalid_amount: 'Vui lòng nhập số tiền hợp lệ!',
    budget_alert_invalid_amount: 'Vui lòng nhập số tiền ngân sách hợp lệ!',
    cat_alert_empty_name: 'Vui lòng nhập tên danh mục!',
    cat_confirm_delete: 'Bạn có chắc muốn xóa danh mục tùy chỉnh này?'
  },
  en: {
    // App & Header
    app_subtitle: 'Personal Task & Finance Assistant',
    hero_btn_notes: 'Notes',
    hero_btn_jobs: 'Tasks',
    hero_btn_finance: 'Finance',
    hero_spending_title: 'TOTAL SPENDING IN {year}',
    hero_spending_metric: 'Spent {year} 🪙',
    hero_safe_title: 'All tasks and documents are under control!',
    hero_safe_badge: 'Safe',
    hero_btn_add: '+ Add New',
    hero_btn_detail: 'Details',
    hero_btn_done: 'Done',

    // Top metrics
    metric_urgent: 'Urgent / Due',
    metric_soon: 'Upcoming',
    safe_badge: 'Safe',

    // Search & Tabs
    search_placeholder: 'Search by task name, provider, notes...',
    cat_all: '🌟 All',
    cat_vehicle: '🚗 Vehicles',
    cat_home: '🏠 Home & Living',
    cat_identity: '🪪 Documents',
    cat_tech: '💻 Technology',
    tab_pending: 'Pending Tasks',
    tab_history: 'Completed',
    tab_notes: 'Notes',

    // Empty states
    empty_jobs_title: 'No tasks found',
    empty_jobs_desc: 'No pending tasks found. Tap add new below so you never miss an important deadline.',
    empty_jobs_btn: '+ Add First Task',
    history_empty_title: 'No maintenance history saved yet',
    history_empty_desc: 'When you tap "✓ Done" on a task, history and itemized costs will be preserved here.',
    notes_empty_title: 'No notes yet',
    notes_empty_desc: 'Tap below to create your first note',

    // Job Card & Details
    due_label: 'Due:',
    months_per_cycle: 'mos/cycle',
    btn_edit: 'Edit',
    btn_done: 'Done',
    btn_delete: 'Delete',
    btn_close: 'Close',
    btn_save: 'Save Changes',
    has_photo: '📷 Photos',
    sub_items_count: '{count} items',
    alarm_on_title: 'Phone ringtone: ON (Tap to mute)',
    alarm_off_title: 'Phone ringtone: OFF (Tap to enable)',

    // Status badges
    status_overdue: '{days} days overdue',
    status_today: 'Due today!',
    status_due_in: 'Due in {days} days',
    status_days_left: '{days} days left',
    status_no_due: 'No due date',
    not_set: 'Not set',

    // Categories
    cat_vehicle_name: 'Vehicles',
    cat_home_name: 'Home & Living',
    cat_identity_name: 'Documents',
    cat_tech_name: 'Technology',
    cat_other_name: 'Other',

    // Notes View
    notes_quick_add: '+ Write a quick note...',
    notes_pinned_header: 'Pinned',
    notes_all_header: 'All Notes',
    note_modal_new: 'New Note',
    note_modal_edit: 'Edit Note',
    note_title_label: 'Note Title',
    note_title_placeholder: 'e.g. Home Wi-Fi password, Prescription, Idea...',
    note_content_label: 'Detailed Content',
    note_content_placeholder: 'Type your note content here...',
    note_color_label: 'Note Card Color',
    note_pin_checkbox: 'Pin this note to the top',
    note_alarm_switch: 'Enable alarm reminder for this note',
    note_alarm_date: 'Due Date',
    note_alarm_time: 'Due Time',
    note_alarm_phone: 'Ring & Phone Vibrate',

    // Bottom Dock
    dock_home: 'Home',
    dock_help: 'Help',
    dock_new_title: 'Quick Action Menu',
    dock_finance: 'Finance',
    dock_backup: 'Backup',

    // Quick Action Modal
    quick_action_title: 'Quick Actions',
    quick_action_subtitle: 'Choose what you want to do next',
    quick_action_note: 'New Note',
    quick_action_note_desc: 'Quick memo, passwords, ideas, custom alarms...',
    quick_action_job: 'Add Reminder',
    quick_action_job_desc: 'Oil change, insurance, vehicle inspection, maintenance...',
    quick_action_tx: 'Record Finance',
    quick_action_tx_desc: 'Daily living expenses, income, utility bills...',
    quick_action_open: 'Open',

    // Notification Center
    notif_center_title: 'Notification Center',
    notif_center_subtitle: 'All due tasks & important notes in one place',
    notif_btn_test: '🔔 Test Ringtone',
    notif_tab_all: 'All',
    notif_tab_overdue: '🚨 Overdue',
    notif_tab_today: '⚠️ Today',
    notif_tab_notes: '📝 Notes',
    notif_empty_title: 'No pending notifications!',
    notif_empty_desc: 'All tasks, documents, and notes are up to date and in control.',
    notif_item_count: '{total} items',
    notif_summary: '{total} items requiring attention ({overdue} overdue, {today} today)',
    notif_personal_note: 'Personal Note',
    notif_open: 'Open',
    notif_view: 'View',

    // Settings Modal
    settings_title: 'Settings & Account',
    settings_secured: 'Secured Account',
    settings_logout: 'Sign Out',
    settings_lang_title: 'Display Language',
    settings_lang_desc: 'Select display language for LifeKeep',
    settings_tools_title: 'Tools & Utilities',
    settings_test_sound: 'Test Sound & Vibration',
    settings_manage_cats: 'Manage Categories & Templates',
    settings_export_csv: 'Export Financial Report (CSV)',
    settings_backup_title: 'Backup & Restore Data',
    settings_backup_export: 'Export Backup (JSON)',
    settings_backup_import: 'Restore Data (JSON)',
    settings_privacy_title: 'Privacy & Offline Data',
    settings_privacy_desc: 'All your data is securely stored 100% in device storage (IndexedDB). Multi-account support works seamlessly offline and online.',

    // Home Finance Golden Card
    home_fin_title: 'Personal Finance',
    home_fin_badge: 'Initial Balance',
    home_fin_desc: 'Track cashflow & spending from initial balance',
    home_fin_btn_edit: 'Initial Balance',
    home_fin_starting_label: '🏦 Initial Balance:',
    home_fin_starting_unset: '(Initial balance not set)',
    home_fin_starting_init: 'Starting Capital',
    home_fin_avail_label: '💵 Available:',
    home_fin_avail_sub: '(Base + In - Out)',
    home_fin_spent_origin: 'Spent from initial balance:',
    home_fin_origin_remain: 'Initial capital left: {amount}',
    home_fin_origin_over: 'Depleted initial balance & deficit: {amount}',
    home_fin_click_set: 'Tap "Initial Balance" to configure',
    home_fin_open_book: 'Open Ledger',

    // Finance Modal Header & Overview
    fin_header_title: 'Personal Finance Manager',
    fin_header_desc: 'Track Initial Balance, Income & Expenses',
    fin_btn_export_excel: 'Export Excel',
    fin_btn_record_tx: '+ Add Transaction',
    fin_sb_title: 'Starting Balance When First Entered',
    fin_sb_desc: 'Baseline to track how much of your original money has been spent',
    fin_sb_edit_btn: 'Edit Initial Balance',
    fin_sb_label: '🏦 Initial Balance:',
    fin_sb_hint: '(Starting capital)',
    fin_avail_label: '💵 Available:',
    fin_avail_hint: '(Base + In - Out)',
    fin_spent_origin_label: 'Spent from initial balance:',
    fin_income_added: 'Total added income: +{amount}',

    // Finance Period Tabs
    fin_tab_week: 'Week',
    fin_tab_month: 'Month',
    fin_tab_year: 'Year',
    fin_tab_custom: 'Custom',
    fin_tab_all: 'All',
    fin_period_label: 'Period:',
    fin_period_year_report: 'Annual Report:',
    fin_period_current_week: 'Current Week:',
    fin_period_all_time: 'All Time History',
    fin_period_from: 'From:',
    fin_period_to: 'To:',

    // Monthly Budget Card
    fin_budget_title: 'Monthly Budget Limit',
    fin_budget_subtitle: 'Keep your spending under control',
    fin_budget_btn_set: 'Set Budget',
    fin_budget_btn_edit: 'Edit Budget',
    fin_budget_limit_label: 'Budget Limit:',
    fin_budget_spent_label: 'Spent:',
    fin_budget_remain_label: 'Remaining:',
    fin_budget_over_label: 'Over Budget:',

    // KPI Cards
    fin_kpi_income: '🟢 Total Income:',
    fin_kpi_expense: '🔴 Total Expense:',
    fin_kpi_expense_sub: 'Daily Living + Maintenance',
    fin_kpi_net: '💰 Net Cashflow (Income - Expense):',
    fin_kpi_income_count: '{count} incomes in period',
    fin_savings_rate: 'Saved: {rate}% of income',
    fin_deficit_rate: 'Deficit: {rate}%',
    fin_no_income_yet: 'No income recorded yet',

    // Breakdown Card
    fin_breakdown_title: '📊 Expense Structure Breakdown:',
    fin_breakdown_daily: 'Daily Living:',
    fin_breakdown_maint: 'Tasks / Vehicles:',

    // Charts & Feed
    fin_chart_trend: 'Income vs Expense Trends',
    fin_legend_income: 'Income',
    fin_legend_expense: 'Expense',
    fin_chart_doughnut: 'Expense Category Breakdown',
    fin_feed_title: 'Transaction History',
    fin_feed_new: '+ New Entry',
    fin_filter_all: 'All',
    fin_filter_income: '🟢 Income',
    fin_filter_daily: '🔴 Daily Living',
    fin_filter_maint: '🔧 Task Costs',
    fin_feed_empty_title: 'No transactions found in this filter',
    fin_feed_empty_desc: 'Tap "+ Add Transaction" above to log your first record.',
    fin_footer_add: 'Add New Income / Expense',

    // Transaction Modal
    tx_modal_title: 'Record Income / Expense',
    tx_modal_edit_title: 'Edit Transaction',
    tx_type_label: 'Transaction Type',
    tx_type_expense: '🔴 Expense',
    tx_type_income: '🟢 Income',
    tx_amount_label: 'Amount (₫)',
    tx_amount_placeholder: 'e.g. 150.000',
    tx_cat_label: 'Category',
    tx_manage_cat: '⚙️ Manage Categories',
    tx_date_label: 'Date',
    tx_notes_label: 'Notes & Description',
    tx_notes_placeholder: 'e.g. Lunch with team, Groceries...',
    tx_submit_btn: 'Save Transaction',

    // Starting Balance Modal
    sb_modal_title: 'Set Initial Starting Balance',
    sb_modal_subtitle: 'Track spending against your initial capital',
    sb_modal_desc: '💡 <strong>Starting Balance</strong> is the total money you had when you began using LifeKeep. From this amount, the app calculates <strong>what percentage you have spent</strong> and <strong>how much original money remains</strong>.',
    sb_input_label: 'Enter Initial Starting Balance (₫):',
    sb_quick_suggestions: '⚡ Quick amount suggestions:',
    sb_save_btn: 'Save Starting Balance',
    sb_cancel_btn: 'Cancel',

    // Budget Modal
    budget_modal_title: 'Set Monthly Budget Limit',
    budget_applied_month: 'Target Month',
    budget_max_limit_label: 'Maximum Spending Limit (₫)',
    budget_default_checkbox: 'Set as default budget for all future months',
    budget_save_btn: 'Save Budget Limit',
    budget_delete_btn: 'Delete',

    // Category Modal
    cat_modal_title: 'Manage Categories',
    cat_tab_expense: 'Expense',
    cat_tab_income: 'Income',
    cat_default_badge: 'Default',
    cat_btn_add: '+ Add Category',
    cat_add_section: '+ Add new category:',
    cat_name_placeholder: 'Category name...',
    cat_select_icon: 'Select icon:',
    cat_btn_add_action: '+ Add this category',
    cat_expense_heading: 'Expense Categories:',
    cat_income_heading: 'Income Categories:',

    // Unit & Quick Chips
    unit_million: 'M',
    quick_amount_suggestions: '⚡ Quick amount suggestions:',
    budget_placeholder: 'e.g. 15,000,000',
    budget_delete_title: 'Delete budget for this month',
    sb_input_placeholder: 'e.g. 10,000,000',

    // Excel Export Modal
    export_csv_modal_title: 'Export Excel Report (CSV)',
    export_csv_desc: 'Export format is <strong>standard UTF-8 BOM CSV</strong>, opens directly in Microsoft Excel or Google Sheets without encoding issues, ready for calculations.',
    export_csv_period_title: 'Export Current Period Finance',
    export_csv_period_desc: 'Transactions within currently selected filter period only',
    export_csv_all_title: 'Export All Finance & Maintenance',
    export_csv_all_desc: 'Complete history of income, expense, and task maintenance costs',
    export_csv_maint_title: 'Export Maintenance & Document Logs',
    export_csv_maint_desc: 'Includes service date, garage/provider, and itemized sub-costs',

    // Finance Toasts & Dialogs
    toast_save_tx_success: '💰 Transaction saved successfully!',
    toast_delete_tx_success: '🗑️ Transaction deleted!',
    toast_save_budget_success: '🎯 Budget limit saved: {amount}',
    toast_clear_budget_success: '🗑️ Budget limit cleared for this month!',
    toast_save_sb_success: '✅ Initial balance saved: {amount}',
    toast_add_cat_success: '🏷️ New category added!',
    toast_delete_cat_success: '🗑️ Category deleted!',
    tx_confirm_delete: 'Are you sure you want to delete this transaction?',
    tx_alert_invalid_amount: 'Please enter a valid amount!',
    budget_alert_invalid_amount: 'Please enter a valid budget amount!',
    cat_alert_empty_name: 'Please enter a category name!',
    cat_confirm_delete: 'Are you sure you want to delete this custom category?'
  }
};

// Main App Controller
class LifeKeepApp {
  constructor() {
    this.storage = new StorageManager();
    this.currentLang = localStorage.getItem('lifekeep_lang') || 'vi';
    this.items = [];
    this.allLogs = [];
    this.customTemplates = [];
    this.transactions = [];
    this.customCategories = [];
    this.currentCategory = 'all';
    this.currentViewTab = 'pending'; // 'pending', 'history', 'notes'
    this.currentNotifFilter = 'all'; // 'all', 'overdue', 'today', 'notes'
    this.searchQuery = '';
    this.selectedItem = null;
    this.notes = [];
    this.selectedNoteColor = 'amber';
    this.editingNoteId = null;
    this.currentPhotoBase64 = null;
    this.completePhotoBase64 = null;
    this.currentViewingPhotoData = null;
    this.currentViewingPhotoTitle = '';
    this.currentViewingLog = null;
    this.doughnutChart = null;
    this.barChart = null;

    // Financial Module State
    this.financePeriod = 'month'; // 'week', 'month', 'year', 'custom', 'all'
    this.financeSelectedMonth = new Date().getMonth() + 1;
    this.financeSelectedYear = new Date().getFullYear();
    this.financeCustomStartDate = '';
    this.financeCustomEndDate = '';
    this.txFeedFilter = 'all'; // 'all', 'income', 'daily', 'maint'
    this.txFormType = 'expense'; // 'income' or 'expense'
    this.editingTxId = null;
    this.financeComparisonChart = null;
    this.financeDoughnutChart = null;

    // Hero Selected Year
    this.heroSelectedYear = parseInt(localStorage.getItem('lifekeep_hero_year')) || new Date().getFullYear();

    // Authentication State
    this.authMode = 'login'; // 'login' or 'register'
    this.currentUser = null;

    // Photo Viewer Zoom & Pan state
    this.photoZoomScale = 1;
    this.photoPanX = 0;
    this.photoPanY = 0;
    this.isPhotoPanning = false;
    this.photoPanStartX = 0;
    this.photoPanStartY = 0;
    this.initialPinchDistance = 0;
    this.initialPinchScale = 1;

    // Double submission guards
    this._isSavingItem = false;
    this._isSavingComplete = false;
    this._isSavingTx = false;
    this._isSavingNote = false;

    // AudioContext reference for phone chime
    this.audioCtx = null;

    // In-app alert tracking to prevent repeat chimes in same session/day
    this.alertedItemMap = new Set();
  }

  // ================= INTERNATIONALIZATION (i18n) =================

  t(key, params = {}) {
    const langDict = I18N[this.currentLang] || I18N['vi'];
    let text = langDict[key] || (I18N['vi'] && I18N['vi'][key]) || key || '';
    if (text && typeof text === 'string') {
      Object.keys(params).forEach(k => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
      });
    }
    return text;
  }

  setLanguage(lang) {
    if (lang !== 'vi' && lang !== 'en') lang = 'vi';
    this.currentLang = lang;
    try {
      localStorage.setItem('lifekeep_lang', lang);
    } catch (e) {}
    this.applyLanguage();
    this.showToast(this.currentLang === 'en' ? '✅ Switched language to English' : '✅ Đã chuyển sang Tiếng Việt');
  }

  toggleLanguage() {
    const nextLang = this.currentLang === 'vi' ? 'en' : 'vi';
    this.setLanguage(nextLang);
  }

  applyLanguage() {
    const isEn = this.currentLang === 'en';

    // 1. Update Header Button
    const flagEl = document.getElementById('header-lang-flag');
    const codeEl = document.getElementById('header-lang-code');
    if (flagEl) flagEl.textContent = isEn ? '🇬🇧' : '🇻🇳';
    if (codeEl) codeEl.textContent = isEn ? 'EN' : 'VI';

    // 2. Update Settings Modal Buttons
    const btnVi = document.getElementById('btn-lang-vi');
    const btnEn = document.getElementById('btn-lang-en');
    const activeClass = 'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer bg-purple-600 text-white shadow-xs';
    const inactiveClass = 'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer text-slate-600 hover:text-slate-900 hover:bg-slate-100';
    if (btnVi) btnVi.className = !isEn ? activeClass : inactiveClass;
    if (btnEn) btnEn.className = isEn ? activeClass : inactiveClass;

    // 3. Update DOM elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = this.t(key);
      if (val) el.textContent = val;
    });

    // 4. Update DOM elements with data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = this.t(key);
      if (val) el.placeholder = val;
    });

    // 5. Update DOM elements with data-i18n-title
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const val = this.t(key);
      if (val) el.title = val;
    });

    // 5b. Update DOM elements with data-i18n-html
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      const val = this.t(key);
      if (val) el.innerHTML = val;
    });

    // 6. Update user greeting
    this.updateUserUI();

    // 7. Refresh lists & counters if already loaded
    if (this.items && this.items.length !== undefined) {
      this.render();
      this.updateStartingBalanceDisplays();
      if (document.getElementById('finance-modal') && !document.getElementById('finance-modal').classList.contains('hidden')) {
        this.renderFinance();
      }
      if (document.getElementById('category-modal') && !document.getElementById('category-modal').classList.contains('hidden')) {
        this.renderCategoryLists();
      }
      const budgetModal = document.getElementById('budget-modal');
      if (budgetModal && !budgetModal.classList.contains('hidden')) {
        const monthDisplay = document.getElementById('budget-month-display');
        if (monthDisplay) {
          const targetYear = this.financeSelectedYear || new Date().getFullYear();
          const targetMonth = this.financeSelectedMonth || (new Date().getMonth() + 1);
          monthDisplay.textContent = isEn ? `Month ${targetMonth}/${targetYear}` : `Tháng ${targetMonth}/${targetYear}`;
        }
      }
    }
    this.updateNotificationBadge();
  }

  // ================= UTILITY & INPUT FORMATTERS =================

  showToast(message, type = 'success') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      document.body.appendChild(toast);
    }
    clearTimeout(this._toastTimer);
    clearTimeout(this._toastRemoveTimer);

    const bgClass = type === 'error' 
      ? 'bg-rose-50 text-rose-800 border-rose-300 shadow-xl shadow-rose-950/20' 
      : 'bg-white text-slate-800 border-purple-200 shadow-xl shadow-purple-950/25';
    
    toast.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2.5 rounded-2xl border text-xs font-bold shadow-2xl backdrop-blur-md flex items-center gap-2 transition-all duration-300 transform pointer-events-auto cursor-pointer ${bgClass}`;
    toast.innerHTML = `${message} <span class="text-[10px] text-slate-400 hover:text-slate-700 ml-1">✕</span>`;
    
    // Explicit inline styles to guarantee instantaneous visibility and dismiss animation
    toast.style.display = 'flex';
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, 0)';

    // Click to dismiss immediately
    toast.onclick = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, -16px)';
      this._toastRemoveTimer = setTimeout(() => {
        toast.style.display = 'none';
      }, 250);
    };

    // Auto dismiss after 2.2 seconds
    this._toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, -16px)';
      this._toastRemoveTimer = setTimeout(() => {
        toast.style.display = 'none';
      }, 300);
    }, 2200);
  }

  // Format currency with distinct dot (.) thousand separators (e.g. 150000 -> 150.000)
  formatCurrencyInput(input) {
    if (!input) return;
    const originalValue = input.value || '';
    const cursor = input.selectionStart;
    const digitsBeforeCursor = (originalValue.slice(0, cursor).match(/\d/g) || []).length;

    // Only keep numeric digits
    const cleanDigits = originalValue.replace(/\D/g, '');
    if (!cleanDigits) {
      input.value = '';
      return;
    }

    // Format with dots as thousands separator: 150000 -> 150.000 (100% reliable across all browsers & OS)
    const formatted = cleanDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    input.value = formatted;

    // Reposition cursor smoothly
    let newCursor = 0;
    let countedDigits = 0;
    while (newCursor < formatted.length && countedDigits < digitsBeforeCursor) {
      if (/\d/.test(formatted[newCursor])) {
        countedDigits++;
      }
      newCursor++;
    }
    try {
      if (cursor !== null && cursor !== undefined) {
        input.setSelectionRange(newCursor, newCursor);
      }
    } catch (e) {}
  }

  parseMoneyInput(val) {
    if (val === null || val === undefined) return 0;
    const clean = String(val).replace(/\D/g, '');
    return clean ? parseInt(clean, 10) : 0;
  }

  formatMoneyString(val) {
    if (val === null || val === undefined || val === '') return '';
    const clean = String(val).replace(/\D/g, '');
    if (!clean) return '';
    return clean.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  setFormattedAmount(target, amount) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    if (amount === '' || amount === null || amount === undefined) {
      el.value = '';
    } else {
      el.value = this.formatMoneyString(amount);
    }
  }

  async forceUpdateApp() {
    this.showToast('🔄 Đang làm mới dữ liệu & theme...', 'success');
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let registration of registrations) {
          await registration.unregister();
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (let key of keys) {
          await caches.delete(key);
        }
      }
      localStorage.setItem('lifekeep_ui_version', 'v12');
    } catch (e) {
      console.error(e);
    }
    // Hard reload bypassing cache
    window.location.href = window.location.origin + window.location.pathname + '?v=' + Date.now();
  }

  getAccountKey(user) {
    if (!user) user = this.currentUser;
    if (user && user.email) {
      return 'user_' + user.email.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }
    return 'guest';
  }

  async switchUserAccount(user) {
    const accountKey = this.getAccountKey(user);
    this.storage.setAccount(accountKey);
    await this.storage.init();
    await this.storage.migrateLegacyDataIfNeeded(accountKey);

    // ONLY seed if account has never been seeded before!
    const isSeeded = (await this.storage.getSetting('has_initialized_seed')) || localStorage.getItem('lifekeep_seeded_' + accountKey);
    if (!isSeeded) {
      for (const item of INITIAL_SEED_ITEMS) {
        await this.storage.saveItem(item);
      }
      for (const log of INITIAL_SEED_LOGS) {
        await this.storage.saveLog(log);
      }
      for (const tx of INITIAL_SEED_TRANSACTIONS) {
        await this.storage.saveTransaction(tx);
      }
      localStorage.setItem('lifekeep_seeded_' + accountKey, 'true');
      await this.storage.saveSetting('has_initialized_seed', true);
    }

    await this.loadItems();
    this.customTemplates = await this.storage.getCustomTemplates();
    this.customCategories = await this.storage.getCustomCategories();
    await this.loadTransactions();
    await this.loadAllLogs();
    await this.render();
    await this.renderTemplates();
    this.updateUserUI();
  }

  // Auto-clean duplicate items & fake logs caused by dual-event submission bug
  async cleanupDuplicates() {
    try {
      const items = await this.storage.getAllItems();
      const seenItems = new Map();
      let hasItemChanges = false;
      for (const item of items) {
        if (!item || !item.name) continue;
        const key = `${item.name.trim().toLowerCase()}|${item.category}|${item.dueDate}`;
        if (!seenItems.has(key)) {
          seenItems.set(key, item);
        } else {
          const existing = seenItems.get(key);
          const t1 = parseInt((item.id || '').replace(/\D/g, ''), 10) || 0;
          const t2 = parseInt((existing.id || '').replace(/\D/g, ''), 10) || 0;
          // Duplicate created within 20s or exact duplicate
          if (Math.abs(t1 - t2) < 20000 || item.id === existing.id + '-dup' || !item.id.includes('-')) {
            console.log('LifeKeep auto-cleaning duplicate item:', item.id, item.name);
            await this.storage.deleteItem(item.id);
            hasItemChanges = true;
          }
        }
      }

      const logs = await this.storage.getAllLogs();
      const seenLogs = new Map();
      let hasLogChanges = false;
      for (const log of logs) {
        if (!log) continue;
        // Clean up bogus uncompleted logs auto-created by previous bug
        if (log.notes === 'Chi phí đã nhập khi tạo/sửa mục') {
          console.log('LifeKeep auto-cleaning bogus uncompleted log:', log.id, log.itemName);
          await this.storage.deleteLog(log.id);
          hasLogChanges = true;
          continue;
        }

        // Clean up duplicate completed logs
        const key = `${log.itemId || log.itemName}|${log.date}|${log.totalCost}`;
        if (!seenLogs.has(key)) {
          seenLogs.set(key, log);
        } else {
          const existing = seenLogs.get(key);
          const t1 = parseInt((log.id || '').replace(/\D/g, ''), 10) || 0;
          const t2 = parseInt((existing.id || '').replace(/\D/g, ''), 10) || 0;
          if (Math.abs(t1 - t2) < 20000) {
            console.log('LifeKeep auto-cleaning duplicate log:', log.id, log.itemName);
            await this.storage.deleteLog(log.id);
            hasLogChanges = true;
          }
        }
      }

      if (hasItemChanges) await this.loadItems();
      if (hasLogChanges) await this.loadAllLogs();
      return { hasItemChanges, hasLogChanges };
    } catch (e) {
      console.warn('cleanupDuplicates warning:', e);
      return { hasItemChanges: false, hasLogChanges: false };
    }
  }

  async start() {
    // Auto-clean stale service worker cache if upgraded to v29
    try {
      const currentUiVersion = localStorage.getItem('lifekeep_ui_version');
      if (currentUiVersion !== 'v29') {
        localStorage.setItem('lifekeep_ui_version', 'v29');
        if ('caches' in window) {
          caches.keys().then(keys => {
            keys.forEach(k => {
              if (k !== 'lifekeep-v29') caches.delete(k);
            });
          });
        }
      }
    } catch (e) {}

    this.initEventListeners();
    this.initAuth();
    try {
      const accountKey = this.getAccountKey(this.currentUser);
      this.storage.setAccount(accountKey);
      await this.storage.init();
      await this.storage.migrateLegacyDataIfNeeded(accountKey);

      // Check seed status: ONLY seed if account has never been seeded before!
      // If user deleted items, isSeeded is true so they NEVER resurrect on F5!
      const isSeeded = (await this.storage.getSetting('has_initialized_seed')) || localStorage.getItem('lifekeep_seeded_' + accountKey);
      if (!isSeeded) {
        for (const item of INITIAL_SEED_ITEMS) {
          await this.storage.saveItem(item);
        }
        for (const log of INITIAL_SEED_LOGS) {
          await this.storage.saveLog(log);
        }
        for (const tx of INITIAL_SEED_TRANSACTIONS) {
          await this.storage.saveTransaction(tx);
        }
        localStorage.setItem('lifekeep_seeded_' + accountKey, 'true');
        await this.storage.saveSetting('has_initialized_seed', true);
      }

      await this.loadItems();
      this.customTemplates = await this.storage.getCustomTemplates();
      this.customCategories = await this.storage.getCustomCategories();

      // Auto-sync items that lack subItems or cost from initial seeds or logs
      let itemsUpdated = false;
      for (const item of this.items) {
        if (!item.subItems || item.subItems.length === 0 || !item.cost) {
          const seedItem = INITIAL_SEED_ITEMS.find(s => s.id === item.id);
          const log = INITIAL_SEED_LOGS.find(l => l.itemId === item.id);
          if (seedItem && seedItem.subItems) {
            item.subItems = seedItem.subItems;
            item.cost = seedItem.cost;
            await this.storage.saveItem(item);
            itemsUpdated = true;
          } else if (log && log.subItems) {
            item.subItems = log.subItems;
            item.cost = log.totalCost || log.cost;
            await this.storage.saveItem(item);
            itemsUpdated = true;
          }
        }
      }
      if (itemsUpdated) {
        await this.loadItems();
      }

      await this.loadTransactions();
      await this.loadAllLogs();
      await this.loadNotes();

      // Clean up any historical duplicate items or fake logs from earlier bug
      await this.cleanupDuplicates();

      this.applyLanguage();
      await this.render();
      await this.renderTemplates();
      this.setInstallTargetUrl(this.getSuggestedLocalUrl());

      // Show notification banner if user hasn't granted permission yet
      if ('Notification' in window && Notification.permission === 'default') {
        const notifBanner = document.getElementById('notif-permission-banner');
        if (notifBanner) notifBanner.classList.remove('hidden');
      }

      this.checkNotificationsOnStartup();
      this.startNotificationHeartbeat();
    } catch (err) {
      console.error('Lỗi khởi động LifeKeep:', err);
      try {
        await this.render();
      } catch (renderErr) {
        console.error('Lỗi render fallback:', renderErr);
      }
    }
  }

  async loadItems() {
    this.items = await this.storage.getAllItems();
  }

  async loadTransactions() {
    this.transactions = await this.storage.getAllTransactions();
  }

  async loadAllLogs() {
    this.allLogs = await this.storage.getAllLogs();
    this.allLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async loadNotes() {
    this.notes = await this.storage.getAllNotes();
    this.notes.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    });
  }

  // ================= NOTIFICATIONS, PHONE ALARM CHIME & VIBRATION =================

  // Global AudioContext initializer & unlocker
  initAudioContext() {
    try {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.audioCtx = new AudioCtx();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }
  }

  // Synthesize pleasant ringing chime sound using pure Web Audio API
  playAlarmSound() {
    try {
      this.initAudioContext();
      const ctx = this.audioCtx;
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const now = ctx.currentTime;
      
      // Dual-burst clear melodic chime ringtone:
      // Burst 1: D5 (587.33Hz) -> A5 (880Hz) -> D6 (1174.66Hz)
      // Burst 2: D5 (587.33Hz) -> A5 (880Hz) -> D6 (1174.66Hz)
      const notes = [
        { freq: 587.33, start: 0, dur: 0.20 },
        { freq: 880.00, start: 0.16, dur: 0.28 },
        { freq: 1174.66, start: 0.32, dur: 0.50 },
        { freq: 587.33, start: 0.65, dur: 0.20 },
        { freq: 880.00, start: 0.81, dur: 0.28 },
        { freq: 1174.66, start: 0.97, dur: 0.65 }
      ];

      notes.forEach(n => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, now + n.start);
        gain.gain.setValueAtTime(0.4, now + n.start);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur);
      });
    } catch (e) {
      console.log('Audio playback error:', e);
    }
  }

  // Vibrate physical phone device (supports mobile Android / PWA vibration API)
  triggerPhoneVibration(pattern = [400, 150, 400, 150, 600, 200, 600]) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  }

  // Dispatch full phone notification (Device Ringtone + Vibration + Lockscreen / Heads-up Banner)
  async showPhoneNotification(title, body, tag = 'lifekeep-alert') {
    this.playAlarmSound();
    this.triggerPhoneVibration();

    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const notifOptions = {
      body,
      icon: './logo.png',
      badge: './icon-192.png',
      tag: tag || 'lifekeep-alert',
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 150, 400, 150, 600, 200, 600],
      data: { url: './index.html' }
    };

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, notifOptions);
          return;
        }
      } catch (e) {
        console.warn('SW showNotification error:', e);
      }
    }

    try {
      new Notification(title, notifOptions);
    } catch (e) {}
  }

  // In-app visual notification alert banner
  showInAppAlarmAlert(item, isOverdue) {
    const bannerId = 'alarm-banner-' + item.id;
    if (document.getElementById(bannerId)) return;

    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.className = 'fixed top-4 left-4 right-4 max-w-md mx-auto z-[999] bg-gradient-to-r from-purple-700 via-indigo-700 to-purple-800 text-white rounded-2xl p-4 shadow-2xl border-2 border-purple-400 flex items-start gap-3 animate-bounce';
    banner.innerHTML = `
      <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl shrink-0">
        ${isOverdue ? '🚨' : '⏰'}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[11px] font-bold uppercase tracking-wider text-purple-200">
          ${isOverdue ? 'Nhắc việc đã quá hạn!' : 'Nhắc việc đến hạn!'}
        </div>
        <div class="font-black text-sm text-white truncate">${this.escapeHtml(item.name)}</div>
        <div class="text-xs text-purple-200 mt-0.5">
          ${isOverdue ? 'Hạn chót: ' + this.formatDateVN(item.dueDate) : 'Hôm nay lúc ' + (item.dueTime || '08:00')}
          ${item.provider ? ' • ' + this.escapeHtml(item.provider) : ''}
        </div>
        <div class="flex items-center gap-2 mt-2">
          <button onclick="app.showItemDetail('${item.id}'); document.getElementById('${bannerId}').remove();" class="px-3 py-1 bg-white text-purple-800 font-bold rounded-lg text-xs shadow hover:bg-purple-50 cursor-pointer">
            Xem chi tiết
          </button>
          <button onclick="document.getElementById('${bannerId}').remove();" class="px-2.5 py-1 bg-white/20 hover:bg-white/30 text-white font-medium rounded-lg text-xs cursor-pointer">
            Đã hiểu
          </button>
        </div>
      </div>
      <button onclick="document.getElementById('${bannerId}').remove();" class="text-white/70 hover:text-white p-1 text-base cursor-pointer">✕</button>
    `;
    document.body.appendChild(banner);
    setTimeout(() => {
      if (document.getElementById(bannerId)) {
        banner.classList.remove('animate-bounce');
      }
    }, 4000);
  }

  // Heartbeat timer checking every 30s for tasks due at current exact phone time
  startNotificationHeartbeat() {
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
    // Run immediately on start
    this.checkDueAlarms();
    this._heartbeatInterval = setInterval(() => {
      this.checkDueAlarms();
    }, 30000);
  }

  checkDueAlarms() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    this.items.forEach(item => {
      // Respect user's choice: only alert if notifyPhone is not disabled
      if (item.notifyPhone === false) return;
      if (!item.dueDate) return;

      const targetTime = item.dueTime || '08:00';
      const [tH, tM] = targetTime.split(':').map(n => parseInt(n, 10) || 0);
      const targetMinutes = tH * 60 + tM;

      // Item is due today at or after targetTime, OR already overdue
      const isDueTodayAndPassedTime = (item.dueDate === todayStr && currentMinutes >= targetMinutes);
      const isOverdue = (item.dueDate < todayStr);

      if (isDueTodayAndPassedTime || isOverdue) {
        // Daily alert key so it rings once per day for each due/overdue item
        const alertKey = `lifekeep_alerted_${item.id}_${todayStr}`;
        const alreadyAlerted = localStorage.getItem(alertKey);

        if (!alreadyAlerted) {
          localStorage.setItem(alertKey, new Date().toISOString());
          this.alertedItemMap.add(`${item.id}-${todayStr}`);

          const prefix = isOverdue ? '🚨 [QUÁ HẠN]' : '⏰ [ĐẾN HẠN]';
          const dueDesc = isOverdue
            ? `Đã quá hạn từ ngày ${this.formatDateVN(item.dueDate)}!`
            : `Hôm nay lúc ${targetTime}: ${item.name}`;

          this.showPhoneNotification(
            `${prefix} LifeKeep: ${item.name}`,
            `${dueDesc}. ${item.provider ? 'Nơi làm: ' + item.provider : 'Vui lòng kiểm tra và xử lý ngay.'}`,
            `due-${item.id}`
          );

          this.showInAppAlarmAlert(item, isOverdue);
        }
      }
    });

    // Check due alarms for Notes with reminders
    if (this.notes && this.notes.length > 0) {
      this.notes.forEach(note => {
        if (!note.hasReminder || note.notifyPhone === false || !note.dueDate) return;

        const targetTime = note.dueTime || '08:00';
        const [tH, tM] = targetTime.split(':').map(n => parseInt(n, 10) || 0);
        const targetMinutes = tH * 60 + tM;

        const isDueTodayAndPassedTime = (note.dueDate === todayStr && currentMinutes >= targetMinutes);
        const isOverdue = (note.dueDate < todayStr);

        if (isDueTodayAndPassedTime || isOverdue) {
          const alertKey = `lifekeep_alerted_note_${note.id}_${todayStr}`;
          const alreadyAlerted = localStorage.getItem(alertKey);

          if (!alreadyAlerted) {
            localStorage.setItem(alertKey, new Date().toISOString());
            this.alertedItemMap.add(`note-${note.id}-${todayStr}`);

            const prefix = isOverdue ? '🚨 [GHI CHÚ QUÁ HẠN]' : '⏰ [NHẮC GHI CHÚ]';
            const dueDesc = isOverdue
              ? `Ghi chú đã quá hạn từ ngày ${this.formatDateVN(note.dueDate)}!`
              : `Lúc ${targetTime} hôm nay: ${note.title || 'Ghi chú'}`;

            this.showPhoneNotification(
              `${prefix} ${note.title || 'Ghi chú LifeKeep'}`,
              `${dueDesc}. ${(note.content || '').slice(0, 100)}`,
              `due-note-${note.id}`
            );

            this.showInAppNoteAlarmAlert(note, isOverdue);
          }
        }
      });
    }

    this.updateNotificationBadge();
  }

  // In-app visual notification alert banner for notes
  showInAppNoteAlarmAlert(note, isOverdue) {
    const bannerId = 'alarm-banner-note-' + note.id;
    if (document.getElementById(bannerId)) return;

    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.className = 'fixed top-4 left-4 right-4 max-w-md mx-auto z-[999] bg-gradient-to-r from-amber-600 via-yellow-600 to-amber-700 text-white rounded-2xl p-4 shadow-2xl border-2 border-amber-300 flex items-start gap-3 animate-bounce';
    banner.innerHTML = `
      <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl shrink-0">
        📝
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[11px] font-bold uppercase tracking-wider text-amber-200">
          ${isOverdue ? 'Ghi chú đã quá hạn!' : 'Đến giờ hẹn ghi chú!'}
        </div>
        <div class="font-black text-sm text-white truncate">${this.escapeHtml(note.title || 'Ghi chú')}</div>
        <div class="text-xs text-amber-100 mt-0.5 line-clamp-2">
          ${this.escapeHtml(note.content || '')}
        </div>
        <div class="flex items-center gap-2 mt-2">
          <button onclick="app.openNoteModalById('${note.id}'); document.getElementById('${bannerId}').remove();" class="px-3 py-1 bg-white text-amber-900 font-bold rounded-lg text-xs shadow hover:bg-amber-50 cursor-pointer">
            Mở ghi chú
          </button>
          <button onclick="document.getElementById('${bannerId}').remove();" class="px-2.5 py-1 bg-white/20 hover:bg-white/30 text-white font-medium rounded-lg text-xs cursor-pointer">
            Đã hiểu
          </button>
        </div>
      </div>
      <button onclick="document.getElementById('${bannerId}').remove();" class="text-white/70 hover:text-white p-1 text-base cursor-pointer">✕</button>
    `;
    document.body.appendChild(banner);
    setTimeout(() => {
      if (document.getElementById(bannerId)) {
        banner.classList.remove('animate-bounce');
      }
    }, 4000);
  }

  // Check and display phone notification on app startup
  async checkNotificationsOnStartup() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      const now = new Date();
      const todayStr = now.toLocaleDateString('en-CA');
      const urgentItems = this.items.filter(item => {
        const { status, days } = this.calculateStatus(item.dueDate);
        return days <= 3 && days >= 0;
      });

      if (urgentItems.length > 0) {
        const title = `LifeKeep: Có ${urgentItems.length} việc cần chú ý hôm nay!`;
        const body = urgentItems.map(i => `• ${i.name} (Hạn: ${this.formatDateVN(i.dueDate)}${i.dueTime ? ' ' + i.dueTime : ''})`).join('\n');
        this.showPhoneNotification(title, body, 'startup-reminder');
      }
    }
  }

  async requestNotificationPermission() {
    this.initAudioContext();
    this.playAlarmSound();
    this.triggerPhoneVibration();

    if (!('Notification' in window)) {
      this.showToast('ℹ️ Trình duyệt chưa hỗ trợ thông báo Web Notification.');
      return;
    }

    if (Notification.permission !== 'granted') {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          await this.showPhoneNotification('🔔 LifeKeep', 'Đã bật chuông thông báo & nhận diện chuông của thiết bị thành công!', 'test-alert');
          this.showToast('🔔 Đã bật chuông thông báo của máy!');
          const banner = document.getElementById('notif-permission-banner');
          if (banner) banner.classList.add('hidden');
        } else {
          this.showToast('⚠️ Bạn chưa cấp quyền thông báo trên thiết bị');
        }
      } catch (err) {
        console.warn('Request notification error:', err);
      }
    } else {
      await this.showPhoneNotification('🔔 LifeKeep', 'Chuông thông báo & rung thiết bị đang hoạt động bình thường!', 'test-alert');
      this.showToast('🔔 Chuông báo thiết bị đang hoạt động bình thường');
      const banner = document.getElementById('notif-permission-banner');
      if (banner) banner.classList.add('hidden');
    }
  }

  // ================= NOTIFICATION CENTER & BELL DROPDOWN =================

  getAllActiveNotifications() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueJobs = [];
    const todayJobs = [];
    const soonJobs = [];
    const overdueNotes = [];
    const todayNotes = [];
    const soonNotes = [];

    // 1. Process active jobs (items)
    if (this.items && this.items.length > 0) {
      this.items.forEach(item => {
        if (item.status === 'completed' || !item.dueDate) return;

        const due = new Date(item.dueDate);
        due.setHours(0, 0, 0, 0);
        const diffTime = due.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        const catMeta = this.getCategoryMeta(item.category);

        if (diffDays < 0) {
          overdueJobs.push({
            id: item.id,
            type: 'job',
            subType: 'overdue',
            title: item.name,
            dueDate: item.dueDate,
            dueTime: item.dueTime || '08:00',
            diffDays: diffDays,
            catMeta: catMeta,
            provider: item.provider,
            priority: 1,
            item: item
          });
        } else if (diffDays === 0) {
          todayJobs.push({
            id: item.id,
            type: 'job',
            subType: 'today',
            title: item.name,
            dueDate: item.dueDate,
            dueTime: item.dueTime || '08:00',
            diffDays: 0,
            catMeta: catMeta,
            provider: item.provider,
            priority: 2,
            item: item
          });
        } else if (diffDays <= (item.warningDays || 7)) {
          soonJobs.push({
            id: item.id,
            type: 'job',
            subType: 'soon',
            title: item.name,
            dueDate: item.dueDate,
            dueTime: item.dueTime || '08:00',
            diffDays: diffDays,
            catMeta: catMeta,
            provider: item.provider,
            priority: 3,
            item: item
          });
        }
      });
    }

    // 2. Process notes with reminders
    if (this.notes && this.notes.length > 0) {
      this.notes.forEach(note => {
        if (!note.hasReminder || !note.dueDate) return;

        const due = new Date(note.dueDate);
        due.setHours(0, 0, 0, 0);
        const diffTime = due.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          overdueNotes.push({
            id: note.id,
            type: 'note',
            subType: 'overdue',
            title: note.title || 'Ghi chú',
            content: note.content || '',
            dueDate: note.dueDate,
            dueTime: note.dueTime || '08:00',
            diffDays: diffDays,
            color: note.color,
            priority: 1,
            note: note
          });
        } else if (diffDays === 0) {
          todayNotes.push({
            id: note.id,
            type: 'note',
            subType: 'today',
            title: note.title || 'Ghi chú',
            content: note.content || '',
            dueDate: note.dueDate,
            dueTime: note.dueTime || '08:00',
            diffDays: 0,
            color: note.color,
            priority: 2,
            note: note
          });
        } else if (diffDays <= 7) {
          soonNotes.push({
            id: note.id,
            type: 'note',
            subType: 'soon',
            title: note.title || 'Ghi chú',
            content: note.content || '',
            dueDate: note.dueDate,
            dueTime: note.dueTime || '08:00',
            diffDays: diffDays,
            color: note.color,
            priority: 3,
            note: note
          });
        }
      });
    }

    // Sort: overdue (most overdue first: lowest diffDays), today, soon (closest first)
    overdueJobs.sort((a, b) => a.diffDays - b.diffDays);
    overdueNotes.sort((a, b) => a.diffDays - b.diffDays);
    soonJobs.sort((a, b) => a.diffDays - b.diffDays);
    soonNotes.sort((a, b) => a.diffDays - b.diffDays);

    const allOverdue = [...overdueJobs, ...overdueNotes];
    const allToday = [...todayJobs, ...todayNotes];
    const allSoon = [...soonJobs, ...soonNotes];
    const allNotes = [...overdueNotes, ...todayNotes, ...soonNotes];

    const all = [...allOverdue, ...allToday, ...allSoon];

    return {
      all,
      overdue: allOverdue,
      today: allToday,
      soon: allSoon,
      notes: allNotes
    };
  }

  updateNotificationBadge() {
    const data = this.getAllActiveNotifications();
    const total = data.all.length;

    const badge = document.getElementById('header-notification-badge');
    if (badge) {
      if (total > 0) {
        badge.classList.remove('hidden');
        badge.textContent = total > 99 ? '99+' : total;
        if (data.overdue.length > 0) {
          badge.className = 'absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow-md border-2 border-purple-700 animate-pulse';
        } else {
          badge.className = 'absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow-md border-2 border-purple-700';
        }
      } else {
        badge.classList.add('hidden');
      }
    }

    const modalBadge = document.getElementById('notif-center-count-badge');
    if (modalBadge) {
      modalBadge.textContent = this.t('notif_item_count', { total });
      modalBadge.className = data.overdue.length > 0
        ? 'px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white shadow-xs'
        : 'px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white shadow-xs';
    }

    const cAll = document.getElementById('notif-count-all');
    const cOverdue = document.getElementById('notif-count-overdue');
    const cToday = document.getElementById('notif-count-today');
    const cNotes = document.getElementById('notif-count-notes');

    if (cAll) cAll.textContent = total;
    if (cOverdue) cOverdue.textContent = data.overdue.length;
    if (cToday) cToday.textContent = data.today.length;
    if (cNotes) cNotes.textContent = data.notes.length;

    const summary = document.getElementById('notif-footer-summary');
    if (summary) {
      summary.textContent = this.t('notif_summary', { total, overdue: data.overdue.length, today: data.today.length });
    }
  }

  toggleNotificationCenter(forceState) {
    const modal = document.getElementById('notification-center-modal');
    if (!modal) return;

    const isOpening = (forceState !== undefined) ? forceState : modal.classList.contains('hidden');

    if (isOpening) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      this.renderNotificationCenter();
    } else {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  setNotificationFilter(filter) {
    this.currentNotifFilter = filter || 'all';

    const filters = ['all', 'overdue', 'today', 'notes'];
    const activeClass = 'px-3 py-1 rounded-full bg-purple-600 text-white font-bold shrink-0 transition text-[11px] cursor-pointer shadow-xs';
    const inactiveClass = 'px-3 py-1 rounded-full bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 font-semibold shrink-0 transition text-[11px] cursor-pointer';

    filters.forEach(f => {
      const btn = document.getElementById(`notif-filter-${f}`);
      if (btn) {
        btn.className = (this.currentNotifFilter === f) ? activeClass : inactiveClass;
      }
    });

    this.renderNotificationCenterList();
  }

  renderNotificationCenter() {
    this.updateNotificationBadge();
    this.renderNotificationCenterList();
  }

  renderNotificationCenterList() {
    const container = document.getElementById('notification-center-list');
    if (!container) return;

    const data = this.getAllActiveNotifications();
    let list = [];

    if (this.currentNotifFilter === 'overdue') {
      list = data.overdue;
    } else if (this.currentNotifFilter === 'today') {
      list = data.today;
    } else if (this.currentNotifFilter === 'notes') {
      list = data.notes;
    } else {
      list = data.all;
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div class="py-12 px-4 text-center">
          <div class="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center text-3xl mx-auto shadow-sm mb-3">
            🎉
          </div>
          <h4 class="font-black text-slate-800 text-sm">${this.t('notif_empty_title')}</h4>
          <p class="text-xs text-slate-500 mt-1 max-w-xs mx-auto">${this.t('notif_empty_desc')}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(item => {
      if (item.type === 'note') {
        const isOverdue = item.subType === 'overdue';
        const isToday = item.subType === 'today';
        const badgeText = isOverdue
          ? this.t('status_overdue', { days: Math.abs(item.diffDays) })
          : (isToday ? this.t('status_today') : this.t('status_days_left', { days: item.diffDays }));
        const badgeClass = isOverdue
          ? 'bg-rose-100 text-rose-700 border-rose-200'
          : (isToday ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-indigo-100 text-indigo-700 border-indigo-200');

        return `
          <div onclick="app.handleNotificationItemClick('${item.id}', 'note')" class="p-3.5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200/90 hover:border-purple-300 shadow-xs hover:shadow-sm transition flex items-center justify-between gap-3 cursor-pointer group active:scale-[0.99]">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center text-lg shadow-sm shrink-0 group-hover:scale-105 transition">
                📝
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeClass}">
                    ${badgeText}
                  </span>
                  <span class="text-[10px] text-slate-400 font-medium">${this.t('notif_personal_note')}</span>
                </div>
                <h4 class="font-bold text-slate-900 text-sm truncate mt-1 group-hover:text-purple-700 transition">
                  ${this.escapeHtml(item.title)}
                </h4>
                <p class="text-xs text-slate-500 truncate mt-0.5">
                  ⏰ ${this.t('due_label')} ${this.formatDateVN(item.dueDate)} ${this.currentLang === 'en' ? 'at' : 'lúc'} ${item.dueTime}${item.content ? ' • ' + this.escapeHtml(item.content) : ''}
                </p>
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-1 text-slate-400 group-hover:text-purple-600 text-xs font-bold transition">
              <span class="hidden sm:inline">${this.t('notif_open')}</span>
              <span class="group-hover:translate-x-0.5 transition">➔</span>
            </div>
          </div>
        `;
      } else {
        // Job item
        const isOverdue = item.subType === 'overdue';
        const isToday = item.subType === 'today';
        const badgeText = isOverdue
          ? this.t('status_overdue', { days: Math.abs(item.diffDays) })
          : (isToday ? this.t('status_today') : this.t('status_days_left', { days: item.diffDays }));
        const badgeClass = isOverdue
          ? 'bg-rose-100 text-rose-700 border-rose-200'
          : (isToday ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-purple-100 text-purple-700 border-purple-200');
        const iconBg = isOverdue
          ? 'from-rose-500 to-red-600'
          : (isToday ? 'from-amber-500 to-yellow-600' : 'from-purple-500 to-indigo-600');
        const icon = isOverdue ? '🚨' : (isToday ? '⏰' : '⏳');

        return `
          <div onclick="app.handleNotificationItemClick('${item.id}', 'job')" class="p-3.5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200/90 hover:border-purple-300 shadow-xs hover:shadow-sm transition flex items-center justify-between gap-3 cursor-pointer group active:scale-[0.99]">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-tr ${iconBg} text-white flex items-center justify-center text-lg shadow-sm shrink-0 group-hover:scale-105 transition">
                ${icon}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeClass}">
                    ${badgeText}
                  </span>
                  <span class="text-[10px] text-slate-500 font-medium">${item.catMeta.name}</span>
                </div>
                <h4 class="font-bold text-slate-900 text-sm truncate mt-1 group-hover:text-purple-700 transition">
                  ${this.escapeHtml(item.title)}
                </h4>
                <p class="text-xs text-slate-500 truncate mt-0.5">
                  📅 ${this.formatDateVN(item.dueDate)}${item.dueTime ? (this.currentLang === 'en' ? ' at ' : ' lúc ') + item.dueTime : ''}${item.provider ? ' • ' + this.escapeHtml(item.provider) : ''}
                </p>
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-1 text-slate-400 group-hover:text-purple-600 text-xs font-bold transition">
              <span class="hidden sm:inline">${this.t('notif_view')}</span>
              <span class="group-hover:translate-x-0.5 transition">➔</span>
            </div>
          </div>
        `;
      }
    }).join('');
  }

  handleNotificationItemClick(id, type) {
    this.toggleNotificationCenter(false);
    if (type === 'note') {
      this.switchViewTab('notes');
      this.openNoteModalById(id);
    } else {
      this.switchViewTab('pending');
      this.showItemDetail(id);
    }
  }

  // ================= MOBILE INSTALL & QR DYNAMIC CODE =================

  getSuggestedLocalUrl() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        return window.location.origin;
      }
    }
    return 'http://192.168.1.244:8080';
  }

  setInstallTargetUrl(url) {
    const img = document.getElementById('install-qr-img');
    const text = document.getElementById('install-qr-url');
    if (img && url) {
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
    }
    if (text && url) {
      text.textContent = url;
    }
  }

  setInstallQrMode(mode) {
    const tabWifi = document.getElementById('qr-tab-wifi');
    const tabOnline = document.getElementById('qr-tab-online');
    const secWifi = document.getElementById('qr-section-wifi');
    const secOnline = document.getElementById('qr-section-online');

    if (mode === 'wifi') {
      if (tabWifi) tabWifi.className = 'py-2 rounded-xl bg-purple-600 text-white font-bold text-xs shadow-md shadow-purple-600/30 transition flex items-center justify-center gap-1.5';
      if (tabOnline) tabOnline.className = 'py-2 rounded-xl text-slate-600 hover:text-slate-900 font-semibold text-xs transition flex items-center justify-center gap-1.5';
      if (secWifi) secWifi.classList.remove('hidden');
      if (secOnline) secOnline.classList.add('hidden');
      this.setInstallTargetUrl(this.getSuggestedLocalUrl());
    } else {
      if (tabOnline) tabOnline.className = 'py-2 rounded-xl bg-purple-600 text-white font-bold text-xs shadow-md shadow-purple-600/30 transition flex items-center justify-center gap-1.5';
      if (tabWifi) tabWifi.className = 'py-2 rounded-xl text-slate-600 hover:text-slate-900 font-semibold text-xs transition flex items-center justify-center gap-1.5';
      if (secWifi) secWifi.classList.add('hidden');
      if (secOnline) secOnline.classList.remove('hidden');
    }
  }

  setInstallOnlineUrl(url) {
    const cleanUrl = (url || '').trim();
    if (cleanUrl) {
      this.setInstallTargetUrl(cleanUrl);
      const secWifi = document.getElementById('qr-section-wifi');
      if (secWifi) secWifi.classList.remove('hidden');
    }
  }

  // ================= DEVICE RINGTONE & NOTIFICATION ALARM =================

  // Toggle chuông thông báo thiết bị (Tự nhận chuông cài trên máy, không tải file .ics)
  async toggleItemAlarm(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;

    this.initAudioContext();

    // Check & request notification permission if not yet granted
    if ('Notification' in window && Notification.permission !== 'granted') {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          this.showToast('⚠️ Vui lòng cấp quyền thông báo để máy đổ chuông & rung khi đến hạn');
          return;
        }
      } catch (e) {}
    }

    // Toggle alarm state
    item.notifyPhone = item.notifyPhone === false ? true : false;
    item.updatedAt = new Date().toISOString();
    await this.storage.saveItem(item);

    if (item.notifyPhone) {
      // Clear today's alert key so re-testing alerts immediately
      const todayStr = new Date().toLocaleDateString('en-CA');
      localStorage.removeItem(`lifekeep_alerted_${item.id}_${todayStr}`);

      // Test native device notification & vibration using device's default ringtone
      await this.showPhoneNotification(
        `🔔 [LifeKeep] Đã bật chuông: ${item.name}`,
        `Máy sẽ tự động reo chuông cài sẵn & rung lúc ${item.dueTime || '08:00'} ngày ${this.formatDateVN(item.dueDate)}.`,
        `alarm-${item.id}`
      );
      this.showToast(`🔔 Đã bật chuông thiết bị cho "${item.name}"`);
      this.checkDueAlarms();
    } else {
      this.showToast(`🔕 Đã tắt chuông báo cho "${item.name}"`);
    }

    await this.render();
    if (this.selectedItem && this.selectedItem.id === item.id) {
      this.showItemDetail(item.id);
    }
  }

  async toggleSelectedAlarm() {
    if (this.selectedItem) {
      await this.toggleItemAlarm(this.selectedItem.id);
    }
  }

  // Safe aliases preventing legacy calendar file downloads
  exportToCalendarById(id) {
    this.toggleItemAlarm(id);
  }

  exportSelectedToCalendar() {
    this.toggleSelectedAlarm();
  }

  // Legacy export left for manual API calls without auto-invoking
  exportToCalendar(item) {
    if (!item || !item.dueDate) return;
    this.toggleItemAlarm(item.id);
  }

  // Calculate days remaining and urgency status
  calculateStatus(dueDateStr) {
    if (!dueDateStr) {
      return { 
        status: 'safe', 
        badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
        label: this.t('status_no_due'), 
        days: 999,
        icon: '📅'
      };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDateStr);
    due.setHours(0, 0, 0, 0);

    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        status: 'overdue',
        badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200 shadow-xs font-semibold',
        label: this.t('status_overdue', { days: Math.abs(diffDays) }),
        days: diffDays,
        icon: '🚨'
      };
    } else if (diffDays === 0) {
      return {
        status: 'urgent',
        badgeClass: 'bg-rose-100 text-rose-800 border border-rose-300 shadow-sm font-bold animate-pulse',
        label: this.t('status_today'),
        days: 0,
        icon: '⚠️'
      };
    } else if (diffDays <= 7) {
      return {
        status: 'urgent',
        badgeClass: 'bg-amber-50 text-amber-800 border border-amber-200 shadow-xs font-semibold',
        label: this.t('status_due_in', { days: diffDays }),
        days: diffDays,
        icon: '⏳'
      };
    } else if (diffDays <= 30) {
      return {
        status: 'soon',
        badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200 shadow-xs font-semibold',
        label: this.t('status_days_left', { days: diffDays }),
        days: diffDays,
        icon: '📅'
      };
    } else {
      return {
        status: 'safe',
        badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-xs font-semibold',
        label: this.t('status_days_left', { days: diffDays }),
        days: diffDays,
        icon: '✅'
      };
    }
  }

  getFilteredItems() {
    return this.items
      .filter(item => {
        const matchesCategory = this.currentCategory === 'all' || item.category === this.currentCategory;
        const matchesSearch = !this.searchQuery ||
          item.name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
          (item.provider && item.provider.toLowerCase().includes(this.searchQuery.toLowerCase())) ||
          (item.notes && item.notes.toLowerCase().includes(this.searchQuery.toLowerCase()));
        return matchesCategory && matchesSearch;
      })
      .sort((a, b) => {
        // Sort urgent / overdue first
        const statusA = this.calculateStatus(a.dueDate);
        const statusB = this.calculateStatus(b.dueDate);
        return statusA.days - statusB.days;
      });
  }

  switchViewTab(tab) {
    this.currentViewTab = tab;
    const btnPending = document.getElementById('view-tab-pending');
    const btnHistory = document.getElementById('view-tab-history');
    const btnNotes = document.getElementById('view-tab-notes');

    const activeClass = 'py-2 rounded-xl bg-purple-600 text-white font-bold shadow-md shadow-purple-600/30 transition flex items-center justify-center gap-1 cursor-pointer';
    const inactiveClass = 'py-2 rounded-xl text-slate-500 hover:text-slate-800 font-semibold transition flex items-center justify-center gap-1 cursor-pointer';

    if (btnPending) btnPending.className = (tab === 'pending') ? activeClass : inactiveClass;
    if (btnHistory) btnHistory.className = (tab === 'history') ? activeClass : inactiveClass;
    if (btnNotes) btnNotes.className = (tab === 'notes') ? activeClass : inactiveClass;

    this.render();
  }

  goToNotesTab() {
    this.switchViewTab('notes');
    const target = document.getElementById('view-tabs-switcher') || document.getElementById('items-list');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  goToJobsTab() {
    this.switchViewTab('pending');
    const target = document.getElementById('view-tabs-switcher') || document.getElementById('items-list');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  setHeroYear(year) {
    this.heroSelectedYear = parseInt(year);
    localStorage.setItem('lifekeep_hero_year', this.heroSelectedYear);
    this.render();
  }

  async calculateMetrics(targetYear = this.heroSelectedYear || new Date().getFullYear()) {
    let overdueCount = 0;
    let soonCount = 0;
    let safeCount = 0;

    this.items.forEach(item => {
      const { status } = this.calculateStatus(item.dueDate);
      if (status === 'overdue' || status === 'urgent') overdueCount++;
      else if (status === 'soon') soonCount++;
      else safeCount++;
    });

    await this.loadAllLogs();
    const yearNum = Number(targetYear);
    let totalSpent = this.allLogs
      .filter(l => new Date(l.date).getFullYear() === yearNum)
      .reduce((sum, l) => sum + (Number(l.totalCost || l.cost) || 0), 0);

    // Safeguard: include item cost if not already in logs and falls in targetYear
    this.items.forEach(item => {
      const itemYear = item.dueDate ? new Date(item.dueDate).getFullYear() : (item.createdAt ? new Date(item.createdAt).getFullYear() : null);
      if (itemYear === yearNum) {
        const hasLog = this.allLogs.some(l => l.itemId === item.id);
        if (!hasLog && item.cost > 0) {
          totalSpent += Number(item.cost);
        }
      }
    });

    // Include daily living expenses from transactions
    if (this.transactions && this.transactions.length > 0) {
      totalSpent += this.transactions
        .filter(t => t.type === 'expense' && new Date(t.date).getFullYear() === yearNum)
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    }

    return { overdueCount, soonCount, safeCount, totalSpent, year: yearNum };
  }

  getCategoryMeta(cat) {
    switch (cat) {
      case 'vehicle': 
        return { 
          name: this.t('cat_vehicle_name'), 
          icon: '🚗', 
          avatarBg: 'bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm' 
        };
      case 'home': 
        return { 
          name: this.t('cat_home_name'), 
          icon: '🏠', 
          avatarBg: 'bg-emerald-50 border-emerald-200 text-emerald-600 shadow-sm' 
        };
      case 'identity': 
        return { 
          name: this.t('cat_identity_name'), 
          icon: '🪪', 
          avatarBg: 'bg-amber-50 border-amber-200 text-amber-700 shadow-sm' 
        };
      case 'tech': 
        return { 
          name: this.t('cat_tech_name'), 
          icon: '💻', 
          avatarBg: 'bg-purple-50 border-purple-200 text-purple-600 shadow-sm' 
        };
      default: 
        return { 
          name: this.t('cat_other_name'), 
          icon: '📌', 
          avatarBg: 'bg-slate-100 border-slate-200 text-slate-600' 
        };
    }
  }

  getCategoryDisplayName(catId, fallbackName) {
    if (this.currentLang === 'en') {
      const enMap = {
        salary: 'Salary',
        bonus: 'Bonus / Projects',
        business: 'Business / Sales',
        investment: 'Investment / Interest',
        other_income: 'Other Income',
        food: 'Food & Dining',
        market: 'Groceries & Market',
        bills: 'Utilities & Bills',
        transport: 'Transport & Fuel',
        shopping: 'Shopping & Supplies',
        entertainment: 'Entertainment & Travel',
        health: 'Health & Medical',
        education: 'Education & Kids',
        other_expense: 'Other Expense',
        'Tiền lương': 'Salary',
        'Thưởng / Dự án': 'Bonus / Projects',
        'Kinh doanh / Bán hàng': 'Business / Sales',
        'Đầu tư / Tiền lãi': 'Investment / Interest',
        'Thu nhập khác': 'Other Income',
        'Ăn uống & Cà phê': 'Food & Dining',
        'Đi chợ & Siêu thị': 'Groceries & Market',
        'Hóa đơn Điện & Nước & Net': 'Utilities & Bills',
        'Xăng xe & Đi lại': 'Transport & Fuel',
        'Mua sắm & Đồ dùng': 'Shopping & Supplies',
        'Giải trí & Du lịch': 'Entertainment & Travel',
        'Thuốc men & Sức khỏe': 'Health & Medical',
        'Học tập & Con cái': 'Education & Kids',
        'Chi tiêu khác': 'Other Expense'
      };
      if (catId && enMap[catId]) return enMap[catId];
      if (fallbackName && enMap[fallbackName]) return enMap[fallbackName];
    }
    return fallbackName || catId || '';
  }

  formatMoney(num) {
    if (!num) return '0 ₫';
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
  }

  async render() {
    const listEl = document.getElementById('items-list');
    const emptyEl = document.getElementById('empty-state');
    const activeYear = this.heroSelectedYear || new Date().getFullYear();
    const metrics = await this.calculateMetrics(activeYear);

    // Update Hero Total Spending & Year Selector
    const heroYearLabel = document.getElementById('hero-year-label');
    if (heroYearLabel) heroYearLabel.textContent = this.t('hero_spending_title', { year: activeYear });
    const metricYearLabel = document.getElementById('metric-year-label');
    if (metricYearLabel) metricYearLabel.textContent = this.t('hero_spending_metric', { year: activeYear });

    const heroYearSelect = document.getElementById('hero-year-select');
    if (heroYearSelect) {
      const availYears = this.getAvailableYears();
      const yearPrefix = this.currentLang === 'en' ? 'Year ' : 'Năm ';
      heroYearSelect.innerHTML = availYears.map(y => `
        <option value="${y}" ${y === activeYear ? 'selected' : ''}>${yearPrefix}${y}</option>
      `).join('');
      heroYearSelect.value = String(activeYear);
    }

    this.updateNotificationBadge();

    const heroBalanceEl = document.getElementById('hero-total-balance');
    if (heroBalanceEl) {
      heroBalanceEl.textContent = this.formatMoney(metrics.totalSpent);
    }

    // Update Top Counters
    const mUrgent = document.getElementById('metric-urgent');
    const mSoon = document.getElementById('metric-soon');
    const mSafe = document.getElementById('metric-safe');
    const mCost = document.getElementById('metric-cost');
    if (mUrgent) mUrgent.textContent = metrics.overdueCount;
    if (mSoon) mSoon.textContent = metrics.soonCount;
    if (mSafe) mSafe.textContent = metrics.safeCount;
    if (mCost) mCost.textContent = this.formatMoney(metrics.totalSpent);

    // Update Hero Floating Highlight Card
    const floatingCardEl = document.getElementById('hero-floating-card');
    if (floatingCardEl) {
      const urgentItems = this.items.filter(item => {
        const { status } = this.calculateStatus(item.dueDate);
        return status === 'overdue' || status === 'urgent';
      }).sort((a, b) => this.calculateStatus(a.dueDate).days - this.calculateStatus(b.dueDate).days);

      if (urgentItems.length > 0) {
        const firstUrgent = urgentItems[0];
        const statusInfo = this.calculateStatus(firstUrgent.dueDate);
        const catMeta = this.getCategoryMeta(firstUrgent.category);
        floatingCardEl.innerHTML = `
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${catMeta.avatarBg} border shrink-0">
                ${catMeta.icon}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusInfo.badgeClass}">
                    ${statusInfo.icon} ${statusInfo.label}
                  </span>
                  <span class="text-xs text-slate-500 font-medium">${this.t('due_label')} ${this.formatDateVN(firstUrgent.dueDate)}</span>
                </div>
                <h4 class="font-bold text-slate-900 text-sm mt-0.5 truncate">${this.escapeHtml(firstUrgent.name)}</h4>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button 
                type="button" 
                onclick="app.showItemDetail('${firstUrgent.id}')" 
                class="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold rounded-xl border border-purple-200 transition"
              >
                ${this.t('hero_btn_detail')}
              </button>
              <button 
                type="button" 
                onclick="app.openCompleteModal('${firstUrgent.id}')" 
                class="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-md shadow-purple-600/30 transition"
              >
                ${this.t('hero_btn_done')}
              </button>
            </div>
          </div>
        `;
      } else {
        floatingCardEl.innerHTML = `
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-xl bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">
                🛡️
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">${this.t('hero_safe_badge')}</span>
                </div>
                <h4 class="font-bold text-slate-800 text-xs mt-0.5">${this.t('hero_safe_title')}</h4>
              </div>
            </div>
            <button 
              type="button" 
              onclick="app.openAddModal()" 
              class="px-3.5 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold rounded-xl transition"
            >
              ${this.t('hero_btn_add')}
            </button>
          </div>
        `;
      }
    }

    // Update Home Golden Finance Card & Starting Balance Displays
    await this.updateStartingBalanceDisplays();

    // Update View Switcher Counts
    const countPendingEl = document.getElementById('count-pending');
    const countHistoryEl = document.getElementById('count-history');
    const countNotesEl = document.getElementById('count-notes');
    if (countPendingEl) countPendingEl.textContent = this.items.length;
    if (countHistoryEl) countHistoryEl.textContent = this.allLogs.length;
    if (countNotesEl) countNotesEl.textContent = this.notes.length;

    const pendingFiltered = this.getFilteredItems();
    const historyFiltered = this.allLogs.filter(l => {
      const matchesCategory = this.currentCategory === 'all' || l.category === this.currentCategory;
      const matchesSearch = !this.searchQuery ||
        (l.itemName && l.itemName.toLowerCase().includes(this.searchQuery.toLowerCase())) ||
        (l.provider && l.provider.toLowerCase().includes(this.searchQuery.toLowerCase())) ||
        (l.notes && l.notes.toLowerCase().includes(this.searchQuery.toLowerCase())) ||
        (l.subItems && l.subItems.some(s => s.name.toLowerCase().includes(this.searchQuery.toLowerCase())));
      return matchesCategory && matchesSearch;
    });

    if (this.currentViewTab === 'pending') {
      if (pendingFiltered.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
      }
      emptyEl.classList.add('hidden');

      listEl.innerHTML = pendingFiltered.map(item => {
        const statusInfo = this.calculateStatus(item.dueDate);
        const catMeta = this.getCategoryMeta(item.category);
        const hasPhoto = item.photos && item.photos.length > 0;

        // Calculate past spending on this item
        const itemLogs = this.allLogs.filter(l => l.itemId === item.id);
        const itemTotalSpent = itemLogs.reduce((sum, l) => sum + (Number(l.totalCost || l.cost) || 0), 0);
        const itemCostDisplay = item.cost || itemTotalSpent || 0;
        const subCount = item.subItems ? item.subItems.length : (itemLogs[0]?.subItems?.length || 0);

        return `
          <div class="bg-white rounded-2xl p-4 border border-slate-200/90 hover:border-purple-300 shadow-xs hover:shadow-md transition-all duration-300 active:scale-[0.99] cursor-pointer" onclick="app.showItemDetail('${item.id}')">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-3 min-w-0">
                <div class="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${catMeta.avatarBg} border shrink-0">
                  ${catMeta.icon}
                </div>
                <div class="min-w-0">
                  <h3 class="font-bold text-slate-900 text-base leading-snug tracking-tight truncate">${this.escapeHtml(item.name)}</h3>
                  <p class="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                    <span class="text-slate-700 font-medium">${catMeta.name}</span>
                    ${item.provider ? `• <span class="text-slate-600">${this.escapeHtml(item.provider)}</span>` : ''}
                    ${item.cycleMonths ? `• <span class="text-purple-600 font-semibold">${item.cycleMonths} ${this.t('months_per_cycle')}</span>` : ''}
                  </p>
                </div>
              </div>
              <span class="px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 flex items-center gap-1 ${statusInfo.badgeClass}">
                <span>${statusInfo.icon}</span> ${statusInfo.label}
              </span>
            </div>

            ${item.notes ? `
              <div class="mt-2.5 text-xs text-slate-600 bg-slate-50 rounded-xl p-2.5 border border-slate-100 line-clamp-2">
                ${this.escapeHtml(item.notes)}
              </div>
            ` : ''}

            <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <div class="flex items-center gap-2 flex-wrap">
                <span>${this.t('due_label')} <strong class="text-slate-800 font-bold">${this.formatDateVN(item.dueDate)}${item.dueTime ? ' ' + item.dueTime : ''}</strong></span>
                ${itemCostDisplay > 0 ? `
                  <span class="text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[11px] flex items-center gap-1">
                    <span>💰</span> ${this.formatMoney(itemCostDisplay)}
                    ${subCount > 0 ? `<span class="text-[10px] text-emerald-600 font-normal">(${this.t('sub_items_count', { count: subCount })})</span>` : ''}
                  </span>
                ` : ''}
                ${hasPhoto ? `<span class="bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full text-[10px] font-semibold">${this.t('has_photo')}</span>` : ''}
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button 
                  type="button"
                  onclick="event.stopPropagation(); app.toggleItemAlarm('${item.id}')" 
                  class="p-1.5 ${item.notifyPhone !== false ? 'bg-purple-100 text-purple-700 border-purple-300' : 'bg-slate-50 text-slate-400 border-slate-200'} hover:bg-purple-50 rounded-xl transition text-xs border flex items-center justify-center shadow-xs active:scale-95"
                  title="${item.notifyPhone !== false ? this.t('alarm_on_title') : this.t('alarm_off_title')}"
                >
                  ${item.notifyPhone !== false ? '🔔' : '🔕'}
                </button>
                <button 
                  type="button"
                  onclick="event.stopPropagation(); app.openEditModalById('${item.id}')" 
                  class="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl font-semibold transition text-xs border border-slate-200 flex items-center gap-1"
                  title="Sửa thông tin & chi phí"
                >
                  <span>✏️</span> ${this.t('btn_edit')}
                </button>
                <button 
                  type="button" 
                  onclick="event.stopPropagation(); app.deleteItemById('${item.id}')" 
                  class="p-1.5 bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-xl transition text-xs border border-slate-200 flex items-center justify-center shadow-xs" 
                  title="Xóa mục này"
                >
                  🗑️
                </button>
                <button 
                  onclick="event.stopPropagation(); app.openCompleteModal('${item.id}')" 
                  class="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition text-xs flex items-center gap-1.5 shadow-md shadow-purple-600/30 hover:scale-105 active:scale-95"
                  title="Ghi nhận đã hoàn thành và bóc tách chi phí"
                >
                  <span>✓</span> ${this.t('btn_done')}
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else if (this.currentViewTab === 'history') {
      // History View: Nhật ký việc đã xong
      if (historyFiltered.length === 0) {
        listEl.innerHTML = `
          <div class="text-center py-10 bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <div class="text-3xl mb-2">📜</div>
            <p class="text-slate-800 text-xs font-bold">${this.t('history_empty_title')}</p>
            <p class="text-[11px] text-slate-500 mt-1">${this.t('history_empty_desc')}</p>
          </div>
        `;
        emptyEl.classList.add('hidden');
        return;
      }
      emptyEl.classList.add('hidden');

      listEl.innerHTML = historyFiltered.map(log => {
        const catMeta = this.getCategoryMeta(log.category);
        const subCount = log.subItems ? log.subItems.length : 0;
        const subPreview = log.subItems && log.subItems.length > 0 
          ? log.subItems.slice(0, 2).map(s => `${s.name} (${this.formatMoney(s.cost)})`).join(' • ') + (subCount > 2 ? ` • +${subCount - 2} khoản khác` : '')
          : '';

        return `
          <div class="bg-white rounded-2xl p-4 border border-slate-200/90 hover:border-purple-300 shadow-xs hover:shadow-md transition-all duration-300 active:scale-[0.99] cursor-pointer" onclick="app.showLogDetail('${log.id}')">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-3 min-w-0">
                <div class="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${catMeta.avatarBg} border shrink-0">
                  ${catMeta.icon}
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[11px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">✓ ${this.t('tab_history')}</span>
                    <span class="text-xs text-slate-500 font-medium">${this.formatDateVN(log.date)}</span>
                  </div>
                  <h3 class="font-bold text-slate-900 text-base leading-snug tracking-tight mt-1 truncate">${this.escapeHtml(log.itemName || 'Bảo dưỡng')}</h3>
                  ${log.provider ? `<p class="text-xs text-slate-500 mt-0.5">${this.currentLang === 'en' ? 'Provider:' : 'Nơi làm:'} <span class="text-slate-700 font-medium">${this.escapeHtml(log.provider)}</span></p>` : ''}
                </div>
              </div>
              <div class="text-right shrink-0">
                <span class="text-sm font-black text-slate-900 block">${this.formatMoney(log.totalCost || log.cost)}</span>
                <span class="text-[10px] text-slate-500">${subCount > 0 ? `${subCount} khoản chi con` : 'Trọn gói'}</span>
              </div>
            </div>

            ${subPreview ? `
              <div class="mt-2.5 text-[11px] text-slate-600 bg-slate-50 rounded-xl p-2 border border-slate-100 flex items-center gap-1.5">
                <span class="text-slate-400 shrink-0">Bóc tách:</span>
                <span class="truncate text-slate-700 font-medium">${this.escapeHtml(subPreview)}</span>
              </div>
            ` : ''}

            <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span class="text-[11px] text-slate-500 truncate max-w-[200px]">${this.escapeHtml(log.notes || 'Không có ghi chú')}</span>
              <div class="flex items-center gap-1.5 shrink-0">
                <button 
                  type="button"
                  onclick="event.stopPropagation(); app.deleteLogById('${log.id}')" 
                  class="p-1.5 bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-xl transition text-xs border border-slate-200 flex items-center justify-center shadow-xs" 
                  title="Xóa bản ghi lịch sử này"
                >
                  🗑️
                </button>
                <button 
                  type="button"
                  onclick="event.stopPropagation(); app.showLogDetail('${log.id}')" 
                  class="px-2.5 py-1.5 bg-slate-50 hover:bg-purple-50 text-purple-700 rounded-xl font-semibold transition text-xs flex items-center gap-1 border border-slate-200"
                >
                  <span>🔎</span> ${this.t('hero_btn_detail')}
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else if (this.currentViewTab === 'notes') {
      this.renderNotesView(listEl, emptyEl);
    }
  }

  getNoteColorClass(color) {
    switch (color) {
      case 'amber':
        return 'bg-amber-50/90 border-amber-200 text-amber-950 hover:border-amber-400 shadow-amber-500/5';
      case 'purple':
        return 'bg-purple-50/90 border-purple-200 text-purple-950 hover:border-purple-400 shadow-purple-500/5';
      case 'emerald':
        return 'bg-emerald-50/90 border-emerald-200 text-emerald-950 hover:border-emerald-400 shadow-emerald-500/5';
      case 'sky':
        return 'bg-sky-50/90 border-sky-200 text-sky-950 hover:border-sky-400 shadow-sky-500/5';
      case 'rose':
        return 'bg-rose-50/90 border-rose-200 text-rose-950 hover:border-rose-400 shadow-rose-500/5';
      default:
        return 'bg-white border-slate-200 text-slate-800 hover:border-purple-300 shadow-slate-950/5';
    }
  }

  renderNotesView(listEl, emptyEl) {
    const notesFiltered = this.notes.filter(n => {
      if (!this.searchQuery) return true;
      const q = this.searchQuery.toLowerCase();
      return (n.title && n.title.toLowerCase().includes(q)) ||
             (n.content && n.content.toLowerCase().includes(q));
    });

    if (notesFiltered.length === 0) {
      listEl.innerHTML = `
        <div class="text-center py-10 bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
          <div class="text-4xl mb-2">📝</div>
          <h4 class="text-slate-800 text-sm font-bold">${this.searchQuery ? (this.currentLang === 'en' ? 'No matching notes found' : 'Không tìm thấy ghi chú phù hợp') : this.t('notes_empty_title')}</h4>
          <p class="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
            ${this.searchQuery ? (this.currentLang === 'en' ? 'Try searching with another keyword.' : 'Hãy thử tìm kiếm với từ khóa khác.') : this.t('notes_empty_desc')}
          </p>
          <button 
            type="button" 
            onclick="app.openNoteModal()" 
            class="mt-4 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-amber-950 font-black rounded-xl text-xs shadow-md shadow-amber-500/30 transition active:scale-95 cursor-pointer"
          >
            + ${this.t('note_modal_new')}
          </button>
        </div>
      `;
      emptyEl.classList.add('hidden');
      return;
    }
    emptyEl.classList.add('hidden');

    const pinnedNotes = notesFiltered.filter(n => n.pinned);
    const regularNotes = notesFiltered.filter(n => !n.pinned);

    const renderNoteCard = (note) => {
      const colorClass = this.getNoteColorClass(note.color);
      const isPinned = !!note.pinned;
      const hasAlarm = !!(note.hasReminder && note.dueDate);

      return `
        <div 
          class="rounded-2xl p-4 border transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer relative group ${colorClass}" 
          onclick="app.openNoteModalById('${note.id}')"
        >
          <div class="flex items-start justify-between gap-2">
            <h4 class="font-black text-sm leading-snug line-clamp-2 flex-1">
              ${this.escapeHtml(note.title || (this.currentLang === 'en' ? 'Untitled Note' : 'Ghi chú không tiêu đề'))}
            </h4>
            <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
              <button 
                type="button" 
                onclick="app.toggleNotePin('${note.id}')" 
                class="w-7 h-7 rounded-lg flex items-center justify-center transition text-xs ${isPinned ? 'bg-amber-400 text-amber-950 shadow-xs' : 'bg-black/5 hover:bg-black/10 text-slate-600'}" 
                title="${isPinned ? 'Bỏ ghim' : 'Ghim lên đầu'}"
              >
                ${isPinned ? '📌' : '📍'}
              </button>
              <button 
                type="button" 
                onclick="app.deleteNoteById('${note.id}')" 
                class="w-7 h-7 rounded-lg bg-black/5 hover:bg-rose-100 hover:text-rose-600 text-slate-600 flex items-center justify-center transition text-xs" 
                title="Xóa ghi chú"
              >
                🗑️
              </button>
            </div>
          </div>

          ${note.content ? `
            <div class="text-xs mt-2 text-slate-700 whitespace-pre-line line-clamp-4 leading-relaxed font-normal">
              ${this.escapeHtml(note.content)}
            </div>
          ` : ''}

          <div class="mt-3 pt-2.5 border-t border-black/5 flex items-center justify-between text-[10px] text-slate-500 gap-2 flex-wrap">
            <div class="flex items-center gap-1.5 flex-wrap">
              ${hasAlarm ? `
                <span class="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full bg-white/90 border border-slate-300/80 text-purple-950 shadow-2xs">
                  <span>⏰</span> ${this.formatDateVN(note.dueDate)} ${note.dueTime || '08:00'} ${note.notifyPhone !== false ? '🔔' : '🔕'}
                </span>
              ` : ''}
            </div>
            <span class="text-[10px] text-slate-500/80">
              ${note.updatedAt ? this.formatDateVN(note.updatedAt.split('T')[0]) : ''}
            </span>
          </div>
        </div>
      `;
    };

    let html = `
      <div class="mb-3">
        <button 
          type="button" 
          onclick="app.openNoteModal()" 
          class="w-full py-3 px-4 bg-white hover:bg-amber-50/50 border border-dashed border-amber-300 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold text-amber-900 shadow-xs transition hover:shadow-sm active:scale-[0.99] cursor-pointer"
        >
          <span class="text-base">📝</span>
          <span>${this.t('notes_quick_add')}</span>
        </button>
      </div>
    `;

    if (pinnedNotes.length > 0) {
      html += `
        <div class="mb-3">
          <div class="flex items-center gap-1 text-[11px] font-bold text-slate-600 mb-2 px-1">
            <span>📌</span> ${this.t('notes_pinned_header')} (${pinnedNotes.length})
          </div>
          <div class="space-y-2.5">
            ${pinnedNotes.map(renderNoteCard).join('')}
          </div>
        </div>
      `;
    }

    if (regularNotes.length > 0) {
      if (pinnedNotes.length > 0) {
        html += `
          <div class="flex items-center gap-1 text-[11px] font-bold text-slate-600 mb-2 mt-4 px-1">
            <span>📄</span> ${this.t('notes_all_header')} (${regularNotes.length})
          </div>
        `;
      }
      html += `
        <div class="space-y-2.5">
          ${regularNotes.map(renderNoteCard).join('')}
        </div>
      `;
    }

    listEl.innerHTML = html;
  }

  formatDateVN(dateStr) {
    if (!dateStr) return this.t('not_set') || 'Chưa đặt';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      if (this.currentLang === 'en') {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const mIdx = parseInt(parts[1], 10) - 1;
        const monthName = months[mIdx] || parts[1];
        const day = parseInt(parts[2], 10);
        return `${monthName} ${day}, ${parts[0]}`;
      }
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m]));
  }

  async renderTemplates() {
    const container = document.getElementById('template-chips');
    if (!container) return;

    this.customTemplates = await this.storage.getCustomTemplates();

    // Render presets + custom templates
    let html = '';

    // Custom templates created by user
    if (this.customTemplates.length > 0) {
      html += this.customTemplates.map(tmpl => `
        <div class="inline-flex items-center bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 px-3 py-1.5 rounded-full whitespace-nowrap transition text-xs gap-1.5 shrink-0 shadow-xs">
          <button type="button" onclick="app.applyCustomTemplate('${tmpl.id}')" class="flex items-center gap-1 font-semibold">
            <span>⭐</span> <strong>${this.escapeHtml(tmpl.name)}</strong>
          </button>
          <button type="button" onclick="event.stopPropagation(); app.deleteCustomTemplate('${tmpl.id}')" class="text-purple-400 hover:text-rose-600 ml-1 text-[11px]" title="Xóa mẫu riêng này">✕</button>
        </div>
      `).join('');
    }

    // Default presets
    html += PRESET_TEMPLATES.map((tmpl, idx) => `
      <button 
        type="button" 
        onclick="app.applyTemplate(${idx})" 
        class="text-xs bg-white hover:bg-purple-50 text-slate-700 hover:text-purple-700 border border-slate-200 hover:border-purple-300 px-3 py-1.5 rounded-full whitespace-nowrap transition flex items-center gap-1.5 shrink-0 shadow-xs font-medium"
      >
        <span>${tmpl.icon}</span> ${tmpl.name}
      </button>
    `).join('');

    container.innerHTML = html;
  }

  applyTemplate(idx) {
    const tmpl = PRESET_TEMPLATES[idx];
    if (!tmpl) return;

    document.getElementById('input-name').value = tmpl.name;
    document.getElementById('input-category').value = tmpl.category;
    document.getElementById('input-cycle').value = tmpl.cycleMonths || '';
    document.getElementById('input-provider').value = tmpl.provider || '';
    document.getElementById('input-notes').value = tmpl.notes || '';

    // Calculate initial suggested date
    const d = new Date();
    d.setMonth(d.getMonth() + (tmpl.cycleMonths || 6));
    document.getElementById('input-date').value = d.toISOString().split('T')[0];

    // Pre-populate suggested sub-items and expenses
    const subContainer = document.getElementById('item-sub-costs-container');
    if (subContainer) {
      subContainer.innerHTML = '';
      if (tmpl.subItems && tmpl.subItems.length > 0) {
        tmpl.subItems.forEach(s => this.addItemSubCostRow(s.name, s.cost));
      } else {
        this.addItemSubCostRow('Chi phí chính', '');
      }
      this.calculateItemTotalCost();
    }
  }

  applyCustomTemplate(id) {
    const tmpl = this.customTemplates.find(t => t.id === id);
    if (!tmpl) return;

    document.getElementById('input-name').value = tmpl.name;
    document.getElementById('input-category').value = tmpl.category || 'other';
    document.getElementById('input-cycle').value = tmpl.cycleMonths || '';
    document.getElementById('input-provider').value = tmpl.provider || '';
    document.getElementById('input-phone').value = tmpl.phone || '';
    document.getElementById('input-notes').value = tmpl.notes || '';

    const d = new Date();
    d.setMonth(d.getMonth() + (tmpl.cycleMonths || 6));
    document.getElementById('input-date').value = d.toISOString().split('T')[0];

    // Populate custom template sub-items if present
    const subContainer = document.getElementById('item-sub-costs-container');
    if (subContainer) {
      subContainer.innerHTML = '';
      if (tmpl.subItems && tmpl.subItems.length > 0) {
        tmpl.subItems.forEach(s => this.addItemSubCostRow(s.name, s.cost));
      } else if (tmpl.cost) {
        this.addItemSubCostRow('Chi phí chính', tmpl.cost);
      } else {
        this.addItemSubCostRow('Chi phí chính', '');
      }
      this.calculateItemTotalCost();
    }
  }

  async deleteCustomTemplate(id) {
    if (confirm('Bạn có chắc muốn xóa mẫu riêng này không?')) {
      await this.storage.deleteCustomTemplate(id);
      await this.renderTemplates();
    }
  }

  openEditModalById(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      this.openAddModal(item);
    }
  }

  addItemSubCostRow(name = '', cost = '') {
    const container = document.getElementById('item-sub-costs-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'item-sub-cost-row flex items-center gap-2';
    row.innerHTML = `
      <input 
        type="text" 
        placeholder="Tên khoản chi con (ví dụ: Thay nhớt, lọc gió...)" 
        value="${this.escapeHtml(name)}" 
        class="item-sub-name flex-1 bg-slate-50 text-xs text-slate-800 px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-purple-600 focus:bg-white" 
      />
      <input 
        type="text" 
        inputmode="numeric" 
        placeholder="Số tiền ₫" 
        value="${this.formatMoneyString(cost)}" 
        oninput="app.formatCurrencyInput(this); app.calculateItemTotalCost();" 
        onkeyup="app.formatCurrencyInput(this); app.calculateItemTotalCost();" 
        onblur="app.formatCurrencyInput(this); app.calculateItemTotalCost();" 
        class="item-sub-cost w-32 bg-slate-50 text-xs text-slate-800 px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-purple-600 focus:bg-white font-bold text-purple-700" 
      />
      <button 
        type="button" 
        onclick="this.parentElement.remove(); app.calculateItemTotalCost();" 
        class="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg text-sm transition" 
        title="Xóa khoản này"
      >✕</button>
    `;
    container.appendChild(row);
  }

  calculateItemTotalCost() {
    let total = 0;
    document.querySelectorAll('.item-sub-cost').forEach(input => {
      total += this.parseMoneyInput(input.value);
    });
    const display = document.getElementById('item-total-cost-display');
    if (display) display.textContent = this.formatMoney(total);
    return total;
  }

  openAddModal(itemToEdit = null) {
    this.currentPhotoBase64 = null;
    this.resetPhotoInputs();
    const modal = document.getElementById('item-modal');
    const title = document.getElementById('modal-title');
    const form = document.getElementById('item-form');
    const photoPreview = document.getElementById('photo-preview-container');
    const subContainer = document.getElementById('item-sub-costs-container');

    form.reset();
    photoPreview.innerHTML = '';
    if (subContainer) subContainer.innerHTML = '';

    // Reset reminder checkboxes
    document.querySelectorAll('.reminder-cb').forEach(cb => {
      cb.checked = (cb.value === '7' || cb.value === '1');
    });

    if (itemToEdit) {
      title.textContent = 'Chỉnh sửa mục & Chi phí';
      const deleteBtn = document.getElementById('item-delete-btn');
      if (deleteBtn) deleteBtn.classList.remove('hidden');
      document.getElementById('item-id').value = itemToEdit.id;
      document.getElementById('input-name').value = itemToEdit.name;
      document.getElementById('input-category').value = itemToEdit.category;
      document.getElementById('input-date').value = itemToEdit.dueDate;
      if (document.getElementById('input-time')) {
        document.getElementById('input-time').value = itemToEdit.dueTime || '08:00';
      }
      if (document.getElementById('input-phone-alarm')) {
        document.getElementById('input-phone-alarm').checked = (itemToEdit.notifyPhone !== false);
      }
      document.getElementById('input-cycle').value = itemToEdit.cycleMonths || '';
      document.getElementById('input-provider').value = itemToEdit.provider || '';
      document.getElementById('input-phone').value = itemToEdit.phone || '';
      document.getElementById('input-notes').value = itemToEdit.notes || '';

      if (itemToEdit.reminders) {
        document.querySelectorAll('.reminder-cb').forEach(cb => {
          cb.checked = itemToEdit.reminders.includes(parseInt(cb.value, 10));
        });
      }

      // Populate sub-items and expenses
      let populated = false;
      if (itemToEdit.subItems && itemToEdit.subItems.length > 0) {
        itemToEdit.subItems.forEach(s => this.addItemSubCostRow(s.name, s.cost));
        populated = true;
      } else {
        // Look up in allLogs for this item
        const existingLogs = this.allLogs.filter(l => l.itemId === itemToEdit.id);
        if (existingLogs.length > 0 && existingLogs[0].subItems && existingLogs[0].subItems.length > 0) {
          existingLogs[0].subItems.forEach(s => this.addItemSubCostRow(s.name, s.cost));
          populated = true;
        } else if (itemToEdit.cost > 0 || (existingLogs.length > 0 && (existingLogs[0].totalCost || existingLogs[0].cost))) {
          const costVal = itemToEdit.cost || existingLogs[0].totalCost || existingLogs[0].cost;
          this.addItemSubCostRow('Chi phí chính', costVal);
          populated = true;
        }
      }

      if (!populated) {
        this.addItemSubCostRow('Chi phí chính', '');
      }

      this.calculateItemTotalCost();

      if (itemToEdit.photos && itemToEdit.photos.length > 0) {
        this.currentPhotoBase64 = itemToEdit.photos[0];
        photoPreview.innerHTML = `
          <div class="relative inline-block mt-2 group">
            <img src="${this.currentPhotoBase64}" onclick="app.openCurrentEditingPhoto()" class="w-24 h-24 object-cover rounded-xl border-2 border-purple-200 shadow-sm cursor-pointer hover:border-purple-500 transition" title="Bấm xem ảnh lớn" />
            <button type="button" onclick="app.removePhoto()" class="absolute -top-2 -right-2 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md transition" title="Xóa ảnh này">✕</button>
            <button type="button" onclick="app.openCurrentEditingPhoto()" class="mt-1 text-[11px] text-purple-700 font-semibold flex items-center gap-1 hover:underline">
              <span>🔍 Bấm xem ảnh</span>
            </button>
          </div>
        `;
      }
    } else {
      title.textContent = 'Thêm giấy tờ / Thiết bị mới';
      const deleteBtn = document.getElementById('item-delete-btn');
      if (deleteBtn) deleteBtn.classList.add('hidden');
      document.getElementById('item-id').value = '';
      const now = new Date();
      // Ngày thông báo mặc định là ngày thực tại trên điện thoại
      const todayStr = now.toLocaleDateString('en-CA');
      document.getElementById('input-date').value = todayStr;
      const nowHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      if (document.getElementById('input-time')) {
        document.getElementById('input-time').value = nowHM || '08:00';
      }
      if (document.getElementById('input-phone-alarm')) {
        document.getElementById('input-phone-alarm').checked = true;
      }

      // Add 1 initial cost row for adding new item
      this.addItemSubCostRow('Chi phí chính', '');
      this.calculateItemTotalCost();
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  closeModal() {
    const modal = document.getElementById('item-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  // ================= QUICK ACTION MENU (3 TÙY CHỌN DƯỚI CÙNG) =================

  toggleQuickActionMenu() {
    const modal = document.getElementById('quick-action-modal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    } else {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  // ================= NOTES MODULE (GHI CHÚ DI ĐỘNG CÓ BÁO THỨC) =================

  selectNoteColor(color) {
    this.selectedNoteColor = color || 'amber';
    document.querySelectorAll('.note-color-btn').forEach(btn => {
      if (btn.dataset.color === this.selectedNoteColor) {
        btn.classList.add('ring-2', 'ring-purple-600', 'scale-110');
      } else {
        btn.classList.remove('ring-2', 'ring-purple-600', 'scale-110');
      }
    });
  }

  toggleNoteAlarmFields() {
    const cb = document.getElementById('cb-note-alarm');
    const fields = document.getElementById('note-alarm-fields');
    if (!cb || !fields) return;
    if (cb.checked) {
      fields.classList.remove('hidden');
    } else {
      fields.classList.add('hidden');
    }
  }

  openNoteModalById(id) {
    const note = this.notes.find(n => n.id === id);
    if (note) {
      this.openNoteModal(note);
    }
  }

  openNoteModal(noteToEdit = null) {
    const modal = document.getElementById('note-modal');
    const titleEl = document.getElementById('note-modal-title');
    const deleteBtn = document.getElementById('note-delete-btn');
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const nowHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    this.editingNoteId = noteToEdit ? noteToEdit.id : null;

    if (noteToEdit) {
      if (titleEl) titleEl.textContent = 'Chỉnh sửa ghi chú';
      if (deleteBtn) deleteBtn.classList.remove('hidden');
      document.getElementById('input-note-id').value = noteToEdit.id;
      document.getElementById('input-note-title').value = noteToEdit.title || '';
      document.getElementById('input-note-content').value = noteToEdit.content || '';
      document.getElementById('input-note-pinned').checked = !!noteToEdit.pinned;
      this.selectNoteColor(noteToEdit.color || 'amber');

      const cbAlarm = document.getElementById('cb-note-alarm');
      if (cbAlarm) {
        cbAlarm.checked = !!noteToEdit.hasReminder;
        this.toggleNoteAlarmFields();
      }
      document.getElementById('input-note-date').value = noteToEdit.dueDate || todayStr;
      document.getElementById('input-note-time').value = noteToEdit.dueTime || nowHM;
      document.getElementById('input-note-phone-alarm').checked = (noteToEdit.notifyPhone !== false);
    } else {
      if (titleEl) titleEl.textContent = 'Ghi chú mới';
      if (deleteBtn) deleteBtn.classList.add('hidden');
      document.getElementById('input-note-id').value = '';
      document.getElementById('input-note-title').value = '';
      document.getElementById('input-note-content').value = '';
      document.getElementById('input-note-pinned').checked = false;
      this.selectNoteColor('amber');

      const cbAlarm = document.getElementById('cb-note-alarm');
      if (cbAlarm) {
        cbAlarm.checked = false;
        this.toggleNoteAlarmFields();
      }
      document.getElementById('input-note-date').value = todayStr;
      document.getElementById('input-note-time').value = nowHM;
      document.getElementById('input-note-phone-alarm').checked = true;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
      document.getElementById('input-note-title')?.focus();
    }, 100);
  }

  closeNoteModal() {
    const modal = document.getElementById('note-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    this.editingNoteId = null;
  }

  async saveNoteFromForm(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (this._isSavingNote) return;
    this._isSavingNote = true;

    const submitBtn = document.getElementById('note-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const id = document.getElementById('input-note-id').value || 'note-' + Date.now();
      const title = document.getElementById('input-note-title').value.trim();
      const content = document.getElementById('input-note-content').value.trim();

      if (!title && !content) {
        alert('Vui lòng nhập tiêu đề hoặc nội dung ghi chú!');
        return;
      }

      const pinned = document.getElementById('input-note-pinned').checked;
      const color = this.selectedNoteColor || 'amber';
      const hasReminder = document.getElementById('cb-note-alarm').checked;
      const dueDate = hasReminder ? document.getElementById('input-note-date').value : null;
      const dueTime = hasReminder ? (document.getElementById('input-note-time')?.value || '08:00') : null;
      const notifyPhone = hasReminder ? document.getElementById('input-note-phone-alarm').checked : false;

      // Unlock AudioContext and request notification permission if user wants alarm
      this.initAudioContext();
      if (hasReminder && notifyPhone && 'Notification' in window && Notification.permission === 'default') {
        try {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            const notifBanner = document.getElementById('notif-permission-banner');
            if (notifBanner) notifBanner.classList.add('hidden');
          }
        } catch (permErr) {
          console.warn('Perm request error:', permErr);
        }
      }

      const note = {
        id,
        title: title || (content ? content.slice(0, 30) + '...' : 'Ghi chú'),
        content,
        color,
        pinned,
        hasReminder,
        dueDate,
        dueTime,
        notifyPhone,
        updatedAt: new Date().toISOString(),
        createdAt: this.editingNoteId ? (this.notes.find(n => n.id === this.editingNoteId)?.createdAt || new Date().toISOString()) : new Date().toISOString()
      };

      await this.storage.saveNote(note);
      await this.loadNotes();

      this.closeNoteModal();
      this.switchViewTab('notes');
      this.showToast('📝 Đã lưu ghi chú thành công!');

      // Check alarms immediately if this note is due today
      if (hasReminder) {
        this.checkDueAlarms();
      }
    } catch (err) {
      console.error('Lỗi lưu ghi chú:', err);
      alert('Không thể lưu ghi chú: ' + (err.message || err));
    } finally {
      this._isSavingNote = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async deleteCurrentEditingNote() {
    if (!this.editingNoteId) return;
    await this.deleteNoteById(this.editingNoteId);
    this.closeNoteModal();
  }

  async deleteNoteById(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa ghi chú này không?')) return;
    try {
      await this.storage.deleteNote(id);
      await this.loadNotes();
      await this.render();
      this.showToast('🗑️ Đã xóa ghi chú!');
    } catch (err) {
      console.error('Lỗi khi xóa ghi chú:', err);
      alert('Không thể xóa ghi chú: ' + (err.message || err));
    }
  }

  async toggleNotePin(id) {
    const note = this.notes.find(n => n.id === id);
    if (!note) return;
    note.pinned = !note.pinned;
    note.updatedAt = new Date().toISOString();
    await this.storage.saveNote(note);
    await this.loadNotes();
    await this.render();
    this.showToast(note.pinned ? '📌 Đã ghim ghi chú lên đầu!' : 'Đã bỏ ghim ghi chú');
  }

  removePhoto() {
    this.currentPhotoBase64 = null;
    const container = document.getElementById('photo-preview-container');
    if (container) container.innerHTML = '';
    this.resetPhotoInputs();
  }

  resetPhotoInputs() {
    ['photo-camera-input', 'photo-file-input', 'photo-input'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  openCurrentEditingPhoto() {
    if (this.currentPhotoBase64) {
      const name = document.getElementById('input-name')?.value || 'Ảnh xem trước';
      this.openPhotoViewer(this.currentPhotoBase64, name);
    }
  }

  async handlePhotoUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    // Compress & convert to base64
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_DIM = 1200;
        let width = img.width;
        let height = img.height;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        this.currentPhotoBase64 = canvas.toDataURL('image/jpeg', 0.85);

        const previewContainer = document.getElementById('photo-preview-container');
        if (previewContainer) {
          previewContainer.innerHTML = `
            <div class="relative inline-block mt-2 group">
              <img src="${this.currentPhotoBase64}" onclick="app.openCurrentEditingPhoto()" class="w-24 h-24 object-cover rounded-xl border-2 border-purple-200 shadow-sm cursor-pointer hover:border-purple-500 transition" title="Bấm xem ảnh lớn" />
              <button type="button" onclick="app.removePhoto()" class="absolute -top-2 -right-2 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md transition" title="Xóa ảnh này">✕</button>
              <button type="button" onclick="app.openCurrentEditingPhoto()" class="mt-1 text-[11px] text-purple-700 font-semibold flex items-center gap-1 hover:underline">
                <span>🔍 Bấm xem ảnh</span>
              </button>
            </div>
          `;
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async saveItemFromForm(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (this._isSavingItem) return;
    this._isSavingItem = true;

    const submitBtn = document.getElementById('item-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
    }

    try {
      const id = document.getElementById('item-id').value || 'item-' + Date.now();
      const name = document.getElementById('input-name').value.trim();
      if (!name) {
        alert('Vui lòng nhập tên mục / tài sản!');
        return;
      }
      const category = document.getElementById('input-category').value;
      const dueDate = document.getElementById('input-date').value;
      const dueTime = document.getElementById('input-time')?.value || '08:00';
      const notifyPhone = document.getElementById('input-phone-alarm') ? document.getElementById('input-phone-alarm').checked : true;
      const cycleMonths = parseInt(document.getElementById('input-cycle').value, 10) || null;
      const provider = document.getElementById('input-provider').value.trim();
      const phone = document.getElementById('input-phone').value.trim();
      const notes = document.getElementById('input-notes').value.trim();
      const saveAsTemplate = document.getElementById('cb-save-template')?.checked;

      // Unlock AudioContext and request notification permission if user chose phone alerts
      this.initAudioContext();
      if (notifyPhone && 'Notification' in window && Notification.permission === 'default') {
        try {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            const notifBanner = document.getElementById('notif-permission-banner');
            if (notifBanner) notifBanner.classList.add('hidden');
          }
        } catch (permErr) {
          console.warn('Perm request error:', permErr);
        }
      }

      const reminders = [];
      document.querySelectorAll('.reminder-cb:checked').forEach(cb => {
        reminders.push(parseInt(cb.value, 10));
      });

      // Collect sub-items and calculate total cost using parseMoneyInput
      const subItems = [];
      document.querySelectorAll('.item-sub-cost-row').forEach(row => {
        const subName = row.querySelector('.item-sub-name')?.value.trim();
        const subCost = this.parseMoneyInput(row.querySelector('.item-sub-cost')?.value);
        if (subName || subCost > 0) {
          subItems.push({ name: subName || 'Khoản chi phí', cost: subCost });
        }
      });
      const totalCost = subItems.reduce((sum, s) => sum + s.cost, 0);

      const photos = this.currentPhotoBase64 ? [this.currentPhotoBase64] : [];

      const item = {
        id,
        name,
        category,
        dueDate,
        dueTime,
        notifyPhone,
        cycleMonths,
        provider,
        phone,
        notes,
        cost: totalCost,
        subItems,
        reminders,
        photos,
        updatedAt: new Date().toISOString()
      };

      // If user wants to save this as a reusable custom template
      if (saveAsTemplate) {
        await this.storage.saveCustomTemplate({
          id: 'tmpl-' + Date.now(),
          name,
          category,
          cycleMonths,
          provider,
          phone,
          notes,
          cost: totalCost,
          subItems,
          createdAt: new Date().toISOString()
        });
        await this.renderTemplates();
      }

      // Save item to items store
      await this.storage.saveItem(item);

      // If this is an existing item that has past completed logs, update their item name/category for consistency
      const existingLogs = this.allLogs.filter(l => l.itemId === item.id);
      for (const existingLog of existingLogs) {
        existingLog.itemName = item.name;
        existingLog.category = item.category;
        if (item.provider) existingLog.provider = item.provider;
        await this.storage.saveLog(existingLog);
      }

      await this.loadItems();
      await this.loadAllLogs();

      // Ensure newly added item is immediately visible by resetting view filter
      this.currentViewTab = 'pending';
      this.currentCategory = 'all';

      const btnPending = document.getElementById('view-tab-pending');
      const btnHistory = document.getElementById('view-tab-history');
      if (btnPending && btnHistory) {
        btnPending.className = 'py-2.5 rounded-xl bg-purple-600 text-white font-bold shadow-md shadow-purple-600/30 transition flex items-center justify-center gap-1.5';
        btnHistory.className = 'py-2.5 rounded-xl text-slate-500 hover:text-slate-800 font-semibold transition flex items-center justify-center gap-1.5';
      }

      document.querySelectorAll('.cat-pill').forEach(b => {
        if (b.dataset.category === 'all') {
          b.className = 'cat-pill px-3.5 py-1.5 rounded-full bg-purple-600 text-white shadow-md shadow-purple-600/30 whitespace-nowrap transition border border-purple-600 flex items-center gap-1.5 font-semibold';
        } else {
          b.className = 'cat-pill px-3.5 py-1.5 rounded-full bg-white text-slate-600 hover:text-slate-900 hover:border-purple-300 whitespace-nowrap transition border border-slate-200 shadow-xs flex items-center gap-1.5 font-medium';
        }
      });

      this.closeModal();
      await this.render();
      this.showToast('✅ Đã lưu mục thành công!');

      // Check alarms immediately for the newly saved item
      this.checkDueAlarms();
    } catch (err) {
      console.error('Lỗi khi lưu mục:', err);
      alert('Không thể lưu mục: ' + (err.message || err));
    } finally {
      this._isSavingItem = false;
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  async showItemDetail(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;

    this.selectedItem = item;
    const modal = document.getElementById('detail-modal');
    const catMeta = this.getCategoryMeta(item.category);
    const statusInfo = this.calculateStatus(item.dueDate);
    const logs = await this.storage.getLogsForItem(item.id);

    document.getElementById('detail-title').textContent = item.name;
    document.getElementById('detail-category-badge').innerHTML = `${catMeta.icon} ${catMeta.name}`;
    document.getElementById('detail-status-badge').className = `px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.badgeClass}`;
    document.getElementById('detail-status-badge').innerHTML = `${statusInfo.icon} ${statusInfo.label}`;

    document.getElementById('detail-due-date').textContent = this.formatDateVN(item.dueDate);
    const timeEl = document.getElementById('detail-due-time');
    if (timeEl) {
      timeEl.textContent = item.dueTime || '08:00';
    }
    const cycleEl = document.getElementById('detail-cycle');
    if (cycleEl) {
      cycleEl.textContent = item.cycleMonths ? `${item.cycleMonths} tháng` : 'Không lặp định kỳ';
    }
    document.getElementById('detail-provider').textContent = item.provider || 'Chưa cập nhật';

    // Phone / Hotline button
    const phoneBtnContainer = document.getElementById('detail-phone-container');
    if (item.phone) {
      phoneBtnContainer.innerHTML = `
        <a href="tel:${item.phone}" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition">
          📞 Gọi ${item.phone}
        </a>
      `;
    } else {
      phoneBtnContainer.innerHTML = `<span class="text-slate-500 text-xs">Chưa có số</span>`;
    }

    // Render Cost & Sub-items Section in detail modal
    const costTotalEl = document.getElementById('detail-item-cost');
    const subcostsEl = document.getElementById('detail-item-subcosts');
    const subItems = (item.subItems && item.subItems.length > 0)
      ? item.subItems
      : (logs.length > 0 && logs[0].subItems && logs[0].subItems.length > 0 ? logs[0].subItems : []);
    const totalCost = item.cost || (logs.length > 0 ? (logs[0].totalCost || logs[0].cost) : 0);

    if (costTotalEl) costTotalEl.textContent = this.formatMoney(totalCost);

    if (subcostsEl) {
      if (subItems && subItems.length > 0) {
        subcostsEl.innerHTML = subItems.map(s => `
          <div class="flex items-center justify-between py-1.5 px-3 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-slate-700 font-medium">${this.escapeHtml(s.name)}</span>
            <span class="font-bold text-emerald-700">${this.formatMoney(s.cost)}</span>
          </div>
        `).join('');
      } else if (totalCost > 0) {
        subcostsEl.innerHTML = `
          <div class="flex items-center justify-between py-1.5 px-3 rounded-xl bg-slate-50 border border-slate-200">
            <span class="text-slate-600">Tổng chi phí</span>
            <span class="font-bold text-emerald-700">${this.formatMoney(totalCost)}</span>
          </div>
        `;
      } else {
        subcostsEl.innerHTML = `
          <div class="text-[11px] text-slate-500 flex items-center justify-between py-1">
            <span>Chưa điền chi phí cho mục này</span>
            <button type="button" onclick="app.editSelectedItem()" class="text-purple-600 font-bold hover:underline flex items-center gap-1">
              <span>✏️</span> Điền chi phí
            </button>
          </div>
        `;
      }
    }

    document.getElementById('detail-notes').textContent = item.notes || 'Không có ghi chú thêm.';

    // Device Alarm status & toggle button in detail modal
    const isAlarmOn = item.notifyPhone !== false;
    const alarmBtn = document.getElementById('detail-alarm-toggle-btn');
    const alarmBtnText = document.getElementById('detail-alarm-btn-text');
    const smallAlarmBtn = document.getElementById('detail-small-alarm-btn');
    const alarmIcon = document.getElementById('detail-alarm-icon');
    const alarmDesc = document.getElementById('detail-alarm-desc');

    if (alarmBtn && alarmBtnText) {
      if (isAlarmOn) {
        alarmBtn.className = 'px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition text-xs shrink-0 flex items-center gap-1 shadow-md shadow-purple-600/20 active:scale-95';
        alarmBtnText.textContent = 'Đang bật 🔔';
        if (alarmIcon) {
          alarmIcon.className = 'w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-bold border border-purple-200 shrink-0';
          alarmIcon.textContent = '🔔';
        }
        if (alarmDesc) alarmDesc.textContent = `Chuông máy sẽ reo lúc ${item.dueTime || '08:00'} ngày ${this.formatDateVN(item.dueDate)}`;
      } else {
        alarmBtn.className = 'px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-semibold transition text-xs shrink-0 flex items-center gap-1 border border-slate-200 active:scale-95';
        alarmBtnText.textContent = 'Đang tắt 🔕';
        if (alarmIcon) {
          alarmIcon.className = 'w-8 h-8 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center text-sm font-bold border border-slate-200 shrink-0';
          alarmIcon.textContent = '🔕';
        }
        if (alarmDesc) alarmDesc.textContent = 'Chuông báo của thiết bị đang tắt cho mục này';
      }
    }
    if (smallAlarmBtn) {
      smallAlarmBtn.textContent = isAlarmOn ? '🔔' : '🔕';
      smallAlarmBtn.className = isAlarmOn 
        ? 'p-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-[10px] font-bold border border-purple-200 flex items-center justify-center shadow-xs'
        : 'p-1 bg-slate-50 hover:bg-slate-100 text-slate-400 rounded-lg text-[10px] font-bold border border-slate-200 flex items-center justify-center shadow-xs';
      smallAlarmBtn.title = isAlarmOn ? 'Chuông báo máy: Đang BẬT (Bấm để tắt)' : 'Chuông báo máy: Đang TẮT (Bấm để bật)';
    }

    // Photos
    const photoSection = document.getElementById('detail-photos');
    if (item.photos && item.photos.length > 0) {
      photoSection.innerHTML = `
        <div class="mt-2">
          <div class="relative group cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-slate-900/5 hover:bg-slate-900/10 transition p-2 flex items-center justify-center" onclick="app.openItemPhoto()">
            <img src="${item.photos[0]}" alt="${this.escapeHtml(item.name)}" class="max-h-60 max-w-full object-contain rounded-xl transition duration-200" />
            <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition rounded-2xl">
              <span class="bg-black/75 text-white text-xs px-3.5 py-1.5 rounded-full font-semibold backdrop-blur-sm flex items-center gap-1.5 shadow-lg">
                🔍 Chạm để phóng to
              </span>
            </div>
          </div>
          <div class="flex items-center justify-between mt-2 px-1">
            <span class="text-[11px] text-slate-500">Chạm ảnh để xem toàn màn hình</span>
            <button type="button" onclick="app.openItemPhoto()" class="text-xs text-purple-600 font-bold hover:underline flex items-center gap-1">
              <span>🔍 Phóng to</span>
            </button>
          </div>
        </div>
      `;
    } else {
      photoSection.innerHTML = `<p class="text-xs text-slate-400 italic mt-1">Chưa đính kèm ảnh giấy tờ/hóa đơn.</p>`;
    }

    // Maintenance Logs
    const logList = document.getElementById('detail-log-list');
    if (logs.length === 0) {
      logList.innerHTML = `<p class="text-xs text-slate-400 italic">Chưa có lịch sử bảo dưỡng nào.</p>`;
    } else {
      logList.innerHTML = logs.map(l => {
        const subCount = l.subItems ? l.subItems.length : 0;
        return `
          <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex justify-between items-center text-xs hover:border-purple-300 transition cursor-pointer" onclick="app.showLogDetail('${l.id}')">
            <div>
              <div class="font-bold text-slate-800 flex items-center gap-1.5">
                <span>${this.formatDateVN(l.date)}</span>
                ${subCount > 0 ? `<span class="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">${subCount} khoản con</span>` : ''}
              </div>
              <div class="text-slate-500 text-[11px] truncate max-w-[200px] mt-0.5">${this.escapeHtml(l.notes || 'Hoàn thành định kỳ')}</div>
            </div>
            <div class="text-right">
              <span class="text-emerald-700 font-black text-sm block">${this.formatMoney(l.totalCost || l.cost)}</span>
              <span class="text-[10px] text-purple-600 font-semibold">Xem chi tiết ➜</span>
            </div>
          </div>
        `;
      }).join('');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  closeDetailModal() {
    const modal = document.getElementById('detail-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    this.selectedItem = null;
  }

  // Modal Complete & Expense Breakdown (Bóc tách chi phí con)
  openCompleteModal(itemId) {
    const item = this.items.find(i => i.id === itemId);
    if (!item) return;

    this.completePhotoBase64 = null;
    this.resetCompletePhotoInputs();
    document.getElementById('complete-item-id').value = item.id;
    document.getElementById('complete-item-name').textContent = item.name + (item.cycleMonths ? ` (Chu kỳ: ${item.cycleMonths} tháng)` : '');
    document.getElementById('complete-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('complete-provider').value = item.provider || '';
    document.getElementById('complete-notes').value = '';
    document.getElementById('complete-photo-preview').innerHTML = '';

    const container = document.getElementById('sub-items-container');
    container.innerHTML = '';

    // Add 2 initial rows based on item category
    if (item.category === 'vehicle') {
      this.addSubItemRow('Thay dầu nhớt động cơ', '');
      this.addSubItemRow('Lọc nhớt / Tiền công', '');
    } else if (item.category === 'home') {
      this.addSubItemRow('Vệ sinh / Thay thế linh kiện', '');
      this.addSubItemRow('Tiền công thợ', '');
    } else {
      this.addSubItemRow('Chi phí chính', '');
    }

    this.calculateCompleteTotal();
    toggleModal('complete-modal');
  }

  addSubItemRow(name = '', cost = '') {
    const container = document.getElementById('sub-items-container');
    const row = document.createElement('div');
    row.className = 'sub-item-row flex items-center gap-2';
    row.innerHTML = `
      <input type="text" placeholder="Tên khoản chi con (ví dụ: Thay nhớt, lọc gió...)" value="${this.escapeHtml(name)}" class="sub-name flex-1 bg-slate-50 text-xs text-slate-800 px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-purple-600 focus:bg-white" />
      <input type="text" inputmode="numeric" placeholder="Số tiền ₫" value="${this.formatMoneyString(cost)}" oninput="app.formatCurrencyInput(this); app.calculateCompleteTotal();" onkeyup="app.formatCurrencyInput(this); app.calculateCompleteTotal();" onblur="app.formatCurrencyInput(this); app.calculateCompleteTotal();" class="sub-cost w-32 bg-slate-50 text-xs text-slate-800 px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-purple-600 focus:bg-white font-bold text-purple-700" />
      <button type="button" onclick="this.parentElement.remove(); app.calculateCompleteTotal();" class="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg text-sm transition" title="Xóa dòng này">✕</button>
    `;
    container.appendChild(row);
  }

  calculateCompleteTotal() {
    let total = 0;
    document.querySelectorAll('.sub-cost').forEach(input => {
      total += this.parseMoneyInput(input.value);
    });
    document.getElementById('complete-total-display').textContent = this.formatMoney(total);
    return total;
  }

  handleCompletePhotoUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_DIM = 1200;
        let width = img.width;
        let height = img.height;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        this.completePhotoBase64 = canvas.toDataURL('image/jpeg', 0.85);

        const previewContainer = document.getElementById('complete-photo-preview');
        if (previewContainer) {
          previewContainer.innerHTML = `
            <div class="relative inline-block mt-2 group">
              <img src="${this.completePhotoBase64}" onclick="app.openCurrentCompletePhoto()" class="w-24 h-24 object-cover rounded-xl border-2 border-purple-200 shadow-sm cursor-pointer hover:border-purple-500 transition" title="Bấm xem ảnh lớn" />
              <button type="button" onclick="app.removeCompletePhoto()" class="absolute -top-2 -right-2 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md transition" title="Xóa ảnh này">✕</button>
              <button type="button" onclick="app.openCurrentCompletePhoto()" class="mt-1 text-[11px] text-purple-700 font-semibold flex items-center gap-1 hover:underline">
                <span>🔍 Bấm xem ảnh</span>
              </button>
            </div>
          `;
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  removeCompletePhoto() {
    this.completePhotoBase64 = null;
    const previewContainer = document.getElementById('complete-photo-preview');
    if (previewContainer) previewContainer.innerHTML = '';
    this.resetCompletePhotoInputs();
  }

  resetCompletePhotoInputs() {
    ['complete-photo-camera-input', 'complete-photo-file-input', 'complete-photo-input'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  openCurrentCompletePhoto() {
    if (this.completePhotoBase64) {
      const name = document.getElementById('complete-item-name')?.textContent || 'Hóa đơn bảo dưỡng';
      this.openPhotoViewer(this.completePhotoBase64, name);
    }
  }

  async saveCompleteModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (this._isSavingComplete) return;
    this._isSavingComplete = true;

    const submitBtn = document.getElementById('complete-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
    }

    try {
      const itemId = document.getElementById('complete-item-id').value;
      const item = this.items.find(i => i.id === itemId);
      if (!item) return;

      const date = document.getElementById('complete-date').value || new Date().toISOString().split('T')[0];
      const provider = document.getElementById('complete-provider').value.trim();
      const notes = document.getElementById('complete-notes').value.trim();

      const subItems = [];
      document.querySelectorAll('.sub-item-row').forEach(row => {
        const name = row.querySelector('.sub-name').value.trim();
        const cost = this.parseMoneyInput(row.querySelector('.sub-cost')?.value);
        if (name || cost > 0) {
          subItems.push({ name: name || 'Khoản chi phí', cost });
        }
      });

      const totalCost = subItems.reduce((sum, s) => sum + s.cost, 0);

      const log = {
        id: 'log-' + Date.now(),
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        date,
        totalCost,
        subItems,
        provider: provider || item.provider || '',
        notes,
        photos: this.completePhotoBase64 ? [this.completePhotoBase64] : []
      };

      await this.storage.saveLog(log);

      // Auto-advance due date by cycle
      const cycle = item.cycleMonths || 6;
      const nextDate = new Date(date);
      nextDate.setMonth(nextDate.getMonth() + cycle);
      item.dueDate = nextDate.toISOString().split('T')[0];
      item.updatedAt = new Date().toISOString();

      await this.storage.saveItem(item);
      await this.loadItems();
      await this.loadAllLogs();

      toggleModal('complete-modal');
      await this.render();
      this.showToast('✅ Đã lưu vào Nhật ký bảo dưỡng!');
      alert(`Đã lưu chi phí vào Nhật ký! Hạn lần tới tự động dời sang ngày: ${this.formatDateVN(item.dueDate)}`);
    } catch (err) {
      console.error('Lỗi khi lưu hoàn thành:', err);
      alert('Không thể lưu hoàn thành: ' + (err.message || err));
    } finally {
      this._isSavingComplete = false;
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  // Historical Log Details (Xem chi tiết từng khoản chi con trong quá khứ)
  showLogDetail(logId) {
    const log = this.allLogs.find(l => l.id === logId);
    if (!log) return;
    this.currentViewingLogId = logId;
    this.currentViewingLog = log;

    document.getElementById('log-detail-title').textContent = log.itemName || 'Chi tiết bảo dưỡng';
    document.getElementById('log-detail-date').textContent = `Ngày thực hiện: ${this.formatDateVN(log.date)}`;
    document.getElementById('log-detail-total').textContent = this.formatMoney(log.totalCost || log.cost);
    document.getElementById('log-detail-provider').textContent = log.provider || 'Chưa ghi nơi làm';
    document.getElementById('log-detail-notes').textContent = log.notes || 'Không có ghi chú thêm.';

    const subContainer = document.getElementById('log-detail-subitems');
    if (log.subItems && log.subItems.length > 0) {
      subContainer.innerHTML = log.subItems.map(s => `
        <div class="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
          <span class="text-slate-700 font-medium">${this.escapeHtml(s.name)}</span>
          <span class="text-emerald-700 font-bold">${this.formatMoney(s.cost)}</span>
        </div>
      `).join('');
    } else {
      subContainer.innerHTML = `
        <div class="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
          <span class="text-slate-600 font-medium">Tổng chi phí trọn gói</span>
          <span class="text-emerald-700 font-bold">${this.formatMoney(log.totalCost || log.cost)}</span>
        </div>
      `;
    }

    const photoContainer = document.getElementById('log-detail-photo');
    if (log.photos && log.photos.length > 0) {
      photoContainer.innerHTML = `
        <div class="mt-2">
          <div class="relative group cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-slate-900/5 hover:bg-slate-900/10 transition p-2 flex items-center justify-center" onclick="app.openLogPhoto()">
            <img src="${log.photos[0]}" alt="${this.escapeHtml(log.itemName)}" class="max-h-60 max-w-full object-contain rounded-xl transition duration-200" />
            <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition rounded-2xl">
              <span class="bg-black/75 text-white text-xs px-3.5 py-1.5 rounded-full font-semibold backdrop-blur-sm flex items-center gap-1.5 shadow-lg">
                🔍 Chạm để phóng to
              </span>
            </div>
          </div>
          <div class="flex items-center justify-between mt-2 px-1">
            <span class="text-[11px] text-slate-500">Chạm ảnh để xem toàn màn hình</span>
            <button type="button" onclick="app.openLogPhoto()" class="text-xs text-purple-600 font-bold hover:underline flex items-center gap-1">
              <span>🔍 Phóng to</span>
            </button>
          </div>
        </div>
      `;
    } else {
      photoContainer.innerHTML = `<p class="text-xs text-slate-400 italic mt-1">Không đính kèm ảnh hóa đơn.</p>`;
    }

    toggleModal('log-detail-modal');
  }

  openLogPhoto() {
    if (this.currentViewingLog && this.currentViewingLog.photos && this.currentViewingLog.photos.length > 0) {
      this.openPhotoViewer(this.currentViewingLog.photos[0], `${this.currentViewingLog.itemName || 'Hóa đơn'} - Biên nhận`);
    }
  }

  openItemPhoto() {
    if (this.selectedItem && this.selectedItem.photos && this.selectedItem.photos.length > 0) {
      this.openPhotoViewer(this.selectedItem.photos[0], this.selectedItem.name || 'Ảnh giấy tờ / Phiếu bảo hành');
    }
  }

  // Photo Fullscreen Viewer Lightbox with Zoom & Pan
  openPhotoViewer(photoSrc, title = 'Chi tiết hình ảnh') {
    if (!photoSrc) return;
    const modal = document.getElementById('photo-viewer-modal');
    const imgEl = document.getElementById('photo-viewer-img');
    const titleEl = document.getElementById('photo-viewer-title');
    if (!modal || !imgEl) return;

    this.currentViewingPhotoData = photoSrc;
    this.currentViewingPhotoTitle = title;

    imgEl.src = photoSrc;
    if (titleEl) titleEl.textContent = title;

    // Reset zoom and pan on opening new photo
    this.resetPhotoZoom();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');
  }

  closePhotoViewer() {
    const modal = document.getElementById('photo-viewer-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    const imgEl = document.getElementById('photo-viewer-img');
    if (imgEl) imgEl.src = '';
    this.resetPhotoZoom();
    document.body.classList.remove('overflow-hidden');
  }

  resetPhotoZoom() {
    this.photoZoomScale = 1;
    this.photoPanX = 0;
    this.photoPanY = 0;
    this.isPhotoPanning = false;
    this.applyPhotoTransform();
  }

  setPhotoZoom(scale) {
    this.photoZoomScale = Math.min(Math.max(scale, 1), 4);
    if (this.photoZoomScale === 1) {
      this.photoPanX = 0;
      this.photoPanY = 0;
    }
    this.applyPhotoTransform();
  }

  zoomInPhoto() {
    this.setPhotoZoom(this.photoZoomScale + 0.35);
  }

  zoomOutPhoto() {
    this.setPhotoZoom(this.photoZoomScale - 0.35);
  }

  togglePhotoZoom() {
    if (this.photoZoomScale > 1.05) {
      this.resetPhotoZoom();
    } else {
      this.setPhotoZoom(2.2);
    }
  }

  applyPhotoTransform() {
    const imgEl = document.getElementById('photo-viewer-img');
    const badge = document.getElementById('photo-zoom-level');
    if (imgEl) {
      imgEl.style.transform = `translate(${this.photoPanX}px, ${this.photoPanY}px) scale(${this.photoZoomScale})`;
      imgEl.style.cursor = this.photoZoomScale > 1 ? (this.isPhotoPanning ? 'grabbing' : 'grab') : 'zoom-in';
      imgEl.style.transition = this.isPhotoPanning ? 'none' : 'transform 0.15s ease-out';
    }
    if (badge) {
      badge.textContent = `${Math.round(this.photoZoomScale * 100)}%`;
    }
  }

  downloadCurrentPhoto() {
    if (!this.currentViewingPhotoData) return;
    try {
      const a = document.createElement('a');
      a.href = this.currentViewingPhotoData;
      const cleanTitle = (this.currentViewingPhotoTitle || 'lifekeep-image')
        .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9-]/g, '_');
      a.download = `${cleanTitle}-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      this.showToast('📥 Đang tải ảnh xuống máy...');
    } catch (e) {
      console.error(e);
      window.open(this.currentViewingPhotoData, '_blank');
    }
  }

  // Analytics & Chart.js (Biểu đồ & Thống kê chi tiêu)
  openAnalyticsModal() {
    this.populateAnalyticsPeriodOptions();
    this.renderAnalytics();
    toggleModal('analytics-modal');
  }

  populateAnalyticsPeriodOptions() {
    const periodSelect = document.getElementById('analytics-period');
    if (!periodSelect) return;

    const availableYears = this.getAvailableYears();
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    let html = '';
    // Add all available years
    availableYears.forEach(y => {
      html += `<option value="year-${y}">Cả năm ${y}</option>`;
    });

    // Add relevant months from available years
    availableYears.forEach(y => {
      if (y === this.financeSelectedYear) {
        html += `<option value="month-${this.financeSelectedMonth}-${y}">Tháng ${this.financeSelectedMonth}/${y} (Đang xem)</option>`;
      }
      if (y === currentYear && (this.financeSelectedYear !== currentYear || this.financeSelectedMonth !== currentMonth)) {
        html += `<option value="month-${currentMonth}-${y}">Tháng ${currentMonth}/${y} (Tháng này)</option>`;
      }
    });

    html += `<option value="all">Tất cả từ trước đến nay</option>`;
    periodSelect.innerHTML = html;

    // Default selection matching current finance period
    if (this.financePeriod === 'month') {
      const targetVal = `month-${this.financeSelectedMonth}-${this.financeSelectedYear}`;
      periodSelect.value = targetVal;
      if (!periodSelect.value) periodSelect.value = `year-${this.financeSelectedYear}`;
    } else {
      periodSelect.value = `year-${this.financeSelectedYear}`;
    }
  }

  renderAnalytics() {
    const period = document.getElementById('analytics-period')?.value || `year-${this.financeSelectedYear}`;
    let filteredLogs = [...this.allLogs];
    let chartYear = this.financeSelectedYear;

    if (period.startsWith('year-')) {
      chartYear = parseInt(period.split('-')[1], 10);
      filteredLogs = filteredLogs.filter(l => new Date(l.date).getFullYear() === chartYear);
    } else if (period.startsWith('month-')) {
      const parts = period.split('-');
      const month = parseInt(parts[1], 10);
      chartYear = parseInt(parts[2], 10);
      filteredLogs = filteredLogs.filter(l => {
        const d = new Date(l.date);
        return d.getFullYear() === chartYear && (d.getMonth() + 1) === month;
      });
    }

    // Group by category
    const catTotals = {
      vehicle: 0,
      home: 0,
      identity: 0,
      tech: 0,
      other: 0
    };

    filteredLogs.forEach(l => {
      const cat = l.category || 'other';
      catTotals[cat] = (catTotals[cat] || 0) + (Number(l.totalCost || l.cost) || 0);
    });

    // Also include items with cost if not already in filtered logs
    this.items.forEach(item => {
      const hasLog = filteredLogs.some(l => l.itemId === item.id);
      if (!hasLog && item.cost > 0) {
        const cat = item.category || 'other';
        catTotals[cat] = (catTotals[cat] || 0) + Number(item.cost);
      }
    });

    const totalSpent = Object.values(catTotals).reduce((a, b) => a + b, 0);
    document.getElementById('analytics-total-amount').textContent = this.formatMoney(totalSpent);

    // Render Doughnut Chart
    const ctxDoughnut = document.getElementById('categoryDoughnutChart');
    if (ctxDoughnut && typeof Chart !== 'undefined') {
      if (this.doughnutChart) {
        this.doughnutChart.destroy();
      }
      this.doughnutChart = new Chart(ctxDoughnut, {
        type: 'doughnut',
        data: {
          labels: ['Phương tiện', 'Gia dụng & Nhà', 'Giấy tờ', 'Công nghệ', 'Khác'],
          datasets: [{
            data: [
              catTotals.vehicle,
              catTotals.home,
              catTotals.identity,
              catTotals.tech,
              catTotals.other
            ],
            backgroundColor: [
              '#6366f1', // indigo
              '#10b981', // emerald
              '#f59e0b', // amber
              '#a855f7', // purple
              '#64748b'  // slate
            ],
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const val = context.raw || 0;
                  const pct = totalSpent > 0 ? Math.round((val / totalSpent) * 100) : 0;
                  return ` ${context.label}: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)} (${pct}%)`;
                }
              }
            }
          },
          cutout: '65%'
        }
      });
    }

    // Render Legend & Category Breakdown List
    const catListEl = document.getElementById('analytics-category-list');
    if (catListEl) {
      const cats = [
        { key: 'vehicle', name: '🚗 Phương tiện', color: 'bg-indigo-500', total: catTotals.vehicle },
        { key: 'home', name: '🏠 Gia dụng & Nhà', color: 'bg-emerald-500', total: catTotals.home },
        { key: 'identity', name: '🪪 Giấy tờ cá nhân', color: 'bg-amber-500', total: catTotals.identity },
        { key: 'tech', name: '💻 Công nghệ', color: 'bg-purple-500', total: catTotals.tech },
        { key: 'other', name: '📌 Khác', color: 'bg-slate-500', total: catTotals.other }
      ];

      catListEl.innerHTML = cats.map(c => {
        const pct = totalSpent > 0 ? Math.round((c.total / totalSpent) * 100) : 0;
        return `
          <div class="flex items-center justify-between text-xs py-1">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full ${c.color}"></span>
              <span class="text-slate-700 font-medium">${c.name}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-900">${this.formatMoney(c.total)}</span>
              <span class="text-[11px] text-slate-500 w-9 text-right font-medium">(${pct}%)</span>
            </div>
          </div>
        `;
      }).join('');
    }

    // Render Monthly Bar Chart (12 Months of chartYear)
    const ctxBar = document.getElementById('monthlyBarChart');
    if (ctxBar && typeof Chart !== 'undefined') {
      if (this.barChart) {
        this.barChart.destroy();
      }

      const barChartTitle = document.getElementById('analytics-barchart-title');
      if (barChartTitle) {
        barChartTitle.textContent = `Chi phí 12 tháng năm ${chartYear}`;
      }

      const monthlyData = new Array(12).fill(0);
      this.allLogs.forEach(l => {
        const d = new Date(l.date);
        if (d.getFullYear() === chartYear) {
          monthlyData[d.getMonth()] += (Number(l.totalCost || l.cost) || 0);
        }
      });
      this.items.forEach(item => {
        const hasLog = this.allLogs.some(l => l.itemId === item.id);
        if (!hasLog && item.cost > 0) {
          const d = new Date(item.dueDate || Date.now());
          if (d.getFullYear() === chartYear) {
            monthlyData[d.getMonth()] += Number(item.cost);
          }
        }
      });

      this.barChart = new Chart(ctxBar, {
        type: 'bar',
        data: {
          labels: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'],
          datasets: [{
            label: `Chi tiêu (${chartYear})`,
            data: monthlyData,
            backgroundColor: 'rgba(124, 58, 237, 0.75)',
            hoverBackgroundColor: 'rgba(124, 58, 237, 0.95)',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                color: '#64748b',
                callback: (v) => v >= 1000000 ? (v / 1000000) + 'tr' : (v >= 1000 ? (v / 1000) + 'k' : v)
              },
              grid: { color: 'rgba(0, 0, 0, 0.05)' }
            },
            x: {
              ticks: { color: '#64748b' },
              grid: { display: false }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => ' ' + new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(ctx.raw || 0)
              }
            }
          }
        }
      });
    }
  }

  async deleteItemById(id) {
    const item = this.items.find(i => i.id === id);
    const itemName = item ? item.name : 'mục này';
    if (!confirm(`Bạn có chắc chắn muốn xóa "${itemName}" không? Tất cả nhắc nhở và thông tin liên quan sẽ bị xóa.`)) {
      return;
    }

    try {
      await this.storage.deleteItem(id);
      await this.loadItems();
      await this.loadAllLogs();
      await this.render();
      const itemModal = document.getElementById('item-modal');
      if (itemModal && itemModal.classList.contains('flex')) {
        this.closeModal();
      }
      const detailModal = document.getElementById('detail-modal');
      if (detailModal && detailModal.classList.contains('flex')) {
        this.closeDetailModal();
      }
      this.showToast(`🗑️ Đã xóa "${itemName}"!`);
    } catch (err) {
      console.error('Lỗi khi xóa mục:', err);
      alert('Không thể xóa mục: ' + (err.message || err));
    }
  }

  deleteCurrentEditingItem() {
    const id = document.getElementById('item-id')?.value;
    if (id) {
      this.deleteItemById(id);
    }
  }

  async deleteSelectedItem() {
    if (!this.selectedItem) return;
    await this.deleteItemById(this.selectedItem.id);
  }

  async deleteLogById(logId) {
    const log = this.allLogs.find(l => l.id === logId);
    const logName = log ? (log.itemName || 'bản ghi bảo dưỡng') : 'bản ghi này';
    if (!confirm(`Bạn có chắc chắn muốn xóa "${logName}" khỏi lịch sử và báo cáo không?`)) {
      return;
    }

    try {
      await this.storage.deleteLog(logId);
      await this.loadAllLogs();
      await this.render();
      await this.renderFinance();
      const detailModal = document.getElementById('log-detail-modal');
      if (detailModal && detailModal.classList.contains('flex')) {
        toggleModal('log-detail-modal');
      }
      this.showToast(`🗑️ Đã xóa "${logName}"!`);
    } catch (err) {
      console.error('Lỗi khi xóa lịch sử:', err);
      alert('Không thể xóa lịch sử: ' + (err.message || err));
    }
  }

  deleteCurrentViewingLog() {
    if (this.currentViewingLogId) {
      this.deleteLogById(this.currentViewingLogId);
    }
  }

  editSelectedItem() {
    if (!this.selectedItem) return;
    const itemToEdit = { ...this.selectedItem };
    this.closeDetailModal();
    this.openAddModal(itemToEdit);
  }

  // ================= FINANCIAL MODULE (QUẢN LÝ TÀI CHÍNH, THU NHẬP & CHI TIÊU) =================

  openFinanceModal() {
    this.renderFinance();
    toggleModal('finance-modal');
  }

  setFinancePeriod(period) {
    this.financePeriod = period;
    ['week', 'month', 'year', 'custom', 'all'].forEach(p => {
      const btn = document.getElementById(`finance-tab-${p}`);
      if (btn) {
        if (p === period) {
          btn.className = 'py-1.5 rounded-xl bg-purple-600 text-white font-bold shadow-md shadow-purple-600/30 transition';
        } else {
          btn.className = 'py-1.5 rounded-xl text-slate-500 hover:text-slate-800 font-semibold transition';
        }
      }
    });

    if (period === 'custom') {
      if (!this.financeCustomStartDate) {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        this.financeCustomStartDate = d.toISOString().split('T')[0];
      }
      if (!this.financeCustomEndDate) {
        this.financeCustomEndDate = new Date().toISOString().split('T')[0];
      }
    }

    this.renderFinance();
  }

  setFinanceCustomRange() {
    const startInput = document.getElementById('finance-custom-start');
    const endInput = document.getElementById('finance-custom-end');
    if (startInput && startInput.value) {
      this.financeCustomStartDate = startInput.value;
    }
    if (endInput && endInput.value) {
      this.financeCustomEndDate = endInput.value;
    }
    this.renderFinance();
  }

  setFinanceMonth(month) {
    this.financeSelectedMonth = parseInt(month, 10);
    this.renderFinance();
  }

  setFinanceYear(year) {
    this.financeSelectedYear = parseInt(year, 10);
    this.renderFinance();
  }

  getAvailableYears() {
    const years = new Set();
    const currentYear = new Date().getFullYear();
    years.add(currentYear);
    if (this.heroSelectedYear) {
      years.add(Number(this.heroSelectedYear));
    }
    if (this.financeSelectedYear) {
      years.add(Number(this.financeSelectedYear));
    }

    if (this.transactions && this.transactions.length > 0) {
      this.transactions.forEach(t => {
        if (t.date) {
          const y = new Date(t.date).getFullYear();
          if (!isNaN(y)) years.add(y);
        }
      });
    }

    if (this.allLogs && this.allLogs.length > 0) {
      this.allLogs.forEach(l => {
        if (l.date) {
          const y = new Date(l.date).getFullYear();
          if (!isNaN(y)) years.add(y);
        }
      });
    }

    if (this.items && this.items.length > 0) {
      this.items.forEach(i => {
        if (i.dueDate) {
          const y = new Date(i.dueDate).getFullYear();
          if (!isNaN(y)) years.add(y);
        }
      });
    }

    return Array.from(years).sort((a, b) => b - a);
  }

  setTxFeedFilter(filter) {
    this.txFeedFilter = filter;
    ['all', 'income', 'daily', 'maint'].forEach(f => {
      const btn = document.getElementById(`tx-filter-${f}`);
      if (btn) {
        if (f === filter) {
          btn.className = 'px-3 py-1 rounded-full bg-purple-600 text-white font-bold whitespace-nowrap transition border border-purple-600 shadow-sm';
        } else {
          btn.className = 'px-3 py-1 rounded-full bg-white text-slate-600 hover:text-slate-800 font-medium whitespace-nowrap transition border border-slate-200 shadow-xs';
        }
      }
    });
    const { filteredIncomes, filteredDailyExpenses, filteredMaintLogs } = this.filterFinanceData();
    this.renderFinanceFeed(filteredIncomes, filteredDailyExpenses, filteredMaintLogs);
  }

  filterFinanceData() {
    const period = this.financePeriod;
    const now = new Date();

    const inRange = (dateStr) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;

      if (period === 'all') return true;

      if (period === 'year') {
        return d.getFullYear() === this.financeSelectedYear;
      }

      if (period === 'month') {
        return d.getFullYear() === this.financeSelectedYear && (d.getMonth() + 1) === this.financeSelectedMonth;
      }

      if (period === 'week') {
        const currentDay = now.getDay();
        const diffToMon = (currentDay === 0 ? -6 : 1) - currentDay;
        const mon = new Date(now);
        mon.setDate(now.getDate() + diffToMon);
        mon.setHours(0, 0, 0, 0);

        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        sun.setHours(23, 59, 59, 999);

        return d >= mon && d <= sun;
      }

      if (period === 'custom') {
        const start = this.financeCustomStartDate ? new Date(this.financeCustomStartDate + 'T00:00:00') : new Date('1970-01-01');
        const end = this.financeCustomEndDate ? new Date(this.financeCustomEndDate + 'T23:59:59.999') : new Date('2099-12-31');
        return d >= start && d <= end;
      }

      return true;
    };

    const filteredIncomes = this.transactions.filter(t => t.type === 'income' && inRange(t.date));
    const filteredDailyExpenses = this.transactions.filter(t => t.type === 'expense' && inRange(t.date));
    const filteredMaintLogs = this.allLogs.filter(l => inRange(l.date));

    return { filteredIncomes, filteredDailyExpenses, filteredMaintLogs };
  }

  async renderFinance() {
    const { filteredIncomes, filteredDailyExpenses, filteredMaintLogs } = this.filterFinanceData();

    const totalIncome = filteredIncomes.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalDailyExpense = filteredDailyExpenses.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalMaintExpense = filteredMaintLogs.reduce((sum, l) => sum + (Number(l.totalCost || l.cost) || 0), 0);
    const totalExpense = totalDailyExpense + totalMaintExpense;
    const netBalance = totalIncome - totalExpense;

    // Update KPI Card: Income
    const incomeEl = document.getElementById('finance-total-income');
    const incomeCountEl = document.getElementById('finance-income-count');
    if (incomeEl) incomeEl.textContent = '+' + this.formatMoney(totalIncome);
    if (incomeCountEl) incomeCountEl.textContent = this.t('fin_kpi_income_count', { count: filteredIncomes.length });

    // Update KPI Card: Expense
    const expenseEl = document.getElementById('finance-total-expense');
    const expenseSubEl = document.getElementById('finance-expense-sub');
    if (expenseEl) expenseEl.textContent = '-' + this.formatMoney(totalExpense);
    if (expenseSubEl) {
      expenseSubEl.textContent = `${this.t('fin_breakdown_daily')} ${this.formatMoney(totalDailyExpense)} • ${this.t('fin_breakdown_maint')} ${this.formatMoney(totalMaintExpense)}`;
    }

    // Update Net Balance & Savings Rate
    const balanceEl = document.getElementById('finance-net-balance');
    const badgeEl = document.getElementById('finance-savings-rate-badge');
    if (balanceEl) {
      balanceEl.textContent = (netBalance >= 0 ? '+' : '') + this.formatMoney(netBalance);
      balanceEl.className = `text-xl font-black tracking-tight mt-0.5 block ${netBalance >= 0 ? 'text-purple-700' : 'text-rose-600'}`;
    }
    if (badgeEl) {
      if (totalIncome > 0) {
        const rate = Math.round((netBalance / totalIncome) * 100);
        if (netBalance >= 0) {
          badgeEl.className = 'px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200';
          badgeEl.textContent = this.t('fin_savings_rate', { rate });
        } else {
          badgeEl.className = 'px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200';
          badgeEl.textContent = this.t('fin_deficit_rate', { rate: Math.abs(rate) });
        }
      } else {
        badgeEl.className = 'px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200';
        badgeEl.textContent = this.t('fin_no_income_yet');
      }
    }

    // Dual Progress Bar Breakdown
    const barDaily = document.getElementById('finance-bar-daily');
    const barMaint = document.getElementById('finance-bar-maint');
    const valDaily = document.getElementById('finance-val-daily');
    const valMaint = document.getElementById('finance-val-maint');
    if (totalExpense > 0) {
      const dailyPct = Math.round((totalDailyExpense / totalExpense) * 100);
      const maintPct = 100 - dailyPct;
      if (barDaily) barDaily.style.width = dailyPct + '%';
      if (barMaint) barMaint.style.width = maintPct + '%';
    } else {
      if (barDaily) barDaily.style.width = '50%';
      if (barMaint) barMaint.style.width = '50%';
    }
    if (valDaily) valDaily.textContent = this.formatMoney(totalDailyExpense);
    if (valMaint) valMaint.textContent = this.formatMoney(totalMaintExpense);

    // Render Period Sub-header
    const subHeader = document.getElementById('finance-period-sub');
    if (subHeader) {
      const availableYears = this.getAvailableYears();
      const yearPrefix = this.currentLang === 'en' ? 'Year ' : 'Năm ';
      const monthPrefix = this.currentLang === 'en' ? 'Month ' : 'Tháng ';
      const yearsOptions = availableYears.map(y => `
        <option value="${y}" ${y === this.financeSelectedYear ? 'selected' : ''}>${yearPrefix}${y}</option>
      `).join('');

      if (this.financePeriod === 'month') {
        const monthsOptions = Array.from({ length: 12 }, (_, i) => i + 1).map(m => `
          <option value="${m}" ${m === this.financeSelectedMonth ? 'selected' : ''}>${monthPrefix}${m}</option>
        `).join('');
        subHeader.innerHTML = `
          <div class="flex items-center justify-between w-full flex-wrap gap-2 py-0.5">
            <span class="text-slate-600 font-medium">${this.t('fin_period_label')}</span>
            <div class="flex items-center gap-1.5">
              <select onchange="app.setFinanceMonth(this.value)" class="bg-white text-slate-800 px-2.5 py-1 rounded-xl border border-slate-200 text-xs font-bold focus:outline-none focus:border-purple-600 shadow-xs">
                ${monthsOptions}
              </select>
              <select onchange="app.setFinanceYear(this.value)" class="bg-white text-slate-800 px-2.5 py-1 rounded-xl border border-slate-200 text-xs font-bold focus:outline-none focus:border-purple-600 shadow-xs">
                ${yearsOptions}
              </select>
            </div>
          </div>
        `;
      } else if (this.financePeriod === 'year') {
        subHeader.innerHTML = `
          <div class="flex items-center justify-between w-full py-0.5">
            <span class="text-slate-600 font-medium">${this.t('fin_period_year_report')}</span>
            <select onchange="app.setFinanceYear(this.value)" class="bg-white text-slate-800 px-3 py-1 rounded-xl border border-slate-200 text-xs font-bold focus:outline-none focus:border-purple-600 shadow-xs">
              ${yearsOptions}
            </select>
          </div>
        `;
      } else if (this.financePeriod === 'week') {
        const now = new Date();
        const currentDay = now.getDay();
        const diffToMon = (currentDay === 0 ? -6 : 1) - currentDay;
        const mon = new Date(now);
        mon.setDate(now.getDate() + diffToMon);
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        subHeader.innerHTML = `
          <span class="text-slate-600 font-medium">${this.t('fin_period_current_week')}</span>
          <span class="font-bold text-slate-800">${this.formatDateVN(mon.toISOString().split('T')[0])} - ${this.formatDateVN(sun.toISOString().split('T')[0])}</span>
        `;
      } else if (this.financePeriod === 'custom') {
        subHeader.innerHTML = `
          <div class="flex items-center gap-2 w-full py-0.5">
            <div class="flex-1 flex items-center gap-1.5">
              <span class="text-[10px] text-slate-500 shrink-0 font-medium">${this.t('fin_period_from')}</span>
              <input type="date" id="finance-custom-start" value="${this.financeCustomStartDate}" onchange="app.setFinanceCustomRange()" class="w-full bg-slate-50 text-slate-800 px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-medium focus:outline-none focus:border-purple-600" />
            </div>
            <div class="flex-1 flex items-center gap-1.5">
              <span class="text-[10px] text-slate-500 shrink-0 font-medium">${this.t('fin_period_to')}</span>
              <input type="date" id="finance-custom-end" value="${this.financeCustomEndDate}" onchange="app.setFinanceCustomRange()" class="w-full bg-slate-50 text-slate-800 px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-medium focus:outline-none focus:border-purple-600" />
            </div>
          </div>
        `;
      } else {
        subHeader.innerHTML = `
          <span class="text-slate-600 font-medium">${this.t('fin_period_label')}</span>
          <span class="font-bold text-slate-800">${this.t('fin_period_all_time')}</span>
        `;
      }
    }

    // Render Monthly Budget Card & Starting Balance Displays
    await this.renderMonthlyBudget();
    await this.updateStartingBalanceDisplays();

    // Render Charts & Feed
    this.renderFinanceCharts(totalIncome, totalExpense, filteredIncomes, filteredDailyExpenses, filteredMaintLogs);
    this.renderFinanceFeed(filteredIncomes, filteredDailyExpenses, filteredMaintLogs);
  }

  // ================= MONTHLY BUDGETING MODULE =================

  async renderMonthlyBudget() {
    const titleEl = document.getElementById('finance-budget-title');
    const subTitleEl = document.getElementById('finance-budget-subtitle');
    const limitEl = document.getElementById('finance-budget-limit');
    const spentEl = document.getElementById('finance-budget-spent');
    const remainEl = document.getElementById('finance-budget-remain');
    const remainLabelEl = document.getElementById('finance-budget-remain-label');
    const barEl = document.getElementById('finance-budget-bar');
    const alertEl = document.getElementById('finance-budget-alert');
    const btnTextEl = document.getElementById('finance-budget-btn-text');

    if (!limitEl) return;

    // Determine target month and year
    let targetYear = this.financeSelectedYear;
    let targetMonth = this.financeSelectedMonth;

    if (this.financePeriod === 'month') {
      targetYear = this.financeSelectedYear;
      targetMonth = this.financeSelectedMonth;
    } else {
      const now = new Date();
      targetYear = now.getFullYear();
      targetMonth = now.getMonth() + 1;
    }

    if (titleEl) {
      titleEl.textContent = this.currentLang === 'en' ? `Monthly Budget Limit ${targetMonth}/${targetYear}` : `Hạn mức Ngân sách Tháng ${targetMonth}/${targetYear}`;
    }

    // Calculate actual total spent in this target month (daily expenses + maintenance logs)
    const monthExpenses = this.transactions
      .filter(t => {
        if (t.type !== 'expense' || !t.date) return false;
        const d = new Date(t.date);
        return d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth;
      })
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const monthMaint = this.allLogs
      .filter(l => {
        if (!l.date) return false;
        const d = new Date(l.date);
        return d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth;
      })
      .reduce((sum, l) => sum + (Number(l.totalCost || l.cost) || 0), 0);

    const actualMonthSpent = monthExpenses + monthMaint;

    // Fetch budget from settings
    const budgetKey = `budget_${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    let budgetAmount = await this.storage.getSetting(budgetKey);
    if (!budgetAmount) {
      budgetAmount = await this.storage.getSetting('default_monthly_budget');
    }

    spentEl.textContent = this.formatMoney(actualMonthSpent);

    if (budgetAmount && Number(budgetAmount) > 0) {
      const budget = Number(budgetAmount);
      limitEl.textContent = this.formatMoney(budget);
      if (btnTextEl) btnTextEl.textContent = this.t('fin_budget_btn_edit');

      const remain = budget - actualMonthSpent;
      const pct = Math.round((actualMonthSpent / budget) * 100);

      if (barEl) {
        barEl.style.width = Math.min(pct, 100) + '%';
      }

      if (remain >= 0) {
        remainLabelEl.textContent = this.t('fin_budget_remain_label');
        remainEl.textContent = this.formatMoney(remain);
        remainEl.className = 'text-emerald-700 font-bold';

        if (pct >= 80) {
          if (barEl) barEl.className = 'h-full rounded-full transition-all duration-500 bg-amber-500';
          if (alertEl) {
            alertEl.className = 'text-[11px] p-2 rounded-xl text-center font-bold bg-amber-50 text-amber-800 border border-amber-200 block';
            alertEl.textContent = this.currentLang === 'en' ? `⚠️ Warning: Spent ${pct}% of monthly budget, only ${this.formatMoney(remain)} remaining!` : `⚠️ Chú ý: Đã chi ${pct}% ngân sách tháng, chỉ còn ${this.formatMoney(remain)}!`;
          }
        } else {
          if (barEl) barEl.className = 'h-full rounded-full transition-all duration-500 bg-purple-600';
          if (alertEl) alertEl.className = 'hidden';
        }
      } else {
        remainLabelEl.textContent = this.t('fin_budget_over_label');
        remainEl.textContent = '-' + this.formatMoney(Math.abs(remain));
        remainEl.className = 'text-rose-600 font-black';

        if (barEl) barEl.className = 'h-full rounded-full transition-all duration-500 bg-rose-500 animate-pulse';
        if (alertEl) {
          alertEl.className = 'text-[11px] p-2 rounded-xl text-center font-bold bg-rose-50 text-rose-700 border border-rose-200 block';
          alertEl.textContent = this.currentLang === 'en' ? `🚨 ALERT: Spent ${pct}% - Over budget by ${this.formatMoney(Math.abs(remain))}!` : `🚨 CẢNH BÁO: Đã tiêu ${pct}% - Vượt ngân sách ${this.formatMoney(Math.abs(remain))}!`;
        }
      }
    } else {
      limitEl.textContent = this.t('not_set');
      remainLabelEl.textContent = this.t('fin_budget_remain_label');
      remainEl.textContent = '-- ₫';
      remainEl.className = 'text-slate-400 font-bold';
      if (btnTextEl) btnTextEl.textContent = this.t('fin_budget_btn_set');
      if (barEl) {
        barEl.style.width = '0%';
        barEl.className = 'h-full rounded-full transition-all duration-500 bg-purple-600';
      }
      if (alertEl) alertEl.className = 'hidden';
    }
  }

  async openBudgetModal() {
    const modal = document.getElementById('budget-modal');
    let targetYear = this.financeSelectedYear;
    let targetMonth = this.financeSelectedMonth;

    if (this.financePeriod !== 'month') {
      const now = new Date();
      targetYear = now.getFullYear();
      targetMonth = now.getMonth() + 1;
    }

    const monthDisplay = document.getElementById('budget-month-display');
    if (monthDisplay) {
      monthDisplay.textContent = this.currentLang === 'en' ? `Month ${targetMonth}/${targetYear}` : `Tháng ${targetMonth}/${targetYear}`;
    }

    const budgetKey = `budget_${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    let currentBudget = await this.storage.getSetting(budgetKey);
    if (!currentBudget) {
      currentBudget = await this.storage.getSetting('default_monthly_budget');
    }

    this.setFormattedAmount('budget-amount-input', currentBudget || '');

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  async saveBudget(e) {
    if (e && e.preventDefault) e.preventDefault();
    try {
      let targetYear = this.financeSelectedYear;
      let targetMonth = this.financeSelectedMonth;

      if (this.financePeriod !== 'month') {
        const now = new Date();
        targetYear = now.getFullYear();
        targetMonth = now.getMonth() + 1;
      }

      const amount = this.parseMoneyInput(document.getElementById('budget-amount-input').value);
      if (isNaN(amount) || amount <= 0) {
        alert(this.t('budget_alert_invalid_amount') || 'Vui lòng nhập số tiền ngân sách hợp lệ!');
        return;
      }

      const isDefault = document.getElementById('budget-set-default')?.checked;
      const budgetKey = `budget_${targetYear}-${String(targetMonth).padStart(2, '0')}`;

      await this.storage.saveSetting(budgetKey, amount);
      if (isDefault) {
        await this.storage.saveSetting('default_monthly_budget', amount);
      }

      toggleModal('budget-modal');
      await this.renderFinance();
      this.showToast(this.t('toast_save_budget_success', { amount: this.formatMoney(amount) }) || '🎯 Đã lưu hạn mức ngân sách!');
    } catch (err) {
      console.error('Lỗi khi lưu hạn mức ngân sách:', err);
      alert('Không thể lưu hạn mức: ' + (err.message || err));
    }
  }

  async clearBudget() {
    let targetYear = this.financeSelectedYear;
    let targetMonth = this.financeSelectedMonth;

    if (this.financePeriod !== 'month') {
      const now = new Date();
      targetYear = now.getFullYear();
      targetMonth = now.getMonth() + 1;
    }

    const confirmMsg = this.currentLang === 'en'
      ? `Delete budget limit for Month ${targetMonth}/${targetYear}?`
      : `Xóa hạn mức ngân sách của Tháng ${targetMonth}/${targetYear}?`;
    if (!confirm(confirmMsg)) return;

    try {
      const budgetKey = `budget_${targetYear}-${String(targetMonth).padStart(2, '0')}`;
      await this.storage.deleteSetting(budgetKey);

      toggleModal('budget-modal');
      await this.renderFinance();
      this.showToast(this.t('toast_clear_budget_success') || '🗑️ Đã xóa hạn mức ngân sách!');
    } catch (err) {
      console.error('Lỗi khi xóa hạn mức:', err);
      alert('Không thể xóa hạn mức: ' + (err.message || err));
    }
  }

  // ================= STARTING BALANCE (SỐ DƯ GỐC BAN ĐẦU) =================

  async openStartingBalanceModal() {
    let currentVal = 0;
    try {
      const val = await this.storage.getSetting('initial_starting_balance');
      if (val !== null && val !== undefined && val !== '') {
        currentVal = Number(val) || 0;
      }
    } catch (e) {
      console.warn('Cannot load starting balance:', e);
    }

    this.setFormattedAmount('starting-balance-input', currentVal > 0 ? currentVal : '');
    const modal = document.getElementById('starting-balance-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
    const input = document.getElementById('starting-balance-input');
    if (input) {
      setTimeout(() => {
        input.focus();
        if (input.select) input.select();
      }, 150);
    }
  }

  closeStartingBalanceModal() {
    const modal = document.getElementById('starting-balance-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  setQuickStartingBalance(amount) {
    this.setFormattedAmount('starting-balance-input', amount);
  }

  async saveStartingBalance(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('starting-balance-input');
    if (!input) return;

    const raw = (input.value || '').replace(/\D/g, '');
    const amount = Number(raw) || 0;

    try {
      await this.storage.saveSetting('initial_starting_balance', amount);
      this.closeStartingBalanceModal();
      await this.updateStartingBalanceDisplays();
      this.showToast(this.t('toast_save_sb_success', { amount: this.formatMoney(amount) }) || ('✅ Đã lưu số dư gốc ban đầu: ' + this.formatMoney(amount)));
    } catch (err) {
      console.error('Lỗi khi lưu số dư gốc:', err);
      alert('Không thể lưu số dư gốc: ' + (err.message || err));
    }
  }

  async updateStartingBalanceDisplays() {
    let startingBalance = 0;
    try {
      const val = await this.storage.getSetting('initial_starting_balance');
      if (val !== null && val !== undefined && val !== '') {
        startingBalance = Number(val) || 0;
      }
    } catch (e) {
      console.warn('Cannot load initial_starting_balance:', e);
    }

    // Calculate all-time figures
    const allTxs = this.transactions || [];
    const allLogs = this.allLogs || [];

    const totalIncome = allTxs
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const totalDailyExpense = allTxs
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const totalMaintExpense = allLogs
      .reduce((sum, l) => sum + (Number(l.totalCost || l.cost) || 0), 0);

    const totalExpense = totalDailyExpense + totalMaintExpense;
    const currentBalance = startingBalance + totalIncome - totalExpense;

    let spentPct = 0;
    let originRemain = 0;
    if (startingBalance > 0) {
      spentPct = Math.min(100, Math.round((totalExpense / startingBalance) * 100));
      originRemain = Math.max(0, startingBalance - totalExpense);
    }

    // 1. Update Home Golden Finance Card
    const homeStartEl = document.getElementById('home-starting-balance');
    const homeStartHint = document.getElementById('home-starting-balance-hint');
    const homeCurrEl = document.getElementById('home-current-balance');
    const homeCurrSub = document.getElementById('home-current-balance-sub');
    const homeSpentEl = document.getElementById('home-spent-from-origin');
    const homeProgressBar = document.getElementById('home-spent-progress-bar');
    const homeRemainText = document.getElementById('home-origin-remain-text');

    if (homeStartEl) {
      if (startingBalance > 0) {
        homeStartEl.textContent = this.formatMoney(startingBalance);
        if (homeStartHint) homeStartHint.textContent = this.t('home_fin_starting_init');
      } else {
        homeStartEl.textContent = '0 ₫';
        if (homeStartHint) homeStartHint.textContent = this.t('home_fin_starting_unset');
      }
    }

    if (homeCurrEl) {
      homeCurrEl.textContent = this.formatMoney(currentBalance);
      if (homeCurrSub) {
        homeCurrSub.textContent = `(${this.currentLang === 'en' ? 'Base + In ' : 'Gốc + Thu '}${this.formatMoney(totalIncome)} - ${this.currentLang === 'en' ? 'Out ' : 'Chi '}${this.formatMoney(totalExpense)})`;
      }
    }

    if (homeSpentEl) {
      if (startingBalance > 0) {
        const rawPct = Math.round((totalExpense / startingBalance) * 100);
        homeSpentEl.textContent = `${this.formatMoney(totalExpense)} (${rawPct}%)`;
      } else {
        homeSpentEl.textContent = `${this.formatMoney(totalExpense)} (${this.currentLang === 'en' ? 'No initial' : 'Chưa đặt gốc'})`;
      }
    }

    if (homeProgressBar) {
      homeProgressBar.style.width = `${spentPct}%`;
      if (startingBalance > 0 && totalExpense > startingBalance) {
        homeProgressBar.className = 'h-full rounded-full transition-all duration-500 bg-rose-600 animate-pulse';
      } else {
        homeProgressBar.className = 'h-full rounded-full transition-all duration-500 bg-rose-600';
      }
    }

    if (homeRemainText) {
      if (startingBalance > 0) {
        if (totalExpense <= startingBalance) {
          homeRemainText.textContent = this.t('home_fin_origin_remain', { amount: this.formatMoney(originRemain) });
        } else {
          homeRemainText.textContent = this.t('home_fin_origin_over', { amount: this.formatMoney(totalExpense - startingBalance) });
        }
      } else {
        homeRemainText.textContent = this.t('home_fin_click_set');
      }
    }

    // 2. Update Finance Modal Golden Starting Balance Card
    const modalStartEl = document.getElementById('modal-starting-balance');
    const modalStartHint = document.getElementById('modal-starting-balance-hint');
    const modalCurrEl = document.getElementById('modal-current-balance');
    const modalSpentEl = document.getElementById('modal-spent-from-origin');
    const modalProgressBar = document.getElementById('modal-spent-progress-bar');
    const modalRemainText = document.getElementById('modal-origin-remain-text');
    const modalIncomeAdded = document.getElementById('modal-income-added-text');

    if (modalStartEl) {
      if (startingBalance > 0) {
        modalStartEl.textContent = this.formatMoney(startingBalance);
        if (modalStartHint) modalStartHint.textContent = this.t('fin_sb_hint');
      } else {
        modalStartEl.textContent = '0 ₫';
        if (modalStartHint) modalStartHint.textContent = this.t('home_fin_starting_unset');
      }
    }

    if (modalCurrEl) {
      modalCurrEl.textContent = this.formatMoney(currentBalance);
    }

    if (modalSpentEl) {
      if (startingBalance > 0) {
        const rawPct = Math.round((totalExpense / startingBalance) * 100);
        modalSpentEl.textContent = `${this.formatMoney(totalExpense)} (${rawPct}%)`;
      } else {
        modalSpentEl.textContent = `${this.formatMoney(totalExpense)} (${this.currentLang === 'en' ? 'No initial' : 'Chưa đặt gốc'})`;
      }
    }

    if (modalProgressBar) {
      modalProgressBar.style.width = `${spentPct}%`;
    }

    if (modalRemainText) {
      if (startingBalance > 0) {
        if (totalExpense <= startingBalance) {
          modalRemainText.textContent = this.t('home_fin_origin_remain', { amount: this.formatMoney(originRemain) });
        } else {
          modalRemainText.textContent = this.t('home_fin_origin_over', { amount: this.formatMoney(totalExpense - startingBalance) });
        }
      } else {
        modalRemainText.textContent = this.currentLang === 'en' ? 'Initial balance not set' : 'Chưa nhập số dư gốc';
      }
    }

    if (modalIncomeAdded) {
      modalIncomeAdded.textContent = this.t('fin_income_added', { amount: this.formatMoney(totalIncome) });
    }
  }

  // ================= CHARTS & DATA VISUALIZATION =================

  renderFinanceCharts(totalIncome, totalExpense, filteredIncomes, filteredDailyExpenses, filteredMaintLogs) {
    if (typeof Chart === 'undefined') return;

    // 1. Dual Bar Chart: Income vs Expense Comparison
    const ctxBar = document.getElementById('financeComparisonChart');
    if (ctxBar) {
      if (this.financeComparisonChart) {
        this.financeComparisonChart.destroy();
      }

      let labels = [];
      let incomeData = [];
      let expenseData = [];

      if (this.financePeriod === 'week') {
        labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
        incomeData = new Array(7).fill(0);
        expenseData = new Array(7).fill(0);

        const now = new Date();
        const currentDay = now.getDay();
        const diffToMon = (currentDay === 0 ? -6 : 1) - currentDay;
        const mon = new Date(now);
        mon.setDate(now.getDate() + diffToMon);
        mon.setHours(0, 0, 0, 0);

        filteredIncomes.forEach(t => {
          const d = new Date(t.date);
          const dayIndex = (d.getDay() + 6) % 7;
          if (dayIndex >= 0 && dayIndex < 7) incomeData[dayIndex] += Number(t.amount) || 0;
        });

        filteredDailyExpenses.forEach(t => {
          const d = new Date(t.date);
          const dayIndex = (d.getDay() + 6) % 7;
          if (dayIndex >= 0 && dayIndex < 7) expenseData[dayIndex] += Number(t.amount) || 0;
        });

        filteredMaintLogs.forEach(l => {
          const d = new Date(l.date);
          const dayIndex = (d.getDay() + 6) % 7;
          if (dayIndex >= 0 && dayIndex < 7) expenseData[dayIndex] += Number(l.totalCost || l.cost) || 0;
        });
      } else if (this.financePeriod === 'month') {
        labels = ['Tuần 1 (1-7)', 'Tuần 2 (8-14)', 'Tuần 3 (15-21)', 'Tuần 4 (22-cuối)'];
        incomeData = new Array(4).fill(0);
        expenseData = new Array(4).fill(0);

        const getWeekIdx = (dateStr) => {
          const day = new Date(dateStr).getDate();
          if (day <= 7) return 0;
          if (day <= 14) return 1;
          if (day <= 21) return 2;
          return 3;
        };

        filteredIncomes.forEach(t => {
          incomeData[getWeekIdx(t.date)] += Number(t.amount) || 0;
        });
        filteredDailyExpenses.forEach(t => {
          expenseData[getWeekIdx(t.date)] += Number(t.amount) || 0;
        });
        filteredMaintLogs.forEach(l => {
          expenseData[getWeekIdx(l.date)] += Number(l.totalCost || l.cost) || 0;
        });
      } else if (this.financePeriod === 'custom') {
        const start = new Date(this.financeCustomStartDate || new Date());
        const end = new Date(this.financeCustomEndDate || new Date());
        const diffDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);

        if (diffDays <= 14) {
          labels = [];
          incomeData = [];
          expenseData = [];
          const cur = new Date(start);
          for (let i = 0; i < diffDays; i++) {
            const dateStr = cur.toISOString().split('T')[0];
            const parts = dateStr.split('-');
            labels.push(`${parts[2]}/${parts[1]}`);

            const inc = filteredIncomes.filter(t => t.date === dateStr).reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const expDaily = filteredDailyExpenses.filter(t => t.date === dateStr).reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const expMaint = filteredMaintLogs.filter(l => l.date === dateStr).reduce((s, l) => s + (Number(l.totalCost || l.cost) || 0), 0);

            incomeData.push(inc);
            expenseData.push(expDaily + expMaint);
            cur.setDate(cur.getDate() + 1);
          }
        } else if (diffDays <= 60) {
          const numWeeks = Math.ceil(diffDays / 7);
          labels = Array.from({ length: numWeeks }, (_, i) => `Tuần ${i + 1}`);
          incomeData = new Array(numWeeks).fill(0);
          expenseData = new Array(numWeeks).fill(0);

          const getWeekBin = (dStr) => {
            const d = new Date(dStr);
            const offset = Math.floor((d - start) / (1000 * 60 * 60 * 24 * 7));
            return Math.min(Math.max(0, offset), numWeeks - 1);
          };

          filteredIncomes.forEach(t => { incomeData[getWeekBin(t.date)] += Number(t.amount) || 0; });
          filteredDailyExpenses.forEach(t => { expenseData[getWeekBin(t.date)] += Number(t.amount) || 0; });
          filteredMaintLogs.forEach(l => { expenseData[getWeekBin(l.date)] += Number(l.totalCost || l.cost) || 0; });
        } else {
          const monthMap = new Map();
          const cur = new Date(start);
          while (cur <= end || (cur.getMonth() === end.getMonth() && cur.getFullYear() === end.getFullYear())) {
            const key = `T${cur.getMonth() + 1}/${cur.getFullYear()}`;
            if (!monthMap.has(key)) {
              monthMap.set(key, { inc: 0, exp: 0 });
            }
            cur.setMonth(cur.getMonth() + 1);
          }

          filteredIncomes.forEach(t => {
            const d = new Date(t.date);
            const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
            if (monthMap.has(key)) monthMap.get(key).inc += Number(t.amount) || 0;
          });
          filteredDailyExpenses.forEach(t => {
            const d = new Date(t.date);
            const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
            if (monthMap.has(key)) monthMap.get(key).exp += Number(t.amount) || 0;
          });
          filteredMaintLogs.forEach(l => {
            const d = new Date(l.date);
            const key = `T${d.getMonth() + 1}/${d.getFullYear()}`;
            if (monthMap.has(key)) monthMap.get(key).exp += Number(l.totalCost || l.cost) || 0;
          });

          labels = Array.from(monthMap.keys());
          incomeData = Array.from(monthMap.values()).map(v => v.inc);
          expenseData = Array.from(monthMap.values()).map(v => v.exp);
        }
      } else {
        // Year or All Time
        if (this.financePeriod === 'all') {
          // Compare across all available years
          const allYears = this.getAvailableYears().sort((a, b) => a - b);
          const yearMap = new Map();
          allYears.forEach(y => {
            yearMap.set(String(y), { inc: 0, exp: 0 });
          });

          filteredIncomes.forEach(t => {
            const y = String(new Date(t.date).getFullYear());
            if (yearMap.has(y)) yearMap.get(y).inc += Number(t.amount) || 0;
          });
          filteredDailyExpenses.forEach(t => {
            const y = String(new Date(t.date).getFullYear());
            if (yearMap.has(y)) yearMap.get(y).exp += Number(t.amount) || 0;
          });
          filteredMaintLogs.forEach(l => {
            const y = String(new Date(l.date).getFullYear());
            if (yearMap.has(y)) yearMap.get(y).exp += Number(l.totalCost || l.cost) || 0;
          });

          labels = Array.from(yearMap.keys()).map(y => `Năm ${y}`);
          incomeData = Array.from(yearMap.values()).map(v => v.inc);
          expenseData = Array.from(yearMap.values()).map(v => v.exp);
        } else {
          // 12 Months of the selected year (this.financeSelectedYear)
          labels = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
          incomeData = new Array(12).fill(0);
          expenseData = new Array(12).fill(0);

          filteredIncomes.forEach(t => {
            const d = new Date(t.date);
            if (d.getFullYear() === this.financeSelectedYear) {
              const m = d.getMonth();
              if (m >= 0 && m < 12) incomeData[m] += Number(t.amount) || 0;
            }
          });
          filteredDailyExpenses.forEach(t => {
            const d = new Date(t.date);
            if (d.getFullYear() === this.financeSelectedYear) {
              const m = d.getMonth();
              if (m >= 0 && m < 12) expenseData[m] += Number(t.amount) || 0;
            }
          });
          filteredMaintLogs.forEach(l => {
            const d = new Date(l.date);
            if (d.getFullYear() === this.financeSelectedYear) {
              const m = d.getMonth();
              if (m >= 0 && m < 12) expenseData[m] += Number(l.totalCost || l.cost) || 0;
            }
          });
        }
      }

      // Update Chart Title
      const chartTitleEl = document.getElementById('finance-comparison-title');
      if (chartTitleEl) {
        if (this.financePeriod === 'year') {
          chartTitleEl.textContent = `Diễn biến Thu & Chi năm ${this.financeSelectedYear}`;
        } else if (this.financePeriod === 'month') {
          chartTitleEl.textContent = `Diễn biến Tháng ${this.financeSelectedMonth}/${this.financeSelectedYear}`;
        } else if (this.financePeriod === 'all') {
          chartTitleEl.textContent = 'Diễn biến So sánh các Năm';
        } else {
          chartTitleEl.textContent = 'Diễn biến Thu nhập & Chi tiêu';
        }
      }

      this.financeComparisonChart = new Chart(ctxBar, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Thu nhập',
              data: incomeData,
              backgroundColor: 'rgba(16, 185, 129, 0.85)',
              borderRadius: 6
            },
            {
              label: 'Chi tiêu',
              data: expenseData,
              backgroundColor: 'rgba(124, 58, 237, 0.85)',
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                color: '#64748b',
                callback: (v) => v >= 1000000 ? (v / 1000000) + 'tr' : (v >= 1000 ? (v / 1000) + 'k' : v)
              },
              grid: { color: 'rgba(0, 0, 0, 0.05)' }
            },
            x: {
              ticks: { color: '#64748b' },
              grid: { display: false }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(ctx.raw || 0)}`
              }
            }
          }
        }
      });
    }

    // 2. Comprehensive Expense Doughnut Chart
    const ctxDoughnut = document.getElementById('financeExpenseDoughnutChart');
    if (ctxDoughnut) {
      if (this.financeDoughnutChart) {
        this.financeDoughnutChart.destroy();
      }

      const allCats = this.getAllCategories();
      const catMap = {};

      // Seed standard categories
      allCats.forEach(c => {
        catMap[c.id] = { name: c.name, icon: c.icon || '📦', color: '#10b981', total: 0 };
      });
      // Ensure maintenance & fallback categories exist
      catMap['vehicle'] = { name: 'Bảo dưỡng Xe', icon: '🚗', color: '#6366f1', total: 0 };
      catMap['home'] = { name: 'Gia dụng & Lọc nước', icon: '🏠', color: '#14b8a6', total: 0 };
      catMap['identity'] = { name: 'Giấy tờ & Bảo hiểm', icon: '🪪', color: '#ec4899', total: 0 };
      catMap['tech'] = { name: 'Đồ công nghệ', icon: '💻', color: '#a855f7', total: 0 };
      catMap['other'] = { name: 'Chi tiêu khác', icon: '📦', color: '#64748b', total: 0 };

      // Palette
      const palette = ['#7c3aed', '#10b981', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899', '#f43f5e', '#14b8a6', '#f59e0b', '#64748b'];
      Object.keys(catMap).forEach((k, idx) => {
        catMap[k].color = palette[idx % palette.length];
      });

      filteredDailyExpenses.forEach(t => {
        const c = t.category || 'other';
        if (catMap[c]) catMap[c].total += (Number(t.amount) || 0);
        else {
          catMap[c] = { name: t.categoryName || 'Chi khác', icon: '📦', color: '#64748b', total: Number(t.amount) || 0 };
        }
      });

      filteredMaintLogs.forEach(l => {
        const c = l.category;
        if (catMap[c]) catMap[c].total += (Number(l.totalCost || l.cost) || 0);
        else catMap.other.total += (Number(l.totalCost || l.cost) || 0);
      });

      const activeCats = Object.values(catMap).filter(c => c.total > 0);
      activeCats.sort((a, b) => b.total - a.total);

      const doughnutLabels = activeCats.length > 0 ? activeCats.map(c => `${c.icon} ${c.name}`) : ['Chưa có chi tiêu'];
      const doughnutData = activeCats.length > 0 ? activeCats.map(c => c.total) : [1];
      const doughnutColors = activeCats.length > 0 ? activeCats.map(c => c.color) : ['#e2e8f0'];

      this.financeDoughnutChart = new Chart(ctxDoughnut, {
        type: 'doughnut',
        data: {
          labels: doughnutLabels,
          datasets: [{
            data: doughnutData,
            backgroundColor: doughnutColors,
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const val = ctx.raw || 0;
                  const pct = totalExpense > 0 ? Math.round((val / totalExpense) * 100) : 0;
                  return ` ${ctx.label}: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val)} (${pct}%)`;
                }
              }
            }
          },
          cutout: '65%'
        }
      });

      // Breakdown Legend List
      const breakdownEl = document.getElementById('finance-category-breakdown');
      if (breakdownEl) {
        if (activeCats.length === 0) {
          breakdownEl.innerHTML = `<p class="text-slate-400 italic text-center py-2">Chưa phát sinh chi tiêu trong kỳ này.</p>`;
        } else {
          breakdownEl.innerHTML = activeCats.map(c => {
            const pct = totalExpense > 0 ? Math.round((c.total / totalExpense) * 100) : 0;
            return `
              <div class="flex items-center justify-between text-xs py-1">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${c.color}"></span>
                  <span class="text-slate-700 font-medium">${c.icon} ${c.name}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-slate-900">${this.formatMoney(c.total)}</span>
                  <span class="text-[11px] text-slate-500 w-9 text-right font-medium">(${pct}%)</span>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }
  }

  renderFinanceFeed(filteredIncomes, filteredDailyExpenses, filteredMaintLogs) {
    const listEl = document.getElementById('finance-tx-list');
    if (!listEl) return;

    let items = [];
    const allCats = this.getAllCategories();

    if (this.txFeedFilter === 'all' || this.txFeedFilter === 'income') {
      filteredIncomes.forEach(t => {
        const catObj = allCats.find(c => c.id === t.category);
        const displayName = this.getCategoryDisplayName(t.category, t.categoryName || (catObj ? catObj.name : 'Thu nhập'));
        items.push({
          id: t.id,
          source: 'tx',
          type: 'income',
          amount: t.amount,
          date: t.date,
          title: displayName,
          notes: t.notes || '',
          icon: catObj ? catObj.icon : '💼',
          badgeText: this.currentLang === 'en' ? 'Income' : 'Thu nhập',
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200'
        });
      });
    }

    if (this.txFeedFilter === 'all' || this.txFeedFilter === 'daily') {
      filteredDailyExpenses.forEach(t => {
        const catObj = allCats.find(c => c.id === t.category);
        const displayName = this.getCategoryDisplayName(t.category, t.categoryName || (catObj ? catObj.name : 'Chi tiêu sinh hoạt'));
        items.push({
          id: t.id,
          source: 'tx',
          type: 'expense',
          amount: t.amount,
          date: t.date,
          title: displayName,
          notes: t.notes || '',
          icon: catObj ? catObj.icon : '🛍️',
          badgeText: this.currentLang === 'en' ? 'Daily Living' : 'Hàng ngày',
          badgeClass: 'bg-rose-50 text-rose-700 border-rose-200'
        });
      });
    }

    if (this.txFeedFilter === 'all' || this.txFeedFilter === 'maint') {
      filteredMaintLogs.forEach(l => {
        const catMeta = this.getCategoryMeta(l.category);
        const subCount = l.subItems ? l.subItems.length : 0;
        items.push({
          id: l.id,
          source: 'log',
          type: 'maint',
          amount: l.totalCost || l.cost || 0,
          date: l.date,
          title: l.itemName || (this.currentLang === 'en' ? 'Maintenance / Docs' : 'Bảo dưỡng / Giấy tờ'),
          notes: (l.provider ? `${this.currentLang === 'en' ? 'Provider:' : 'Nơi làm:'} ${l.provider} • ` : '') + (subCount > 0 ? `${subCount} ${this.t('sub_items_count', { count: subCount })}` : (l.notes || '')),
          icon: catMeta ? catMeta.icon : '🔧',
          badgeText: this.currentLang === 'en' ? 'Task Cost' : 'Nhắc việc',
          badgeClass: 'bg-purple-50 text-purple-700 border-purple-200'
        });
      });
    }

    items.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (items.length === 0) {
      listEl.innerHTML = `
        <div class="text-center py-8 bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div class="text-3xl mb-1.5">🪙</div>
          <p class="text-slate-800 font-bold text-xs">${this.t('fin_feed_empty_title')}</p>
          <p class="text-[11px] text-slate-500 mt-0.5">${this.t('fin_feed_empty_desc')}</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = items.map(item => {
      const isIncome = item.type === 'income';
      const amountStr = (isIncome ? '+' : '-') + this.formatMoney(item.amount);
      const amountColor = isIncome ? 'text-emerald-700 font-black' : 'text-slate-900 font-black';

      return `
        <div class="p-3 rounded-2xl bg-white border border-slate-200/90 hover:border-purple-300 transition flex items-center justify-between gap-3 shadow-xs">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-lg shrink-0">
              ${item.icon}
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${item.badgeClass}">
                  ${item.badgeText}
                </span>
                <span class="text-[11px] text-slate-500 font-medium">${this.formatDateVN(item.date)}</span>
              </div>
              <h4 class="font-bold text-slate-800 text-xs truncate mt-0.5">${this.escapeHtml(item.title)}</h4>
              ${item.notes ? `<p class="text-[11px] text-slate-500 truncate mt-0.5 max-w-[190px]">${this.escapeHtml(item.notes)}</p>` : ''}
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-xs ${amountColor}">${amountStr}</div>
            <div class="flex items-center justify-end gap-1 mt-1">
              ${item.source === 'tx' ? `
                <button type="button" onclick="app.editTx('${item.id}')" class="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-lg text-xs" title="Sửa">✏️</button>
                <button type="button" onclick="app.deleteTx('${item.id}')" class="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg text-xs" title="Xóa">🗑️</button>
              ` : `
                <button type="button" onclick="app.showLogDetail('${item.id}')" class="text-[10px] text-purple-600 hover:underline font-bold">${this.t('hero_btn_detail')} ➜</button>
                <button type="button" onclick="app.deleteLogById('${item.id}')" class="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg text-xs ml-1" title="Xóa">🗑️</button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ================= CATEGORY MANAGEMENT =================

  getIncomeCategories() {
    const custom = (this.customCategories || []).filter(c => c.type === 'income');
    return [...INCOME_CATEGORIES, ...custom];
  }

  getExpenseCategories() {
    const custom = (this.customCategories || []).filter(c => c.type === 'expense');
    return [...EXPENSE_CATEGORIES, ...custom];
  }

  getAllCategories() {
    return [...this.getIncomeCategories(), ...this.getExpenseCategories()];
  }

  populateTxCategoryOptions(selectedCategory = null) {
    const select = document.getElementById('tx-category');
    if (!select) return;

    const list = this.txFormType === 'income' ? this.getIncomeCategories() : this.getExpenseCategories();
    select.innerHTML = list.map(c => `
      <option value="${c.id}" ${c.id === selectedCategory ? 'selected' : ''}>${c.icon} ${this.getCategoryDisplayName(c.id, c.name)}</option>
    `).join('');
  }

  openCategoryModal() {
    this.renderCategoryLists();
    toggleModal('category-modal');
  }

  renderCategoryLists() {
    const expContainer = document.getElementById('category-list-expense');
    const incContainer = document.getElementById('category-list-income');

    if (expContainer) {
      const expList = this.getExpenseCategories();
      expContainer.innerHTML = expList.map(c => {
        const isBuiltIn = EXPENSE_CATEGORIES.some(b => b.id === c.id);
        const displayName = this.getCategoryDisplayName(c.id, c.name);
        return `
          <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
            <span class="flex items-center gap-2">
              <span class="text-base">${c.icon}</span>
              <span class="text-slate-800 font-semibold">${this.escapeHtml(displayName)}</span>
            </span>
            ${isBuiltIn ? 
              `<span class="text-[10px] text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full font-medium">${this.t('cat_default_badge') || 'Mặc định'}</span>` :
              `<button type="button" onclick="app.deleteCustomCategory('${c.id}')" class="text-slate-400 hover:text-rose-600 p-1 text-xs">🗑️</button>`
            }
          </div>
        `;
      }).join('');
    }

    if (incContainer) {
      const incList = this.getIncomeCategories();
      incContainer.innerHTML = incList.map(c => {
        const isBuiltIn = INCOME_CATEGORIES.some(b => b.id === c.id);
        const displayName = this.getCategoryDisplayName(c.id, c.name);
        return `
          <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
            <span class="flex items-center gap-2">
              <span class="text-base">${c.icon}</span>
              <span class="text-slate-800 font-semibold">${this.escapeHtml(displayName)}</span>
            </span>
            ${isBuiltIn ? 
              `<span class="text-[10px] text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full font-medium">${this.t('cat_default_badge') || 'Mặc định'}</span>` :
              `<button type="button" onclick="app.deleteCustomCategory('${c.id}')" class="text-slate-400 hover:text-rose-600 p-1 text-xs">🗑️</button>`
            }
          </div>
        `;
      }).join('');
    }
  }

  async addNewCustomCategory() {
    const type = document.getElementById('new-cat-type').value;
    const icon = document.getElementById('new-cat-icon').value.trim() || '🏷️';
    const name = document.getElementById('new-cat-name').value.trim();

    if (!name) {
      alert(this.t('cat_alert_empty_name') || 'Vui lòng nhập tên danh mục!');
      return;
    }

    const newCat = {
      id: 'custom-cat-' + Date.now(),
      type,
      name,
      icon
    };

    await this.storage.saveCustomCategory(newCat);
    this.customCategories.push(newCat);
    document.getElementById('new-cat-name').value = '';
    this.renderCategoryLists();
    this.populateTxCategoryOptions();
    this.showToast(this.t('toast_add_cat_success') || '🏷️ Đã thêm danh mục mới!');
  }

  async deleteCustomCategory(id) {
    if (!confirm(this.t('cat_confirm_delete') || 'Bạn có chắc muốn xóa danh mục tùy chỉnh này?')) return;
    await this.storage.deleteCustomCategory(id);
    this.customCategories = this.customCategories.filter(c => c.id !== id);
    this.renderCategoryLists();
    this.populateTxCategoryOptions();
    this.showToast(this.t('toast_delete_cat_success') || '🗑️ Đã xóa danh mục!');
  }

  // ================= EXCEL / CSV REPORT EXPORT =================

  openExportCsvModal() {
    toggleModal('export-csv-modal');
  }

  csvEscape(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  exportTransactionsCSV(onlyCurrentPeriod = false) {
    let incomes = [];
    let expenses = [];
    let maintLogs = [];

    if (onlyCurrentPeriod) {
      const filtered = this.filterFinanceData();
      incomes = filtered.filteredIncomes;
      expenses = filtered.filteredDailyExpenses;
      maintLogs = filtered.filteredMaintLogs;
    } else {
      incomes = this.transactions.filter(t => t.type === 'income');
      expenses = this.transactions.filter(t => t.type === 'expense');
      maintLogs = this.allLogs;
    }

    const allRecords = [];
    const allCats = this.getAllCategories();

    incomes.forEach(t => {
      const cat = allCats.find(c => c.id === t.category);
      allRecords.push({
        date: t.date,
        type: 'Thu nhập',
        category: (cat ? cat.name : (t.categoryName || t.category)),
        amount: Number(t.amount) || 0,
        source: 'Thu nhập',
        notes: t.notes || ''
      });
    });

    expenses.forEach(t => {
      const cat = allCats.find(c => c.id === t.category);
      allRecords.push({
        date: t.date,
        type: 'Chi tiêu',
        category: (cat ? cat.name : (t.categoryName || t.category)),
        amount: Number(t.amount) || 0,
        source: 'Sinh hoạt hàng ngày',
        notes: t.notes || ''
      });
    });

    maintLogs.forEach(l => {
      const catMeta = this.getCategoryMeta(l.category);
      const subItemsStr = (l.subItems && l.subItems.length > 0) ?
        l.subItems.map(s => `${s.name}: ${s.cost}đ`).join('; ') : '';
      allRecords.push({
        date: l.date,
        type: 'Chi tiêu',
        category: catMeta.name + ' - ' + (l.itemName || 'Bảo dưỡng'),
        amount: Number(l.totalCost || l.cost) || 0,
        source: 'Bảo dưỡng / Giấy tờ LifeKeep',
        notes: (l.provider ? `Nơi làm: ${l.provider}. ` : '') + (l.notes || '') + (subItemsStr ? ` (${subItemsStr})` : '')
      });
    });

    allRecords.sort((a, b) => new Date(b.date) - new Date(a.date));

    // CSV Header with UTF-8 BOM
    let csvContent = '\uFEFF';
    csvContent += 'STT,Ngay,Loai,Danh muc,So tien (VND),Nguon chi,Ghi chu\r\n';

    allRecords.forEach((r, idx) => {
      const row = [
        idx + 1,
        this.csvEscape(r.date),
        this.csvEscape(r.type),
        this.csvEscape(r.category),
        r.amount,
        this.csvEscape(r.source),
        this.csvEscape(r.notes)
      ];
      csvContent += row.join(',') + '\r\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().split('T')[0];
    a.download = `LifeKeep-Bao-cao-Thu-Chi-${onlyCurrentPeriod ? 'Ky-loc' : 'Toan-bo'}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  exportMaintenanceLogsCSV() {
    const logs = [...this.allLogs].sort((a, b) => new Date(b.date) - new Date(a.date));

    let csvContent = '\uFEFF';
    csvContent += 'STT,Ngay thuc hien,Ten muc / Thiet bi,Danh muc,Tong chi phi (VND),Boc tach chi phi con,Noi thuc hien / Gara,Ghi chu\r\n';

    logs.forEach((l, idx) => {
      const catMeta = this.getCategoryMeta(l.category);
      const subItemsStr = (l.subItems && l.subItems.length > 0) ?
        l.subItems.map(s => `${s.name}: ${s.cost}đ`).join('; ') : '';
      const total = Number(l.totalCost || l.cost) || 0;

      const row = [
        idx + 1,
        this.csvEscape(l.date),
        this.csvEscape(l.itemName || ''),
        this.csvEscape(catMeta.name),
        total,
        this.csvEscape(subItemsStr),
        this.csvEscape(l.provider || ''),
        this.csvEscape(l.notes || '')
      ];
      csvContent += row.join(',') + '\r\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().split('T')[0];
    a.download = `LifeKeep-Lich-su-Bao-duong-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ================= TRANSACTION CRUD =================

  openTxModal(txToEdit = null) {
    const modal = document.getElementById('tx-modal');
    const title = document.getElementById('tx-modal-title');
    const form = document.getElementById('tx-form');

    form.reset();

    if (txToEdit) {
      this.editingTxId = txToEdit.id;
      title.textContent = this.t('tx_modal_edit_title');
      document.getElementById('tx-id').value = txToEdit.id;
      this.setFormattedAmount('tx-amount', txToEdit.amount);
      document.getElementById('tx-date').value = txToEdit.date;
      document.getElementById('tx-notes').value = txToEdit.notes || '';
      this.setTxFormType(txToEdit.type || 'expense');
      this.populateTxCategoryOptions(txToEdit.category);
    } else {
      this.editingTxId = null;
      title.textContent = this.t('tx_modal_title');
      document.getElementById('tx-id').value = '';
      document.getElementById('tx-amount').value = '';
      document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('tx-notes').value = '';
      this.setTxFormType('expense');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  setTxFormType(type) {
    this.txFormType = type;
    const btnExpense = document.getElementById('tx-type-expense');
    const btnIncome = document.getElementById('tx-type-income');
    const amountInput = document.getElementById('tx-amount');

    if (type === 'income') {
      if (btnIncome) btnIncome.className = 'py-2.5 rounded-xl bg-emerald-600 text-white font-bold shadow-md shadow-emerald-600/30 transition flex items-center justify-center gap-1.5';
      if (btnExpense) btnExpense.className = 'py-2.5 rounded-xl text-slate-500 hover:text-slate-800 font-semibold transition flex items-center justify-center gap-1.5';
      if (amountInput) amountInput.className = 'w-full bg-slate-50 text-lg font-black text-emerald-700 px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-purple-600 focus:bg-white';
    } else {
      if (btnExpense) btnExpense.className = 'py-2.5 rounded-xl bg-purple-600 text-white font-bold shadow-md shadow-purple-600/30 transition flex items-center justify-center gap-1.5';
      if (btnIncome) btnIncome.className = 'py-2.5 rounded-xl text-slate-500 hover:text-slate-800 font-semibold transition flex items-center justify-center gap-1.5';
      if (amountInput) amountInput.className = 'w-full bg-slate-50 text-lg font-black text-slate-900 px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-purple-600 focus:bg-white';
    }

    this.populateTxCategoryOptions();
  }

  async saveTxFromForm(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (this._isSavingTx) return;

    try {
      const id = this.editingTxId || 'tx-' + Date.now();
      const type = this.txFormType;
      const amount = this.parseMoneyInput(document.getElementById('tx-amount').value);
      if (isNaN(amount) || amount <= 0) {
        alert(this.t('tx_alert_invalid_amount') || 'Vui lòng nhập số tiền hợp lệ!');
        return;
      }
      const category = document.getElementById('tx-category').value;
      const date = document.getElementById('tx-date').value || new Date().toISOString().split('T')[0];
      const notes = document.getElementById('tx-notes').value.trim();

      // Guard flag to prevent duplicate submissions
      this._isSavingTx = true;
      const submitBtn = document.getElementById('tx-submit-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = this.currentLang === 'en' ? 'Saving...' : 'Đang lưu...';
      }

      // Close modal IMMEDIATELY so user sees it closed and does not double-click!
      const txModal = document.getElementById('tx-modal');
      if (txModal) {
        txModal.classList.add('hidden');
        txModal.classList.remove('flex');
      }

      const allCats = this.getAllCategories();
      const catObj = allCats.find(c => c.id === category);
      const categoryName = catObj ? catObj.name : 'Khác';

      const tx = {
        id,
        type,
        category,
        categoryName,
        amount,
        date,
        notes,
        updatedAt: new Date().toISOString()
      };

      await this.storage.saveTransaction(tx);
      await this.loadTransactions();

      // Auto-align current report year and month to the transaction date
      const txDateObj = new Date(date);
      if (!isNaN(txDateObj.getTime())) {
        const txYear = txDateObj.getFullYear();
        this.financeSelectedYear = txYear;
        this.financeSelectedMonth = txDateObj.getMonth() + 1;
        this.heroSelectedYear = txYear;
        localStorage.setItem('lifekeep_hero_year', this.heroSelectedYear);
      }

      await this.renderFinance();
      await this.render();
      this.showToast(this.t('toast_save_tx_success') || '💰 Đã lưu giao dịch thành công!');
    } catch (err) {
      console.error('Lỗi khi lưu giao dịch:', err);
      alert('Không thể lưu giao dịch: ' + (err.message || err));
    } finally {
      this._isSavingTx = false;
      const submitBtn = document.getElementById('tx-submit-btn');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = this.t('tx_submit_btn') || 'Lưu giao dịch';
      }
    }
  }

  editTx(id) {
    const tx = this.transactions.find(t => t.id === id);
    if (tx) {
      this.openTxModal(tx);
    }
  }

  async deleteTx(id) {
    if (!confirm(this.t('tx_confirm_delete') || 'Bạn có chắc chắn muốn xóa giao dịch này không?')) return;
    try {
      await this.storage.deleteTransaction(id);
      await this.loadTransactions();
      await this.renderFinance();
      await this.render();
      this.showToast(this.t('toast_delete_tx_success') || '🗑️ Đã xóa giao dịch!');
    } catch (err) {
      console.error('Lỗi khi xóa giao dịch:', err);
      alert('Không thể xóa giao dịch: ' + (err.message || err));
    }
  }

  // ================= BACKUP & RESTORE =================

  async exportBackup() {
    const items = await this.storage.getAllItems();
    const logs = await this.storage.getAllLogs();
    const customTemplates = await this.storage.getCustomTemplates();
    const transactions = await this.storage.getAllTransactions();
    const customCategories = await this.storage.getCustomCategories();
    const settings = await this.storage.getAllSettings();
    const notes = await this.storage.getAllNotes();

    const data = {
      appName: 'LifeKeep',
      version: 5,
      exportDate: new Date().toISOString(),
      items,
      logs,
      customTemplates,
      transactions,
      customCategories,
      settings,
      notes
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifekeep-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.items) {
        alert('File không hợp lệ!');
        return;
      }

      if (confirm(`Tìm thấy ${data.items.length} mục trong bản sao lưu. Bạn có muốn khôi phục không?`)) {
        await this.storage.importData(data);
        await this.loadItems();
        await this.loadTransactions();
        await this.loadNotes();
        this.customCategories = await this.storage.getCustomCategories();
        await this.renderTemplates();
        await this.render();
        alert('Khôi phục dữ liệu thành công!');
      }
    } catch (err) {
      alert('Lỗi đọc file: ' + err.message);
    }
  }

  initEventListeners() {
    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim();
        this.render();
      });
    }

    // Category Tabs
    document.querySelectorAll('.cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-pill').forEach(b => {
          b.className = 'cat-pill px-3.5 py-1.5 rounded-full bg-white text-slate-600 hover:text-slate-900 hover:border-purple-300 whitespace-nowrap transition border border-slate-200 shadow-xs flex items-center gap-1.5 font-medium';
        });
        btn.className = 'cat-pill px-3.5 py-1.5 rounded-full bg-purple-600 text-white shadow-md shadow-purple-600/30 whitespace-nowrap transition border border-purple-600 flex items-center gap-1.5 font-semibold';
        this.currentCategory = btn.dataset.category;
        this.render();
      });
    });

    // User gesture listener to permanently unlock AudioContext for background alarm chimes
    const unlockAudio = () => {
      this.initAudioContext();
      document.removeEventListener('pointerdown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('pointerdown', unlockAudio, { passive: true });
    document.addEventListener('touchstart', unlockAudio, { passive: true });
    document.addEventListener('click', unlockAudio, { passive: true });

    // Wakeup & check alarms immediately when unlocking phone screen or switching back to app
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.initAudioContext();
        this.checkDueAlarms();
      }
    });
    window.addEventListener('focus', () => {
      this.initAudioContext();
      this.checkDueAlarms();
    });

    // File input for photo (Camera and File picker)
    ['photo-camera-input', 'photo-file-input', 'photo-input'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => this.handlePhotoUpload(e));
      }
    });

    // Complete photo upload (Camera and File picker)
    ['complete-photo-camera-input', 'complete-photo-file-input', 'complete-photo-input'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => this.handleCompletePhotoUpload(e));
      }
    });

    // Close photo viewer and notification center on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closePhotoViewer();
        this.toggleNotificationCenter(false);
      }
    });

    // Photo Viewer Zoom & Pan Interaction (Mouse Wheel & Mobile Pinch/Drag)
    const photoViewport = document.getElementById('photo-viewer-viewport');
    const photoImg = document.getElementById('photo-viewer-img');
    if (photoViewport && photoImg) {
      // Double click / Double tap to toggle zoom
      photoImg.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.togglePhotoZoom();
      });

      // Mouse wheel zoom
      photoViewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.3 : -0.3;
        this.setPhotoZoom(this.photoZoomScale + delta);
      }, { passive: false });

      // Mouse drag/pan when zoomed
      photoImg.addEventListener('mousedown', (e) => {
        if (this.photoZoomScale <= 1) return;
        e.preventDefault();
        this.isPhotoPanning = true;
        this.photoPanStartX = e.clientX - this.photoPanX;
        this.photoPanStartY = e.clientY - this.photoPanY;
        this.applyPhotoTransform();
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isPhotoPanning) return;
        e.preventDefault();
        this.photoPanX = e.clientX - this.photoPanStartX;
        this.photoPanY = e.clientY - this.photoPanStartY;
        this.applyPhotoTransform();
      });

      window.addEventListener('mouseup', () => {
        if (this.isPhotoPanning) {
          this.isPhotoPanning = false;
          this.applyPhotoTransform();
        }
      });

      // Mobile Touch: 2-finger Pinch-to-zoom & 1-finger Pan & Double-tap
      let lastTap = 0;
      photoViewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          this.initialPinchDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          this.initialPinchScale = this.photoZoomScale;
        } else if (e.touches.length === 1) {
          const currentTime = new Date().getTime();
          const tapLength = currentTime - lastTap;
          if (tapLength < 300 && tapLength > 0) {
            this.togglePhotoZoom();
            e.preventDefault();
          }
          lastTap = currentTime;

          if (this.photoZoomScale > 1) {
            this.isPhotoPanning = true;
            this.photoPanStartX = e.touches[0].clientX - this.photoPanX;
            this.photoPanStartY = e.touches[0].clientY - this.photoPanY;
          }
        }
      }, { passive: false });

      photoViewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && this.initialPinchDistance > 0) {
          e.preventDefault();
          const currentDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          const factor = currentDistance / this.initialPinchDistance;
          this.setPhotoZoom(this.initialPinchScale * factor);
        } else if (e.touches.length === 1 && this.isPhotoPanning) {
          e.preventDefault();
          this.photoPanX = e.touches[0].clientX - this.photoPanStartX;
          this.photoPanY = e.touches[0].clientY - this.photoPanStartY;
          this.applyPhotoTransform();
        }
      }, { passive: false });

      photoViewport.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
          this.initialPinchDistance = 0;
        }
        if (e.touches.length === 0) {
          this.isPhotoPanning = false;
          this.applyPhotoTransform();
        }
      });
    }
  }

  // ================= USER AUTHENTICATION & ACCESS GATE =================

  initAuth() {
    this.currentUser = this.checkAuthSession();
    if (this.currentUser) {
      this.hideAuthScreen();
      this.updateUserUI();
    } else {
      this.showAuthScreen();
      this.updateUserUI();
    }
  }

  checkAuthSession() {
    try {
      const sessionStr = localStorage.getItem('lifekeep_auth_session') || sessionStorage.getItem('lifekeep_auth_session');
      if (!sessionStr) return null;
      const user = JSON.parse(sessionStr);
      if (user && user.name === 'Đặng Long') {
        user.name = user.email ? user.email.split('@')[0] : 'User';
        this.setAuthSession(user, true);
      }
      return user;
    } catch (e) {
      console.warn('Lỗi đọc phiên đăng nhập:', e);
      return null;
    }
  }

  showAuthScreen() {
    const screen = document.getElementById('auth-screen');
    if (screen) {
      screen.classList.remove('hidden');
      screen.classList.add('flex');
    }
  }

  hideAuthScreen() {
    const screen = document.getElementById('auth-screen');
    if (screen) {
      screen.classList.add('hidden');
      screen.classList.remove('flex');
    }
  }

  toggleAuthMode(targetMode) {
    this.authMode = targetMode || (this.authMode === 'login' ? 'register' : 'login');
    const isRegister = this.authMode === 'register';

    const nameGroup = document.getElementById('auth-name-group');
    const confirmGroup = document.getElementById('auth-confirm-group');
    const optionsRow = document.getElementById('auth-options-row');
    const titleEl = document.getElementById('auth-title');
    const subtitleEl = document.getElementById('auth-subtitle');
    const submitText = document.getElementById('auth-submit-text');
    const switchText = document.getElementById('auth-switch-text');
    const switchBtn = document.getElementById('auth-switch-btn');
    const nameInput = document.getElementById('auth-name');
    const confirmInput = document.getElementById('auth-confirm-password');

    this.clearAuthAlert();

    if (isRegister) {
      if (nameGroup) nameGroup.classList.remove('hidden');
      if (confirmGroup) confirmGroup.classList.remove('hidden');
      if (optionsRow) optionsRow.classList.add('hidden');
      if (titleEl) titleEl.textContent = 'Tạo tài khoản mới';
      if (subtitleEl) subtitleEl.textContent = 'Đăng ký để bảo mật thông tin trên LifeKeep';
      if (submitText) submitText.textContent = 'Đăng ký tài khoản';
      if (switchText) switchText.textContent = 'Đã có tài khoản?';
      if (switchBtn) switchBtn.textContent = 'Đăng nhập ngay';
      if (nameInput) nameInput.required = true;
      if (confirmInput) confirmInput.required = true;
    } else {
      if (nameGroup) nameGroup.classList.add('hidden');
      if (confirmGroup) confirmGroup.classList.add('hidden');
      if (optionsRow) optionsRow.classList.remove('hidden');
      if (titleEl) titleEl.textContent = 'Chào mừng trở lại';
      if (subtitleEl) subtitleEl.textContent = 'Đăng nhập tài khoản để tiếp tục sử dụng';
      if (submitText) submitText.textContent = 'Đăng nhập';
      if (switchText) switchText.textContent = 'Chưa có tài khoản?';
      if (switchBtn) switchBtn.textContent = 'Đăng ký ngay';
      if (nameInput) nameInput.required = false;
      if (confirmInput) confirmInput.required = false;
    }
  }

  toggleAuthPasswordVisibility(fieldId, btnEl) {
    const input = document.getElementById(fieldId);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    if (btnEl) {
      btnEl.innerHTML = isPassword 
        ? `<svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/></svg>`
        : `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>`;
    }
  }

  async hashPassword(password) {
    if (window.crypto && window.crypto.subtle) {
      try {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {}
    }
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return 'h_' + Math.abs(hash);
  }

  getRegisteredAccounts() {
    try {
      const accounts = JSON.parse(localStorage.getItem('lifekeep_accounts') || '[]');
      let changed = false;
      accounts.forEach(a => {
        if (a && a.name === 'Đặng Long') {
          a.name = a.email ? a.email.split('@')[0] : 'User';
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem('lifekeep_accounts', JSON.stringify(accounts));
      }
      return accounts;
    } catch (e) {
      return [];
    }
  }

  saveRegisteredAccounts(accounts) {
    localStorage.setItem('lifekeep_accounts', JSON.stringify(accounts));
  }

  showAuthAlert(message, type = 'error') {
    const alertEl = document.getElementById('auth-alert');
    if (!alertEl) return;
    alertEl.className = type === 'error'
      ? 'mb-4 p-3 rounded-2xl text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700 shadow-xs animate-in shake'
      : 'mb-4 p-3 rounded-2xl text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 shadow-xs';
    alertEl.innerHTML = message;
    alertEl.classList.remove('hidden');
  }

  clearAuthAlert() {
    const alertEl = document.getElementById('auth-alert');
    if (alertEl) {
      alertEl.classList.add('hidden');
      alertEl.innerHTML = '';
    }
  }

  async handleAuthSubmit(event) {
    event.preventDefault();
    this.clearAuthAlert();

    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const rememberCheckbox = document.getElementById('auth-remember');
    const identifier = (emailInput ? emailInput.value : '').trim();
    const password = (passwordInput ? passwordInput.value : '').trim();
    const rememberMe = rememberCheckbox ? rememberCheckbox.checked : true;

    if (!identifier || !password) {
      this.showAuthAlert('Vui lòng điền đầy đủ tài khoản và mật khẩu!');
      return;
    }

    const accounts = this.getRegisteredAccounts();

    if (this.authMode === 'login') {
      const hashedPass = await this.hashPassword(password);
      const matchedUser = accounts.find(acc => 
        (acc.email.toLowerCase() === identifier.toLowerCase() || (acc.username && acc.username.toLowerCase() === identifier.toLowerCase())) 
        && acc.passwordHash === hashedPass
      );

      if (!matchedUser) {
        if (accounts.length === 0) {
          this.showAuthAlert('Chưa có tài khoản nào được tạo. Hãy nhấn "Đăng ký ngay" bên dưới hoặc Đăng nhập nhanh bằng Gmail!');
        } else {
          this.showAuthAlert('Sai tài khoản hoặc mật khẩu! Vui lòng kiểm tra lại.');
        }
        return;
      }

      this.setAuthSession(matchedUser, rememberMe);
      this.currentUser = matchedUser;
      this.hideAuthScreen();
      await this.switchUserAccount(matchedUser);
      this.showToast(`🎉 Xin chào, ${matchedUser.name || matchedUser.email}!`);
      if (emailInput) emailInput.value = '';
      if (passwordInput) passwordInput.value = '';
    } else {
      const nameInput = document.getElementById('auth-name');
      const confirmInput = document.getElementById('auth-confirm-password');
      const name = (nameInput ? nameInput.value : '').trim();
      const confirmPassword = (confirmInput ? confirmInput.value : '').trim();

      if (!name) {
        this.showAuthAlert('Vui lòng nhập họ và tên của bạn!');
        return;
      }
      if (password.length < 4) {
        this.showAuthAlert('Mật khẩu cần tối thiểu 4 ký tự!');
        return;
      }
      if (password !== confirmPassword) {
        this.showAuthAlert('Mật khẩu xác nhận không khớp! Vui lòng nhập lại.');
        return;
      }

      const isTaken = accounts.some(acc => acc.email.toLowerCase() === identifier.toLowerCase());
      if (isTaken) {
        this.showAuthAlert('Tài khoản hoặc Email này đã tồn tại! Vui lòng dùng tên khác.');
        return;
      }

      const hashedPass = await this.hashPassword(password);
      const newUser = {
        id: 'usr_' + Date.now(),
        name: name,
        email: identifier,
        passwordHash: hashedPass,
        provider: 'local',
        createdAt: new Date().toISOString()
      };

      accounts.push(newUser);
      this.saveRegisteredAccounts(accounts);
      this.setAuthSession(newUser, true);
      this.currentUser = newUser;
      this.hideAuthScreen();
      await this.switchUserAccount(newUser);
      this.showToast(`🎉 Đăng ký thành công! Chào mừng ${newUser.name}`);
      if (nameInput) nameInput.value = '';
      if (emailInput) emailInput.value = '';
      if (passwordInput) passwordInput.value = '';
      if (confirmInput) confirmInput.value = '';
    }
  }

  setAuthSession(user, rememberMe = true) {
    const sessionData = JSON.stringify(user);
    if (rememberMe) {
      localStorage.setItem('lifekeep_auth_session', sessionData);
      sessionStorage.removeItem('lifekeep_auth_session');
    } else {
      sessionStorage.setItem('lifekeep_auth_session', sessionData);
      localStorage.removeItem('lifekeep_auth_session');
    }
  }

  loginWithGoogle() {
    this.renderGoogleAccountChooser();
    
    // Always open the Google Account Chooser modal so user can choose their Gmail account
    const modal = document.getElementById('google-auth-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  renderGoogleAccountChooser() {
    const listContainer = document.getElementById('google-accounts-list-container');
    const listEl = document.getElementById('google-accounts-list');
    const emailInput = document.getElementById('google-email-input');
    const nameInput = document.getElementById('google-name-input');
    if (!listEl) return;

    // Collect all registered/remembered Google & Gmail accounts on this device
    const accounts = this.getRegisteredAccounts();
    const lastEmail = localStorage.getItem('lifekeep_last_google_email');
    const knownGoogleAccounts = [];

    // The device's active Gmail from user's current Google session
    const detectedGmail = 'longdt.vncb@gmail.com';

    // Find any existing account for detectedGmail
    const detectedMatch = accounts.find(a => a.email && a.email.toLowerCase() === detectedGmail.toLowerCase());
    const detectedName = detectedMatch && detectedMatch.name && detectedMatch.name !== 'Đặng Long'
      ? detectedMatch.name
      : detectedGmail.split('@')[0];

    knownGoogleAccounts.push({
      email: detectedGmail,
      name: detectedName,
      isCurrent: true
    });

    // Check if there was another recently used Google account
    if (lastEmail && lastEmail.toLowerCase() !== detectedGmail.toLowerCase()) {
      const match = accounts.find(a => a.email && a.email.toLowerCase() === lastEmail.toLowerCase());
      const accName = match && match.name && match.name !== 'Đặng Long' ? match.name : lastEmail.split('@')[0];
      knownGoogleAccounts.push({
        email: lastEmail.toLowerCase(),
        name: accName,
        isCurrent: false
      });
    }

    // Add other registered Google / Gmail accounts on this browser
    accounts.forEach(a => {
      if (a.email && (a.provider === 'google' || a.email.toLowerCase().endsWith('@gmail.com'))) {
        if (!knownGoogleAccounts.some(k => k.email.toLowerCase() === a.email.toLowerCase())) {
          const accName = a.name && a.name !== 'Đặng Long' ? a.name : a.email.split('@')[0];
          knownGoogleAccounts.push({
            email: a.email.toLowerCase(),
            name: accName,
            isCurrent: false
          });
        }
      }
    });

    // Pre-fill form with active Gmail
    if (emailInput) {
      emailInput.value = lastEmail || detectedGmail;
    }
    if (nameInput) {
      const matchedPrimary = knownGoogleAccounts.find(k => k.email.toLowerCase() === (emailInput ? emailInput.value.toLowerCase() : detectedGmail.toLowerCase()));
      nameInput.value = (matchedPrimary && matchedPrimary.name && matchedPrimary.name !== detectedGmail.split('@')[0]) ? matchedPrimary.name : '';
    }

    if (listContainer) {
      listContainer.classList.remove('hidden');
    }

    listEl.innerHTML = knownGoogleAccounts.map(acc => {
      const initial = (acc.name || acc.email || 'G').charAt(0).toUpperCase();
      return `
        <button 
          type="button" 
          onclick="app.selectGoogleAccount('${acc.email}', '${acc.name.replace(/'/g, "\\'")}')" 
          class="w-full flex items-center gap-3.5 p-3 rounded-2xl border border-slate-200/90 hover:border-purple-500 hover:bg-purple-50/60 transition text-left group bg-white shadow-xs active:scale-[0.99] cursor-pointer"
        >
          <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 text-white font-black flex items-center justify-center text-sm shadow-sm ring-2 ring-purple-100 shrink-0">
            ${initial}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-bold text-xs text-slate-800 group-hover:text-purple-700 truncate flex items-center gap-1.5">
              <span>${acc.name}</span>
              ${acc.isCurrent ? '<span class="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">Trên thiết bị</span>' : ''}
            </div>
            <div class="text-[11px] text-slate-500 truncate">${acc.email}</div>
          </div>
          <div class="text-xs text-purple-600 font-bold flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-xl bg-purple-50 group-hover:bg-purple-600 group-hover:text-white transition">
            <span>Đăng nhập</span>
            <svg class="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
          </div>
        </button>
      `;
    }).join('');
  }

  async selectGoogleAccount(email, name) {
    if (!email || !email.includes('@')) return;
    email = email.trim().toLowerCase();
    
    // Sanitize name: no hardcoded fake names, fallback to email prefix if blank
    if (!name || name === 'Đặng Long' || name.trim() === '') {
      const accounts = this.getRegisteredAccounts();
      const existing = accounts.find(a => a.email && a.email.toLowerCase() === email);
      if (existing && existing.name && existing.name !== 'Đặng Long') {
        name = existing.name;
      } else {
        name = email.split('@')[0];
      }
    }
    name = name.trim();

    const googleUser = {
      id: 'google_' + btoa(email).replace(/=/g, ''),
      name: name,
      email: email,
      provider: 'google',
      avatar: 'google',
      loggedAt: new Date().toISOString()
    };

    const accounts = this.getRegisteredAccounts();
    const existingIdx = accounts.findIndex(a => a.email.toLowerCase() === googleUser.email);
    if (existingIdx >= 0) {
      accounts[existingIdx].name = googleUser.name;
      accounts[existingIdx].provider = 'google';
    } else {
      accounts.push(googleUser);
    }
    this.saveRegisteredAccounts(accounts);
    localStorage.setItem('lifekeep_last_google_email', googleUser.email);

    this.setAuthSession(googleUser, true);
    this.currentUser = googleUser;

    const modal = document.getElementById('google-auth-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    this.hideAuthScreen();
    await this.switchUserAccount(googleUser);
    this.showToast(`✅ Đã đăng nhập bằng Gmail: ${googleUser.email}!`);
  }

  openExternalGoogleLogin() {
    const width = 500;
    const height = 620;
    const left = window.screen.width ? (window.screen.width - width) / 2 : 100;
    const top = window.screen.height ? (window.screen.height - height) / 2 : 100;
    
    try {
      window.open(
        'https://accounts.google.com/ServiceLogin?service=lso&passive=1209600&continue=https://accounts.google.com/',
        'GoogleSignInWindow',
        `width=${width},height=${height},top=${top},left=${left},status=yes,toolbar=no,menubar=no,location=yes,resizable=yes`
      );
    } catch (e) {
      console.warn('Popup blocked:', e);
    }
  }

  async handleGoogleAuthSubmit(event) {
    event.preventDefault();
    const emailInput = document.getElementById('google-email-input');
    const nameInput = document.getElementById('google-name-input');
    const email = (emailInput ? emailInput.value : '').trim();
    let name = (nameInput ? nameInput.value : '').trim();

    if (!email || !email.includes('@')) {
      alert('Vui lòng nhập địa chỉ Gmail hợp lệ!');
      return;
    }

    await this.selectGoogleAccount(email, name);
  }

  editUserName() {
    if (!this.currentUser) return;
    const currentName = this.currentUser.name || this.currentUser.email.split('@')[0];
    const newName = prompt('Nhập họ và tên hiển thị mới của bạn:', currentName);
    if (newName && newName.trim()) {
      this.currentUser.name = newName.trim();
      this.setAuthSession(this.currentUser, true);
      
      const accounts = this.getRegisteredAccounts();
      const idx = accounts.findIndex(a => a.email && a.email.toLowerCase() === this.currentUser.email.toLowerCase());
      if (idx >= 0) {
        accounts[idx].name = this.currentUser.name;
        this.saveRegisteredAccounts(accounts);
      }
      this.updateUserUI();
      this.showToast(`✅ Đã đổi tên hiển thị thành: ${this.currentUser.name}`);
    }
  }

  updateUserUI() {
    const user = this.currentUser;
    const greetingEl = document.getElementById('header-user-greeting');
    const avatarBadge = document.getElementById('header-user-badge');
    const sName = document.getElementById('settings-user-name');
    const sEmail = document.getElementById('settings-user-email');
    const sAvatar = document.getElementById('settings-user-avatar');
    const sBadge = document.getElementById('settings-user-badge');

    if (user) {
      const displayName = user.name || user.email.split('@')[0];
      const helloPrefix = this.currentLang === 'en' ? 'Hello, ' : 'Xin chào, ';
      if (greetingEl) greetingEl.textContent = `${helloPrefix}${displayName}`;
      if (avatarBadge) avatarBadge.classList.remove('hidden');

      if (sName) sName.textContent = user.name || (this.currentLang === 'en' ? 'LifeKeep User' : 'Người dùng LifeKeep');
      if (sEmail) sEmail.textContent = user.email || '';
      if (sAvatar) {
        const initial = (user.name || user.email || 'U').charAt(0).toUpperCase();
        sAvatar.textContent = initial;
      }
      if (sBadge) {
        sBadge.innerHTML = user.provider === 'google' 
          ? `<span>🛡️</span> Gmail (${user.email})` 
          : (this.currentLang === 'en' ? '<span>🛡️</span> Personal Account' : '<span>🛡️</span> Tài khoản cá nhân');
      }
    } else {
      if (greetingEl) greetingEl.textContent = this.currentLang === 'en' ? 'Hello, Friend' : 'Xin chào, Bạn';
      if (avatarBadge) avatarBadge.classList.add('hidden');
      if (sName) sName.textContent = this.currentLang === 'en' ? 'Not signed in' : 'Chưa đăng nhập';
      if (sEmail) sEmail.textContent = this.currentLang === 'en' ? 'Sign in to protect data' : 'Đăng nhập để bảo mật thông tin';
      if (sAvatar) sAvatar.textContent = '?';
      if (sBadge) sBadge.innerHTML = this.currentLang === 'en' ? '<span>⚠️</span> Not signed in' : '<span>⚠️</span> Chưa đăng nhập';
    }
  }

  async logout() {
    if (!confirm('Bạn có chắc chắn muốn đăng xuất khỏi LifeKeep?')) return;
    localStorage.removeItem('lifekeep_auth_session');
    sessionStorage.removeItem('lifekeep_auth_session');
    this.currentUser = null;
    
    // Clear all in-memory user data so nothing leaks on the lock screen
    this.items = [];
    this.transactions = [];
    this.allLogs = [];
    this.customCategories = [];
    this.customTemplates = [];

    // Switch storage back to guest
    this.storage.setAccount('guest');
    try {
      await this.storage.init();
    } catch (e) {}

    // Close settings modal if open
    const sModal = document.getElementById('settings-modal');
    if (sModal && !sModal.classList.contains('hidden')) {
      toggleModal('settings-modal');
    }

    this.toggleAuthMode('login');
    this.showAuthScreen();
    this.updateUserUI();
    this.showToast('🚪 Đã đăng xuất khỏi tài khoản!');
  }

  showForgotPasswordPrompt() {
    const identifier = prompt('Nhập Email hoặc Tên đăng nhập của tài khoản bạn muốn đặt lại mật khẩu:');
    if (!identifier) return;

    const accounts = this.getRegisteredAccounts();
    const user = accounts.find(a => a.email.toLowerCase() === identifier.trim().toLowerCase());

    if (!user) {
      alert('Không tìm thấy tài khoản tương ứng với thông tin đã nhập!');
      return;
    }

    if (user.provider === 'google') {
      alert('Đây là tài khoản đăng nhập bằng Google Gmail. Vui lòng bấm nút "Tiếp tục với Google / Gmail" để đăng nhập an toàn.');
      return;
    }

    const newPass = prompt('Nhập mật khẩu mới cho tài khoản ' + (user.name || user.email) + ' (tối thiểu 4 ký tự):');
    if (!newPass) return;
    if (newPass.length < 4) {
      alert('Mật khẩu quá ngắn (phải có từ 4 ký tự trở lên)!');
      return;
    }

    this.hashPassword(newPass.trim()).then(hashed => {
      user.passwordHash = hashed;
      this.saveRegisteredAccounts(accounts);
      alert('✅ Đặt lại mật khẩu thành công! Bây giờ bạn có thể đăng nhập với mật khẩu mới.');
      const passInput = document.getElementById('auth-password');
      if (passInput) passInput.value = newPass.trim();
    });
  }
}

// Global instance
const app = new LifeKeepApp();
window.app = app;
window.addEventListener('DOMContentLoaded', () => app.start());
