// Webhook que recebe notificações do Mercado Pago
// MP envia POST sempre que um pagamento muda de status
import { getSupabaseAdmin, jsonResponse, MP_ACCESS_TOKEN } from './_utils.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método não permitido' });

  try {
    const body = JSON.parse(event.body || '{}');
    const topic = body.type || body.topic;
    const resourceId = body.data?.id || body.resource || body.id;

    console.log('[mp-webhook] topic=', topic, 'id=', resourceId);
    if (!topic || !resourceId) return jsonResponse(200, { ok: true, ignored: true });

    const db = getSupabaseAdmin();

    // Pagamento avulso
    if (topic === 'payment' || topic === 'payment.updated' || topic === 'payment.created') {
      const resp = await fetch(`https://api.mercadopago.com/v1/payments/${resourceId}`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const pay = await resp.json();
      if (!resp.ok) {
        console.error('Erro ao buscar pagamento:', pay);
        return jsonResponse(200, { ok: true, error: 'payment_fetch_failed' });
      }

      const meta = pay.metadata || {};
      const userId = meta.user_id;
      const contentId = meta.content_id ? Number(meta.content_id) : null;
      const kind = meta.kind;
      const extRef = pay.external_reference || '';

      // Status do MP: approved, rejected, pending, in_process, refunded, cancelled
      const status = pay.status; // normaliza direto
      const amount = pay.transaction_amount;

      if (kind === 'purchase' && userId && contentId) {
        await db.from('purchases').upsert({
          user_id: userId,
          content_id: contentId,
          amount: amount,
          mp_payment_id: String(pay.id),
          status: status
        }, { onConflict: 'user_id,content_id' });
        console.log('[mp-webhook] purchase atualizada:', userId, contentId, status);
      } else if (extRef.startsWith('purchase:')) {
        // fallback: external_reference no formato purchase:userId:contentId:ts
        const [, uId, cId] = extRef.split(':');
        if (uId && cId) {
          await db.from('purchases').upsert({
            user_id: uId,
            content_id: Number(cId),
            amount: amount,
            mp_payment_id: String(pay.id),
            status: status
          }, { onConflict: 'user_id,content_id' });
        }
      }
      return jsonResponse(200, { ok: true });
    }

    // Assinatura (preapproval)
    if (topic === 'preapproval' || topic === 'subscription_preapproval') {
      const resp = await fetch(`https://api.mercadopago.com/preapproval/${resourceId}`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const sub = await resp.json();
      if (!resp.ok) {
        console.error('Erro ao buscar preapproval:', sub);
        return jsonResponse(200, { ok: true, error: 'preapproval_fetch_failed' });
      }

      const extRef = sub.external_reference || '';
      const userId = extRef.startsWith('sub:') ? extRef.split(':')[1] : null;
      if (!userId) return jsonResponse(200, { ok: true, ignored: true });

      // status MP preapproval: pending, authorized, paused, cancelled
      const status = sub.status === 'authorized' ? 'active'
                   : sub.status === 'cancelled' ? 'cancelled'
                   : sub.status === 'paused' ? 'paused'
                   : 'pending';

      // next_payment_date = próxima cobrança. Como cobrança é mensal, ends_at = +33 dias por segurança
      let endsAt = null;
      if (status === 'active') {
        const d = new Date();
        d.setDate(d.getDate() + 33);
        endsAt = d.toISOString();
      }

      await db.from('subscriptions').upsert({
        user_id: userId,
        status: status,
        mp_subscription_id: String(sub.id),
        ends_at: endsAt,
        started_at: status === 'active' ? new Date().toISOString() : null
      }, { onConflict: 'user_id' });

      console.log('[mp-webhook] subscription atualizada:', userId, status);
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(200, { ok: true, ignored: true, topic });
  } catch (e) {
    console.error('[mp-webhook] erro:', e);
    // IMPORTANTE: sempre retornar 200 pro MP não ficar reenviando
    return jsonResponse(200, { ok: false, error: e.message });
  }
};
