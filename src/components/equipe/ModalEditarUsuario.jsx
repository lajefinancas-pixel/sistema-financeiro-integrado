import React from "react";
import { KeyRound } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  emailValido,
  enviarFotoUsuario,
  redefinirSenhaDeUsuario,
  STATUS_USUARIO,
} from "../../lib/usuariosEquipe";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell, PainelSenha, SeletorFoto } from "./comuns";
import AbaPermissoes from "./AbaPermissoes";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

const ABAS = [
  { id: "dados", label: "Dados" },
  { id: "permissoes", label: "Permissões" },
];

export default function ModalEditarUsuario({ usuarioId, perfis, podeEditar, onFechar, onAtualizado }) {
  const [aba, setAba] = React.useState("dados");
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [salvandoStatus, setSalvandoStatus] = React.useState(false);
  const [redefinindo, setRedefinindo] = React.useState(false);
  const [senhaNova, setSenhaNova] = React.useState(null);

  const [form, setForm] = React.useState(null);
  const [foto, setFoto] = React.useState(null); // arquivo novo, ainda não enviado

  // Como o cadastro estava quando abriu (ou no último salvamento): é o
  // "valor_anterior" que a trilha de auditoria registra.
  const original = React.useRef(null);

  React.useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      try {
        const { data, error } = await supabase
          .from("usuarios")
          .select("id, nome_completo, email, cargo, telefone, foto_url, status, perfil_id")
          .eq("id", usuarioId)
          .single();
        if (error) throw error;
        if (!ativo) return;
        setForm({
          nome_completo: data.nome_completo ?? "",
          email: data.email ?? "",
          cargo: data.cargo ?? "",
          telefone: data.telefone ?? "",
          foto_url: data.foto_url ?? null,
          status: data.status ?? "ativo",
          perfil_id: data.perfil_id ?? "",
        });
        original.current = {
          nome_completo: data.nome_completo ?? null,
          email: data.email ?? null,
          cargo: data.cargo ?? null,
          telefone: data.telefone ?? null,
          perfil_id: data.perfil_id ?? null,
          status: data.status ?? null,
        };
      } catch (e) {
        if (ativo) setErro(mensagemAmigavel(e, "Não foi possível carregar o usuário."));
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [usuarioId]);

  function alterar(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }));
    setAviso(null);
  }

  // O status é gravado assim que muda, sem depender do botão Salvar.
  async function alterarStatus(novoStatus) {
    const anterior = form.status;
    setForm((atual) => ({ ...atual, status: novoStatus }));
    setSalvandoStatus(true);
    setErro(null);
    try {
      const { error } = await supabase.from("usuarios").update({ status: novoStatus }).eq("id", usuarioId);
      if (error) throw error;
      setAviso("Status atualizado.");

      // Auditoria: bloquear um acesso é o evento mais sensível desta tela.
      await registrarEvento({
        modulo: "usuarios",
        acao: "alterou",
        registroAfetado: `${form.nome_completo || "Usuário"} (${form.email || "sem e-mail"})`,
        valorAnterior: { status: anterior },
        valorNovo: { status: novoStatus },
        nivel: novoStatus === "bloqueado" ? "critico" : "atencao",
      });
      if (original.current) original.current.status = novoStatus;

      onAtualizado?.();
    } catch (e) {
      setForm((atual) => ({ ...atual, status: anterior }));
      setErro(mensagemAmigavel(e, "Não foi possível atualizar o status."));
    } finally {
      setSalvandoStatus(false);
    }
  }

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando) return;

    const nome = form.nome_completo.trim();
    if (!nome) return setErro("Informe o nome completo.");
    if (!emailValido(form.email)) return setErro("O e-mail deste cadastro é inválido.");

    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const fotoUrl = foto ? await enviarFotoUsuario(foto) : form.foto_url;

      const alteracao = {
        nome_completo: nome,
        cargo: form.cargo.trim() || null,
        telefone: form.telefone.trim() || null,
        perfil_id: form.perfil_id || null,
        foto_url: fotoUrl,
      };

      const { error } = await supabase
        .from("usuarios")
        .update(alteracao)
        .eq("id", usuarioId);
      if (error) throw error;

      // Auditoria: só o que mudou de fato entra na trilha; trocar o perfil de
      // acesso mexe em permissões, por isso sobe o nível do evento.
      const antes = original.current ?? {};
      const depois = {
        nome_completo: nome,
        cargo: alteracao.cargo,
        telefone: alteracao.telefone,
        perfil_id: alteracao.perfil_id,
      };
      const campos = Object.keys(depois).filter((campo) => (antes[campo] ?? null) !== depois[campo]);
      if (campos.length > 0) {
        // O perfil vai para a trilha pelo nome, não pelo id, para quem consultar
        // a auditoria entender o que mudou sem procurar em outra tabela.
        const CHAVES = { nome_completo: "nome", cargo: "cargo", telefone: "telefone", perfil_id: "perfil" };
        const legivel = (campo, valor) =>
          campo === "perfil_id" ? (perfis?.find((p) => p.id === valor)?.nome ?? null) : (valor ?? null);

        await registrarEvento({
          modulo: "usuarios",
          acao: "alterou",
          registroAfetado: `${nome} (${form.email || "sem e-mail"})`,
          valorAnterior: Object.fromEntries(
            campos.map((campo) => [CHAVES[campo], legivel(campo, antes[campo])]),
          ),
          valorNovo: Object.fromEntries(
            campos.map((campo) => [CHAVES[campo], legivel(campo, depois[campo])]),
          ),
          nivel: campos.includes("perfil_id") ? "critico" : "atencao",
        });
        original.current = { ...antes, ...depois };
      }

      setForm((atual) => ({ ...atual, foto_url: fotoUrl }));
      setFoto(null);
      setAviso("Alterações salvas.");
      onAtualizado?.();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar as alterações."));
    } finally {
      setSalvando(false);
    }
  }

  async function redefinirSenha() {
    if (redefinindo) return;
    setRedefinindo(true);
    setErro(null);
    setAviso(null);
    try {
      const senha = await redefinirSenhaDeUsuario(usuarioId);
      setSenhaNova(senha);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível redefinir a senha."));
    } finally {
      setRedefinindo(false);
    }
  }

  return (
    <ModalShell
      titulo={carregando ? "Carregando..." : form?.nome_completo || "Usuário"}
      subtitulo={carregando ? undefined : form?.email}
      onFechar={onFechar}
      rodape={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-50"
          >
            Fechar
          </button>
          {aba === "dados" && podeEditar && !carregando && (
            <button
              type="submit"
              form="form-editar-usuario"
              disabled={salvando}
              className="text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
            >
              {salvando ? "Salvando..." : "Salvar"}
            </button>
          )}
        </div>
      }
    >
      <div className="flex items-center gap-1 border-b border-black/5 -mt-1 mb-5">
        {ABAS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAba(item.id)}
            className={`px-4 py-2.5 text-sm -mb-px border-b-2 ${
              aba === item.id
                ? "border-[#C9A227] text-[#0F2A44] font-medium"
                : "border-transparent text-[#0F2A44]/50 hover:text-[#0F2A44]/80"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {carregando || !form ? (
        <div className="text-sm text-[#0F2A44]/50 py-6">Carregando dados do usuário...</div>
      ) : aba === "dados" ? (
        <form id="form-editar-usuario" onSubmit={salvar} className="space-y-4">
          {erro && <Alerta>{erro}</Alerta>}
          {aviso && <Alerta tipo="sucesso">{aviso}</Alerta>}

          <SeletorFoto
            urlAtual={form.foto_url}
            arquivo={foto}
            onSelecionar={setFoto}
            onRemover={() => {
              setFoto(null);
              alterar("foto_url", null);
            }}
            desabilitado={!podeEditar || salvando}
          />

          <Campo label="Nome completo" obrigatorio>
            <input
              type="text"
              value={form.nome_completo}
              onChange={(e) => alterar("nome_completo", e.target.value)}
              disabled={!podeEditar || salvando}
              className={CLASSE_ENTRADA}
            />
          </Campo>

          <div className="grid sm:grid-cols-2 gap-4">
            <Campo label="Cargo/Função">
              <input
                type="text"
                value={form.cargo}
                onChange={(e) => alterar("cargo", e.target.value)}
                disabled={!podeEditar || salvando}
                className={CLASSE_ENTRADA}
              />
            </Campo>

            <Campo label="Telefone">
              <input
                type="tel"
                value={form.telefone}
                onChange={(e) => alterar("telefone", e.target.value)}
                disabled={!podeEditar || salvando}
                placeholder="(00) 00000-0000"
                className={CLASSE_ENTRADA}
              />
            </Campo>
          </div>

          <Campo label="E-mail" dica="O e-mail de acesso não pode ser alterado por aqui.">
            <input type="email" value={form.email} readOnly disabled className={CLASSE_ENTRADA} />
          </Campo>

          <div className="grid sm:grid-cols-2 gap-4">
            <Campo label="Perfil de acesso">
              <select
                value={form.perfil_id}
                onChange={(e) => alterar("perfil_id", e.target.value)}
                disabled={!podeEditar || salvando}
                className={CLASSE_ENTRADA}
              >
                <option value="">Sem perfil</option>
                {perfis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              label="Status"
              dica={salvandoStatus ? "Salvando..." : "Salvo automaticamente ao alterar."}
            >
              <select
                value={form.status}
                onChange={(e) => alterarStatus(e.target.value)}
                disabled={!podeEditar || salvandoStatus}
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

          {podeEditar && (
            <div className="pt-4 border-t border-black/5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[#0F2A44]">Acesso ao sistema</div>
                  <p className="text-xs text-[#0F2A44]/55 mt-0.5">
                    Gera uma nova senha provisória e a exibe aqui para você repassar ao usuário.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={redefinirSenha}
                  disabled={redefinindo}
                  className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44] hover:bg-black/5 disabled:opacity-50"
                >
                  <KeyRound size={15} />
                  {redefinindo ? "Redefinindo..." : "Redefinir senha"}
                </button>
              </div>
              {senhaNova && <PainelSenha senha={senhaNova} email={form.email} titulo="Nova senha provisória" />}
            </div>
          )}
        </form>
      ) : (
        <AbaPermissoes usuarioId={usuarioId} podeEditar={podeEditar} />
      )}
    </ModalShell>
  );
}
