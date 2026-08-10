import React from "react";
import { Plus, Search, Users as UsersIcon, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { usePermissaoModulo } from "../../lib/permissoes";
import Layout from "../../components/Layout";
import AcessoNegado from "../../components/AcessoNegado";
import ModalNovoUsuario from "../../components/equipe/ModalNovoUsuario";
import ModalEditarUsuario from "../../components/equipe/ModalEditarUsuario";
import { mensagemAmigavel } from "../../lib/erros";

const MODULO = "administracao";

const STATUS = {
  ativo: { label: "Ativo", cor: "#16A34A", bg: "#EAFBF0", ponto: "#16A34A" },
  inativo: { label: "Inativo", cor: "#64748B", bg: "#F1F5F9", ponto: "#94A3B8" },
  bloqueado: { label: "Bloqueado", cor: "#DC2626", bg: "#FEF2F2", ponto: "#DC2626" },
};
function statusInfo(valor) {
  return STATUS[valor] ?? { label: valor ?? "--", cor: "#64748B", bg: "#F1F5F9", ponto: "#94A3B8" };
}

// Paleta dos badges de perfil de acesso; perfis novos caem no dourado da identidade.
const CORES_PERFIL = [
  { cor: "#0F2A44", bg: "#E7EDF5" },
  { cor: "#7C3AED", bg: "#F3EDFF" },
  { cor: "#2563EB", bg: "#EAF1FF" },
  { cor: "#0E7490", bg: "#E6F6FA" },
  { cor: "#B45309", bg: "#FEF3E2" },
];
function perfilInfo(nome, indice) {
  if (!nome) return { cor: "#8A7526", bg: "#FBF4DE" };
  return CORES_PERFIL[indice % CORES_PERFIL.length] ?? { cor: "#8A7526", bg: "#FBF4DE" };
}

function iniciais(nome) {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function Avatar({ nome, foto }) {
  const [falhou, setFalhou] = React.useState(false);
  if (foto && !falhou) {
    return (
      <img
        src={foto}
        alt={nome ?? "Usuário"}
        onError={() => setFalhou(true)}
        className="w-10 h-10 rounded-full object-cover border border-[#C9A227]/40 shrink-0"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-[#0F2A44] text-white border border-[#C9A227]/40 flex items-center justify-center text-xs font-semibold shrink-0">
      {iniciais(nome)}
    </div>
  );
}

function BadgePerfil({ nome, indice }) {
  const info = perfilInfo(nome, indice);
  return (
    <span
      style={{ color: info.cor, backgroundColor: info.bg }}
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      {nome ?? "Sem perfil"}
    </span>
  );
}

function BadgeStatus({ status }) {
  const info = statusInfo(status);
  return (
    <span
      style={{ color: info.cor, backgroundColor: info.bg }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.ponto }} />
      {info.label}
    </span>
  );
}

export default function Usuarios() {
  const { carregando: verificando, usuario: usuarioLogado, permissao, erro: erroPermissao } =
    usePermissaoModulo(MODULO);

  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [usuarios, setUsuarios] = React.useState([]);
  const [perfis, setPerfis] = React.useState([]);

  const [busca, setBusca] = React.useState("");
  const [filtroPerfil, setFiltroPerfil] = React.useState("todos");
  const [filtroStatus, setFiltroStatus] = React.useState("todos");

  // Telas de cadastro e edição
  const [perfisAcesso, setPerfisAcesso] = React.useState([]);
  const [abrirNovo, setAbrirNovo] = React.useState(false);
  const [usuarioEmEdicao, setUsuarioEmEdicao] = React.useState(null);
  const [recarga, setRecarga] = React.useState(0);
  const recarregar = React.useCallback(() => setRecarga((n) => n + 1), []);

  const podeVisualizar = permissao?.pode_visualizar === true;
  const podeCadastrar = permissao?.pode_cadastrar === true;
  const podeEditar = permissao?.pode_editar === true;

  React.useEffect(() => {
    if (!podeVisualizar) return;
    let ativo = true;

    async function carregarUsuarios() {
      setCarregando(true);
      setErro(null);
      try {
        const { data, error } = await supabase
          .from("usuarios")
          .select("id, nome_completo, foto_url, cargo, email, status, perfil_id, perfis_acesso ( id, nome, descricao )")
          .order("nome_completo", { ascending: true });
        if (error) throw error;

        const lista = data ?? [];
        const perfisUnicos = [];
        lista.forEach((u) => {
          const p = u.perfis_acesso;
          if (p?.id && !perfisUnicos.some((x) => x.id === p.id)) perfisUnicos.push({ id: p.id, nome: p.nome });
        });
        perfisUnicos.sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR"));

        if (ativo) {
          setUsuarios(lista);
          setPerfis(perfisUnicos);
        }
      } catch (e) {
        if (ativo) setErro(mensagemAmigavel(e, "Erro ao carregar os usuários."));
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    carregarUsuarios();
    return () => {
      ativo = false;
    };
  }, [podeVisualizar, recarga]);

  // Lista completa de perfis para os selects das telas de cadastro/edição.
  React.useEffect(() => {
    if (!podeVisualizar) return undefined;
    let ativo = true;

    supabase
      .from("perfis_acesso")
      .select("id, nome, descricao")
      .order("nome", { ascending: true })
      .then(({ data }) => {
        if (ativo && data) setPerfisAcesso(data);
      });

    return () => {
      ativo = false;
    };
  }, [podeVisualizar]);

  const indicePerfil = React.useMemo(() => {
    const mapa = new Map();
    perfis.forEach((p, i) => mapa.set(p.id, i));
    return mapa;
  }, [perfis]);

  const filtrados = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (filtroPerfil !== "todos" && u.perfil_id !== filtroPerfil) return false;
      if (filtroStatus !== "todos" && u.status !== filtroStatus) return false;
      if (!termo) return true;
      return (
        (u.nome_completo ?? "").toLowerCase().includes(termo) ||
        (u.email ?? "").toLowerCase().includes(termo)
      );
    });
  }, [usuarios, busca, filtroPerfil, filtroStatus]);

  const temFiltroAtivo = busca.trim() !== "" || filtroPerfil !== "todos" || filtroStatus !== "todos";
  function limparFiltros() {
    setBusca("");
    setFiltroPerfil("todos");
    setFiltroStatus("todos");
  }

  const infoLayout = usuarioLogado ? { nome: usuarioLogado.nome_completo } : undefined;

  if (verificando) {
    return (
      <Layout usuario={infoLayout}>
        <div className="px-6 sm:px-8 py-7 text-sm text-[#0F2A44]/50">Verificando permissões...</div>
      </Layout>
    );
  }

  if (erroPermissao) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado
          modulo="Administração"
          detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`}
        />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Administração" />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">Equipe</div>
            <h1 className="text-2xl font-semibold text-[#0F2A44] mt-0.5">Usuários</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              {carregando
                ? "Carregando equipe..."
                : `${filtrados.length} de ${usuarios.length} ${usuarios.length === 1 ? "usuário" : "usuários"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAbrirNovo(true)}
            disabled={!podeCadastrar}
            title={podeCadastrar ? undefined : "Você não tem permissão para cadastrar usuários."}
            className="self-start flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-40 disabled:hover:bg-[#0F2A44]"
          >
            <Plus size={16} />
            Novo Usuário
          </button>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
            {erro}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 mb-5">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="flex items-center rounded-lg border border-black/10 overflow-hidden focus-within:border-[#0F2A44] flex-1">
              <div className="w-10 h-10 flex items-center justify-center text-[#0F2A44]/40">
                <Search size={16} />
              </div>
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou e-mail..."
                className="flex-1 px-1 py-2 text-sm outline-none placeholder:text-[#0F2A44]/30"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca("")}
                  className="w-10 h-10 flex items-center justify-center text-[#0F2A44]/30 hover:text-[#0F2A44]/70"
                  title="Limpar busca"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={filtroPerfil}
                onChange={(e) => setFiltroPerfil(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44] bg-white sm:min-w-[190px]"
              >
                <option value="todos">Todos os perfis</option>
                {perfis.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>

              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44] bg-white sm:min-w-[170px]"
              >
                <option value="todos">Todos os status</option>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
                <option value="bloqueado">Bloqueado</option>
              </select>

              {temFiltroAtivo && (
                <button
                  type="button"
                  onClick={limparFiltros}
                  className="px-3 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 whitespace-nowrap"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>
        </div>

        {carregando ? (
          <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center">
            <UsersIcon size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
            <div className="text-sm text-[#0F2A44]/40">
              {usuarios.length === 0
                ? "Nenhum usuário cadastrado ainda."
                : "Nenhum usuário encontrado com os filtros aplicados."}
            </div>
          </div>
        ) : (
          <>
            {/* Tabela — telas médias e grandes */}
            <div className="hidden md:block bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40 bg-[#F5F3EF]">
                    <th className="py-3 pl-5 pr-3 font-medium">Usuário</th>
                    <th className="py-3 px-3 font-medium">Cargo</th>
                    <th className="py-3 px-3 font-medium">E-mail</th>
                    <th className="py-3 px-3 font-medium">Perfil de acesso</th>
                    <th className="py-3 pl-3 pr-5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => setUsuarioEmEdicao(u.id)}
                      className="border-t border-black/5 hover:bg-black/[0.02] cursor-pointer"
                    >
                      <td className="py-3 pl-5 pr-3">
                        <div className="flex items-center gap-3">
                          <Avatar nome={u.nome_completo} foto={u.foto_url} />
                          <span className="font-medium text-[#0F2A44]">{u.nome_completo ?? "--"}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-[#0F2A44]/70">{u.cargo || "--"}</td>
                      <td className="py-3 px-3 text-[#0F2A44]/70 break-all">{u.email || "--"}</td>
                      <td className="py-3 px-3">
                        <BadgePerfil nome={u.perfis_acesso?.nome} indice={indicePerfil.get(u.perfil_id) ?? 0} />
                      </td>
                      <td className="py-3 pl-3 pr-5 text-right">
                        <BadgeStatus status={u.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards — telas pequenas */}
            <div className="md:hidden space-y-3">
              {filtrados.map((u) => (
                <div
                  key={u.id}
                  onClick={() => setUsuarioEmEdicao(u.id)}
                  className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <Avatar nome={u.nome_completo} foto={u.foto_url} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[#0F2A44] truncate">{u.nome_completo ?? "--"}</div>
                      <div className="text-xs text-[#0F2A44]/50">{u.cargo || "Sem cargo definido"}</div>
                      <div className="text-xs text-[#0F2A44]/50 break-all mt-0.5">{u.email || "--"}</div>
                    </div>
                    <BadgeStatus status={u.status} />
                  </div>
                  <div className="mt-3 pt-3 border-t border-black/5">
                    <BadgePerfil nome={u.perfis_acesso?.nome} indice={indicePerfil.get(u.perfil_id) ?? 0} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {abrirNovo && (
        <ModalNovoUsuario
          perfis={perfisAcesso}
          onFechar={() => setAbrirNovo(false)}
          onCriado={recarregar}
        />
      )}

      {usuarioEmEdicao && (
        <ModalEditarUsuario
          usuarioId={usuarioEmEdicao}
          perfis={perfisAcesso}
          podeEditar={podeEditar}
          onFechar={() => setUsuarioEmEdicao(null)}
          onAtualizado={recarregar}
        />
      )}
    </Layout>
  );
}
