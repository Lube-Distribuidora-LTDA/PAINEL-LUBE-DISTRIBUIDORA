// =========================================================
// PAINEL LUBE — operações administrativas de usuário
// Roda no servidor (Edge Function). A chave de serviço nunca
// sai daqui: o frontend só chama esta função com o JWT do
// administrador, que é verificado a cada requisição.
// =========================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL_SB  = Deno.env.get('SUPABASE_URL')!;
const ANON    = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const DOMINIO = '@lube.com.br';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);

  // ---- quem está chamando? ----
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.replace('Bearer ', '').trim();
  if (!jwt) return json({ erro: 'Sem credencial' }, 401);

  const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });
  const leitor = createClient(URL_SB, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await leitor.auth.getUser();
  if (userErr || !userData?.user) return json({ erro: 'Sessão inválida' }, 401);

  const { data: perfil } = await admin
    .from('profiles')
    .select('is_admin, ativo')
    .eq('id', userData.user.id)
    .single();

  if (!perfil?.is_admin || !perfil?.ativo) {
    return json({ erro: 'Apenas administradores' }, 403);
  }

  // ---- ação ----
  let corpo: Record<string, any>;
  try { corpo = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }

  const acao = String(corpo.acao || '');

  try {
    switch (acao) {
      // ---------------------------------------------------
      case 'criar': {
        const email = String(corpo.email || '').trim().toLowerCase();
        const senha = String(corpo.senha || '');
        if (!email.endsWith(DOMINIO)) return json({ erro: `O e-mail precisa terminar em ${DOMINIO}` }, 400);
        if (senha.length < 8) return json({ erro: 'A senha precisa ter ao menos 8 caracteres' }, 400);

        const { data, error } = await admin.auth.admin.createUser({
          email,
          password: senha,
          email_confirm: true,
          user_metadata: { nome: corpo.nome ?? '', cargo: corpo.cargo ?? '' },
        });
        if (error) return json({ erro: error.message }, 400);

        const id = data.user!.id;

        await admin.from('profiles').update({
          nome: corpo.nome ?? '',
          cargo: corpo.cargo ?? '',
          is_admin: !!corpo.is_admin,
          acesso_total: !!corpo.acesso_total,
          ativo: true,
          aprovado_em: new Date().toISOString(),
          aprovado_por: userData.user.id,
        }).eq('id', id);

        const sistemas: string[] = Array.isArray(corpo.sistemas) ? corpo.sistemas : [];
        if (sistemas.length) {
          await admin.from('permissoes').insert(
            sistemas.map((s) => ({ user_id: id, sistema_id: s, concedido_por: userData.user.id })),
          );
        }
        return json({ ok: true, id });
      }

      // ---------------------------------------------------
      case 'senha': {
        const senha = String(corpo.senha || '');
        if (senha.length < 8) return json({ erro: 'A senha precisa ter ao menos 8 caracteres' }, 400);
        const { error } = await admin.auth.admin.updateUserById(String(corpo.user_id), { password: senha });
        if (error) return json({ erro: error.message }, 400);
        return json({ ok: true });
      }

      // ---------------------------------------------------
      case 'remover': {
        const alvo = String(corpo.user_id);
        if (alvo === userData.user.id) return json({ erro: 'Você não pode remover a si mesmo' }, 400);
        const { error } = await admin.auth.admin.deleteUser(alvo);
        if (error) return json({ erro: error.message }, 400);
        return json({ ok: true });
      }

      // ---------------------------------------------------
      default:
        return json({ erro: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    return json({ erro: String(e) }, 500);
  }
});
