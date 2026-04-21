// Cria assinatura recorrente (Preapproval) no Mercado Pago
import {
  getSupabaseAdmin, getUserFromAuthHeader,
  jsonResponse, corsPreflight,
  MP_ACCESS_TOKEN, PUBLIC_SITE_URL, SUBSCRIPTION_PRICE
} from './_utils.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método não permitido' });

  try {
    const user = await getUserFromAuthHeader(event);
    if (!user) return jsonResponse(401, { error: 'Não autenticado' });

    const db = getSupabaseAdmin();

    // Verifica se já tem assinatura ativa
    const { data: existing } = await db
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing && existing.status === 'active' &&
        (!existing.ends_at || new Date(existing.ends_at) > new Date()))
      return jsonResponse(400, { error: 'Você já tem assinatura ativa' });

    // Cria preapproval via API REST (o SDK oficial ainda não cobre 100% preapproval em todos os modos)
    // MP exige back_url HTTPS válido — se estivermos em localhost, usa uma URL pública placeholder
    const isLocal = !PUBLIC_SITE_URL.startsWith('https://');
    const backUrl = isLocal
      ? 'https://www.mercadopago.com.br'
      : `${PUBLIC_SITE_URL}/?subscription=success`;

    const body = {
      reason: 'Assinatura Arquivo Vivo',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: SUBSCRIPTION_PRICE,
        currency_id: 'BRL'
      },
      back_url: backUrl,
      payer_email: user.email,
      external_reference: `sub:${user.id}:${Date.now()}`,
      status: 'pending'
    };

    const resp = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('MP preapproval error:', data);
      return jsonResponse(500, { error: data.message || 'Erro ao criar assinatura no Mercado Pago', details: data });
    }

    // Grava assinatura como pendente
    await db.from('subscriptions').upsert({
      user_id: user.id,
      status: 'pending',
      mp_subscription_id: data.id
    }, { onConflict: 'user_id' });

    return jsonResponse(200, {
      subscription_id: data.id,
      init_point: data.init_point
    });
  } catch (e) {
    console.error('create-subscription error:', e);
    return jsonResponse(500, { error: e.message || 'Erro interno' });
  }
};
