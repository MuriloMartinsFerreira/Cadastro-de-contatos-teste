// Gera web/config.js a partir de variáveis de ambiente (usado no build do Vercel).
// Uso local: SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run build
import { writeFileSync } from 'node:fs';

const fail = (msg) => { console.error('Erro: ' + msg); process.exit(1); };
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) fail('defina SUPABASE_URL e SUPABASE_ANON_KEY.');
try { if (new URL(url).protocol !== 'https:') fail('SUPABASE_URL deve usar https.'); }
catch { fail('SUPABASE_URL inválida.'); }

// Trava de segurança: recusa chaves secretas no frontend.
if (key.startsWith('sb_secret_')) fail('essa é uma chave secreta; use a anon/publishable key.');
try {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (payload.role === 'service_role') fail('essa é a service_role key; use a anon key.');
} catch { /* formato novo (não-JWT): já checado acima */ }

writeFileSync('web/config.js',
  `window.APP_CONFIG = ${JSON.stringify({ url, anonKey: key }, null, 2)};\n`);
console.log('web/config.js gerado.');
