import { handler } from '../netlify/functions/create-cart-payment.js';
import { toNetlifyEvent, sendNetlifyResponse } from './_utils.js';

export default async function (req, res) {
  let body = '';
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks).toString();
  } catch (_) {}
  const event = toNetlifyEvent(req, body);
  event.body = body;
  const response = await handler(event);
  sendNetlifyResponse(res, response);
}
