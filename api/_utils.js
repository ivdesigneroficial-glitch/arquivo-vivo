// Adaptador Vercel — converte req/res do Vercel para o formato Netlify event/response
export function toNetlifyEvent(req, body) {
  return {
    httpMethod: req.method,
    headers: req.headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    queryStringParameters: req.query || {}
  };
}

export function sendNetlifyResponse(res, netlifyResponse) {
  res.status(netlifyResponse.statusCode || 200);
  if (netlifyResponse.headers) {
    Object.entries(netlifyResponse.headers).forEach(([k, v]) => res.setHeader(k, v));
  }
  res.send(netlifyResponse.body || '');
}
