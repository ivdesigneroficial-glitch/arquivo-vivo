// Utilitários compartilhados entre as functions
import { createClient } from '@supabase/supabase-js';

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars ausentes');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Valida o JWT do usuário logado (enviado pelo frontend no header Authorization)
export async function getUserFromAuthHeader(event) {
  const auth = event.headers.authorization || event.headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const db = getSupabaseAdmin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

export function corsPreflight() {
  return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    },
    body: ''
  };
}

export const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
export const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || 'http://localhost:8888';
export const SUBSCRIPTION_PRICE = 29.90;
