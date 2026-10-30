/**
 * LifeKeep Firebase Configuration & Services Module
 * Tích hợp hệ thống Đăng nhập Google (Firebase Auth), Đồng bộ Đám mây (Cloud Firestore)
 * và Tự động sao lưu ngầm (Android Auto Backup / Google Drive).
 * 
 * Hướng dẫn:
 * 1. Bạn có thể dán thông tin cấu hình từ Firebase Console vào đối tượng `defaultFirebaseConfig` bên dưới.
 * 2. Hoặc bạn có thể dán trực tiếp trong giao diện ứng dụng (Cài đặt > Cấu hình Firebase Key).
 */

(function () {
  'use strict';

  // Cấu hình dự án Firebase chính thức của LifeKeep
  const defaultFirebaseConfig = {
    apiKey: "AIzaSyBp4oq92sUlffRq2jTuvzWEMIy-09hxaRk",
    authDomain: "lifekeep-assistant.firebaseapp.com",
    projectId: "lifekeep-assistant",
    storageBucket: "lifekeep-assistant.firebasestorage.app",
    messagingSenderId: "372218094020",
    appId: "1:372218094020:web:7c6c570c971305fc638491",
    measurementId: "G-K0HEYHVS34"
  };

  class LifeKeepFirebaseService {
    constructor() {
      this.app = null;
      this.auth = null;
      this.db = null;
      this.analytics = null;
      this.initialized = false;
    }

    getConfig() {
      try {
        const stored = localStorage.getItem('lifekeep_firebase_custom_config');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.apiKey && parsed.projectId) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn('Lỗi đọc cấu hình Firebase từ localStorage:', e);
      }
      return defaultFirebaseConfig;
    }

    isConfigured() {
      const cfg = this.getConfig();
      return !!(cfg && cfg.apiKey && cfg.apiKey.trim() !== '' && cfg.projectId && cfg.projectId.trim() !== '');
    }

    init() {
      if (this.initialized) return true;
      if (typeof firebase === 'undefined') {
        console.info('[LifeKeep Firebase] Firebase Web SDK chưa được tải (Offline Mode).');
        return false;
      }

      const config = this.getConfig();
      if (!this.isConfigured()) {
        console.info('[LifeKeep Firebase] Chưa cấu hình API Key. Ứng dụng chạy chế độ Cục bộ & Android Auto Backup.');
        return false;
      }

      try {
        if (!firebase.apps || !firebase.apps.length) {
          this.app = firebase.initializeApp(config);
        } else {
          this.app = firebase.app();
        }

        if (firebase.auth) {
          this.auth = firebase.auth();
        }

        if (firebase.firestore) {
          this.db = firebase.firestore();
        }

        if (firebase.analytics && config.measurementId) {
          try {
            this.analytics = firebase.analytics();
          } catch (ae) {
            console.warn('[LifeKeep Firebase] Analytics init info:', ae);
          }
        }

        this.initialized = true;
        console.log('[LifeKeep Firebase] Đã kết nối Firebase thành công cho dự án:', config.projectId);
        return true;
      } catch (err) {
        console.error('[LifeKeep Firebase] Khởi tạo Firebase thất bại:', err);
        return false;
      }
    }

    saveCustomConfig(newConfig) {
      if (!newConfig || typeof newConfig !== 'object') return false;
      localStorage.setItem('lifekeep_firebase_custom_config', JSON.stringify(newConfig));
      this.initialized = false;
      return this.init();
    }

    clearCustomConfig() {
      localStorage.removeItem('lifekeep_firebase_custom_config');
      this.initialized = false;
    }

    isFirestoreAvailable() {
      return !!(this.initialized && this.db);
    }
  }

  window.LifeKeepFirebase = new LifeKeepFirebaseService();

  // Tự động khởi tạo khi tài liệu sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.LifeKeepFirebase.init());
  } else {
    window.LifeKeepFirebase.init();
  }
})();
