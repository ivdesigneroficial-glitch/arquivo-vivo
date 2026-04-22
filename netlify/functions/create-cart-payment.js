// Cria preferência de pagamento (Checkout Pro) no Mercado Pago para COMPRA DE CARRINHO (múltiplos itens)
// Aplica desconto progressivo baseado na quantidade de itens:
//  3-4 itens  -> 10% off
//  5-6 itens  -> 15% off
//  7-9 itens  -> 20% off
//  10-14 itens -> 25% off
//  15+ itens  -> 30% off
import { MercadoPagoConfig, Preference } from 'mercadopago';
import {
  getSupabaseAdmin, getUserFromAuthHeader,
  jsonResponse, corsPreflight,
  MP_ACCESS_TOKEN, PUBLIC_SITE_URL
} from './_utils.js';

function calcDiscountPct(qtd) {
  if (qtd >= 15) return 0.30;
  if (qtd >= 10) return 0.25;
  if (qtd >= 7)  return 0.20;
  if (qtd >= 5)  return 0.15;
  if (qtd >= 3)  return 0.10;
  return 0;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método não permitido' });

  try {
    const user = await getUserFromAuthHeader(event);
    if (!user) return jsonResponse(401, { error: 'Não autenticado' });

    const { content_ids } = JSON.parse(event.body || '{}');
    if (!Array.isArray(content_ids) || content_ids.length === 0)
      return jsonResponse(400, { error: 'content_ids obrigatório (array não vazio)' });

    // Dedupe (cliente pode ter enviado duplicado)
    const uniqueIds = [...new Set(content_ids.map(Number).filter(Boolean))];
    if (uniqueIds.length === 0) return jsonResponse(400, { error: 'Nenhum id válido' });

    const db = getSupabaseAdmin();

    // Busca todos os conteúdos de uma vez
    const { data: items, error: contentErr } = await db
      .from('contents')
      .select('id, title, price')
      .in('id', uniqueIds);
    if (contentErr) return jsonResponse(500, { error: 'Erro ao buscar conteúdos' });
    if (!items || items.length === 0) return jsonResponse(404, { error: 'Nenhum conteúdo encontrado' });

    // Filtra apenas pagos (price > 0)
    const paidItems = items.filter(i => Number(i.price) > 0);
    if (paidItems.length === 0)
      return jsonResponse(400, { error: 'Nenhum conteúdo pago no carrinho' });

    // Remove itens que o usuário já comprou
    const { data: existing } = await db
      .from('purchases')
      .select('content_id, status')
      .eq('user_id', user.id)
      .in('content_id', paidItems.map(i => i.id));
    const alreadyBought = new Set(
      (existing || []).filter(p => p.status === 'approved').map(p => p.content_id)
    );
    const toBuy = paidItems.filter(i => !alreadyBought.has(i.id));
    if (toBuy.length === 0)
      return jsonResponse(400, { error: 'Você já comprou todos estes conteúdos' });

    // Calcula desconto
    const qtd = toBuy.length;
    const discountPct = calcDiscountPct(qtd);
    const subtotal = toBuy.reduce((acc, i) => acc + Number(i.price), 0);
    const totalFinal = +(subtotal * (1 - discountPct)).toFixed(2);

    // Preço proporcional por item (com desconto aplicado)
    // Usado no banco pra saber quanto cada item gerou de receita real
    const ratio = totalFinal / subtotal;

    // external_reference único deste carrinho
    const cartRef = `cart:${user.id}:${Date.now()}`;

    // Cria preferência no MP — UM item resumo (simplifica checkout)
    const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    const packTitle = discountPct > 0
      ? `Pacote Arquivo Vivo — ${qtd} títulos (${Math.round(discountPct*100)}% off)`
      : `Arquivo Vivo — ${qtd} ${qtd === 1 ? 'título' : 'títulos'}`;

    const result = await preference.create({
      body: {
        items: [{
          id: cartRef,
          title: packTitle,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: totalFinal
        }],
        payer: { email: user.email },
        external_reference: cartRef,
        back_urls: {
          success: `${PUBLIC_SITE_URL}/?payment=success`,
          failure: `${PUBLIC_SITE_URL}/?payment=failure`,
          pending: `${PUBLIC_SITE_URL}/?payment=pending`
        },
        ...(PUBLIC_SITE_URL.startsWith('https://') ? { auto_return: 'approved' } : {}),
        ...(PUBLIC_SITE_URL.startsWith('https://') ? { notification_url: `${PUBLIC_SITE_URL}/api/mp-webhook` } : {}),
        metadata: {
          user_id: user.id,
          cart_ref: cartRef,
          kind: 'cart',
          qtd: qtd,
          discount_pct: discountPct
        }
      }
    });

    // Grava uma purchase pendente pra cada item, com mp_payment_id = cartRef (será trocado pelo payment id real no webhook)
    const rows = toBuy.map(i => ({
      user_id: user.id,
      content_id: i.id,
      amount: +(Number(i.price) * ratio).toFixed(2),
      mp_payment_id: cartRef,
      status: 'pending'
    }));
    await db.from('purchases').upsert(rows, { onConflict: 'user_id,content_id' });

    return jsonResponse(200, {
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      subtotal: subtotal,
      discount_pct: discountPct,
      total: totalFinal,
      qtd: qtd
    });
  } catch (e) {
    console.error('create-cart-payment error:', e);
    return jsonResponse(500, { error: e.message || 'Erro interno' });
  }
};
