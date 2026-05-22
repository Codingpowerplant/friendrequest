/**
 * API configuration with environment-aware defaults.
 * Override in production by setting window.FRIENDREQUEST_API_BASE or
 * window.FARMERSHUB_API_BASE before loading scripts.
 */

const LOCAL_API_BASE = 'http://localhost:5000/api';

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

function detectApiBase() {
  if (typeof window === 'undefined') return '/api';

  const runtimeOverride = normalizeBase(window.FRIENDREQUEST_API_BASE || window.FARMERSHUB_API_BASE);
  if (runtimeOverride) return runtimeOverride;

  if (window.location.protocol === 'file:') return LOCAL_API_BASE;

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return LOCAL_API_BASE;

  return `${window.location.origin}/api`;
}

const API_BASE = detectApiBase();

function getToken() {
  return localStorage.getItem('fh_token');
}

function jsonHeaders(auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

export { API_BASE, getToken, jsonHeaders, authHeader, apiFetch };
