import React from "react";
import { CheckCircle2 } from "lucide-react";
import { supabase, supabaseCadastro } from "../../lib/supabaseClient";
import { gerarSenhaProvisoria } from "../../lib/senhaProvisoria";
import { emailValido, enviarFotoUsuario, STATUS_USUARIO } from "../../lib/usuariosEquipe";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell, PainelSenha, SeletorFoto } from "./comuns";
import { erroAmigavel, mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

const FORM_VAZIO = {
  nome_completo: "",
  cargo: "",
  email: "",
  telefone: "",
  perfil_id: "",
  status: "ativo",
};

export default function ModalNovoUsuario({ perfis, onFechar, onCriado }) {
  const [form, setForm] = React.useState(FORM_VAZIO);
  const [foto, setFoto] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [criado, setCriado] = React.useState(null); // { email, senha }

  function alterar(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  async function criar(evento) {
    evento.preventDefault();
    if (salvando) return;

    const nome = form.nome_completo.trim();
    const email = form.email.trim().toLowerCase();

    if (!nome) return setErro("Informe o nome completo.");
    if (!emailValido(email)) return setErro("Informe um e-mail válido.");

    setSalvando(true);
    setErro(null);
    try {
      const fotoUrl = foto ? await enviarFotoUsuario(foto) : null;
      const senha = gerarSenhaProvisoria();

      // Cliente isolado: o signUp não substitui a sessão de quem está cadastrando.
      const { data: cadastro, error: erroAuth } = await supabaseCadastro.auth.signUp({
        email,
        password: senha,
        options: { data: { nome_completo: nome } },
      });
      if (erroAuth) {
        throw erroAmigavel(
          mensagemAmigavel(erroAuth, "Não foi possível criar o acesso deste usuário. Confira o e-mail e tente de novo.")
        );
      }
      if (!cadastro?.user?.id) throw erroAmigavel("O cadastro do acesso não foi concluído. Tente novamente.");
      if (Array.isArray(cadastro.user.identities) && cadastro.user.identities.length === 0) {
        throw erroAmigavel("Já existe uma conta de acesso com este e-mail.");
      }
      await supabaseCadastro.auth.signOut({ scope: "local" }).catch(() => {});

      const { error: erroInsert } = await supabase.from("usuarios").insert({
        auth_id: cadastro.user.id,
        nome_completo: nome,
        email,
        cargo: form.cargo.trim() || null,
        telefone: form.telefone.trim() || null,
        perfil_id: form.perfil_id || null,
        foto_url: fotoUrl,
        status: form.status,
      });
      if (erroInsert) {
        const duplicado = erroInsert.code === "23505";
        // A conta de acesso ficou criada sem cadastro: a trilha guarda a falha.
        await registrarEvento({
          modulo: "usuarios",
          acao: "criou",
          registroAfetado: `${nome} (${email})`,
          valorNovo: { email, status: form.status },
          resultado: "falha",
          nivel: "critico",
        });
        throw erroAmigavel(
          duplicado
            ? "Já existe um usuário cadastrado com este e-mail."
            : "O acesso foi criado, mas o cadastro do usuário não foi concluído. Procure o responsável pelo sistema antes de tentar de novo."
        );
      }

      // Auditoria: registra a criação sem interferir na tela (a senha provisória
      // nunca entra na trilha).
      await registrarEvento({
        modulo: "usuarios",
        acao: "criou",
        registroAfetado: `${nome} (${email})`,
        valorNovo: {
          nome_completo: nome,
          email,
          cargo: form.cargo.trim() || null,
          telefone: form.telefone.trim() || null,
          perfil: perfis?.find((p) => p.id === form.perfil_id)?.nome ?? null,
          status: form.status,
        },
        nivel: "atencao",
      });

      setCriado({ email, senha });
      onCriado?.();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível criar o usuário."));
    } finally {
      setSalvando(false);
    }
  }

  if (criado) {
    return (
      <ModalShell
        titulo="Usuário criado"
        subtitulo="Compartilhe a senha provisória com o novo usuário."
        onFechar={onFechar}
        largura="max-w-xl"
        rodape={
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onFechar}
              className="text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
            >
              Concluir
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[#15803D]">
            <CheckCircle2 size={18} />
            <span className="text-sm font-medium">Cadastro concluído com sucesso.</span>
          </div>
          <PainelSenha senha={criado.senha} email={criado.email} />
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell
      titulo="Novo Usuário"
      subtitulo="A senha provisória é gerada automaticamente e exibida ao final do cadastro."
      onFechar={onFechar}
      rodape={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="form-novo-usuario"
            disabled={salvando}
            className="text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
          >
            {salvando ? "Criando..." : "Criar usuário"}
          </button>
        </div>
      }
    >
      <form id="form-novo-usuario" onSubmit={criar} className="space-y-4">
        {erro && <Alerta>{erro}</Alerta>}

        <SeletorFoto
          arquivo={foto}
          onSelecionar={setFoto}
          onRemover={() => setFoto(null)}
          desabilitado={salvando}
        />

        <Campo label="Nome completo" obrigatorio>
          <input
            type="text"
            value={form.nome_completo}
            onChange={(e) => alterar("nome_completo", e.target.value)}
            disabled={salvando}
            autoFocus
            className={CLASSE_ENTRADA}
          />
        </Campo>

        <div className="grid sm:grid-cols-2 gap-4">
          <Campo label="Cargo/Função">
            <input
              type="text"
              value={form.cargo}
              onChange={(e) => alterar("cargo", e.target.value)}
              disabled={salvando}
              className={CLASSE_ENTRADA}
            />
          </Campo>

          <Campo label="Telefone">
            <input
              type="tel"
              value={form.telefone}
              onChange={(e) => alterar("telefone", e.target.value)}
              disabled={salvando}
              placeholder="(00) 00000-0000"
              className={CLASSE_ENTRADA}
            />
          </Campo>
        </div>

        <Campo label="E-mail" obrigatorio dica="Será o login de acesso ao sistema.">
          <input
            type="email"
            value={form.email}
            onChange={(e) => alterar("email", e.target.value)}
            disabled={salvando}
            className={CLASSE_ENTRADA}
          />
        </Campo>

        <div className="grid sm:grid-cols-2 gap-4">
          <Campo label="Perfil de acesso">
            <select
              value={form.perfil_id}
              onChange={(e) => alterar("perfil_id", e.target.value)}
              disabled={salvando}
              className={CLASSE_ENTRADA}
            >
              <option value="">Selecione...</option>
              {perfis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Status">
            <select
              value={form.status}
              onChange={(e) => alterar("status", e.target.value)}
              disabled={salvando}
              className={CLASSE_ENTRADA}
            >
              {STATUS_USUARIO.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.label}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </form>
    </ModalShell>
  );
}
