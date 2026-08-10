import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente isolado, usado apenas para criar contas de acesso no Auth.
// Como ele não persiste sessão, o signUp do novo usuário não derruba
// nem substitui a sessão de quem está fazendo o cadastro.
export const supabaseCadastro = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: "sfi-cadastro-usuarios",
  },
});
