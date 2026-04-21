// Cria preferência de pagamento (Checkout Pro) no Mercado Pago para COMPRA AVULSA
import { MercadoPagoConfig, Preference } from 'mercadopago';
import {
  getSupabaseAdmin, getUserFromAuthHeader,
  jsonResponse, corsPreflight,
  MP_ACCESS_TOKEN, PUBLIC_SITE_URL
} from './_utils.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método não permitido' });

  try {
    const user = await getUserFromAuthHeader(event);
    if (!user) return jsonResponse(401, { error: 'Não autenticado' });

    const { content_id } = JSON.parse(event.body || '{}');
    if (!content_id) return jsonResponse(400, { error: 'content_id obrigatório' });

    const db = getSupabaseAdmin();

    // Busca o conteúdo pra pegar preço e título
    const { data: item, error: contentErr } = await db
      .from('contents')
      .select('id, title, price')
      .eq('id', content_id)
      .maybeSingle();
    if (contentErr || !item) return jsonResponse(404, { error: 'Conteúdo não encontrado' });
    if (!item.price || Number(item.price) <= 0)
      return jsonResponse(400, { error: 'Conteúdo gratuito — não precisa comprar' });

    // Verifica se já comprou
    const { data: existing } = await db
      .from('purchases')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('content_id', content_id)
      .maybeSingle();
    if (existing && existing.status === 'approved')
      return jsonResponse(400, { error: 'Você já comprou este conteúdo' });

    // Cria preferência no MP
    const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    const externalRef = `purchase:${user.id}:${content_id}:${Date.now()}`;

    const result = await preference.create({
      body: {
        items: [{
          id: String(item.id),
          title: item.title,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: Number(item.price)
        }],
        payer: { email: user.email },
        external_reference: externalRef,
        back_urls: {
          success: `${PUBLIC_SITE_URL}/?payment=success`,
          failure: `${PUBLIC_SITE_URL}/?payment=failure`,
          pending: `${PUBLIC_SITE_URL}/?payment=pending`
        },
        // auto_return só funciona com URL pública HTTPS (não localhost).
        // Será adicionado via env var quando fizer deploy.
        ...(PUBLIC_SITE_URL.startsWith('https://') ? { auto_return: 'approved' } : {}),
        ...(PUBLIC_SITE_URL.startsWith('https://') ? { notification_url: `${PUBLIC_SITE_URL}/api/mp-webhook` } : {}),
        metadata: {
          user_id: user.id,
          content_id: String(content_id),
          kind: 'purchase'
        }
      }
    });

    // Grava purchase pendente
    await db.from('purchases').upsert({
      user_id: user.id,
      content_id: content_id,
      amount: Number(item.price),
      mp_payment_id: String(result.id),
      status: 'pending'
    }, { onConflict: 'user_id,content_id' });

    return jsonResponse(200, {
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (e) {
    console.error('create-payment error:', e);
    return jsonResponse(500, { error: e.message || 'Erro interno' });
  }
};
