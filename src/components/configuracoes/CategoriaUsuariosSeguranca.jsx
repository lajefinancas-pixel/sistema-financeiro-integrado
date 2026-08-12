import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ShieldCheck, UserCog, Users } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA } from "../equipe/comuns";
import { Cartao, RodapeFormulario } from "./comuns";
import {
  LIMITE_SESSAO,
  LIMITE_TENTATIVAS,
  listarUsuariosPorSituacao,
  salvarSeguranca,
  textoUltimaAlteracao,
} from "../../lib/configuracoesSistema";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

const ATALHOS = [
  {
    to: "/equipe/usuarios",
    icone: UserCog,
    titulo: "Usuários",
    descricao: "Cadastrar, editar, definir situação e redefinir senha dos usuários da equipe.",
  },
  {
    to: "/equipe/usuarios",
    icone: ShieldCheck,
    titulo: "Cargos e Permissões",
    descricao:
      "Perfis de acesso e permissões por módulo: abra o usuário no atalho Usuários acima e use a aba Permissões.",
  },
];

const SITUACOES = {
  ativo: { label: "Ativo", cor: "#16A34A", bg: "#EAFBF0", ponto: "#16A34A" },
  bloqueado: { label: "Bloqueado", cor: "#DC2626", bg: "#FEF2F2", ponto: "#DC2626" },
};

function BadgeSituacao({ status }) {
  const info = SITUACOES[status] ?? { label: status ?? "--", cor: "#64748B", bg: "#F1F5F9", ponto: "#94A3B8" };
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

function ListaUsuarios({ titulo, usuarios, vazio }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <h3 className="text-xs uppercase tracking-[0.14em] text-[#0F2A44]/45 font-medium">{titulo}</h3>
        <span className="text-xs text-[#0F2A44]/45">{usuarios.length}</span>
      </div>
      {usuarios.length === 0 ? (
        <p className="text-xs text-[#0F2A44]/40 rounded-xl border border-dashed border-black/10 px-4 py-5 text-center">
          {vazio}
        </p>
      ) : (
        <ul className="divide-y divide-black/5 rounded-xl border border-black/5 overflow-hidden">
          {usuarios.map((usuario) => (
            <li key={usuario.id} className="flex items-center gap-3 px-4 py-3 bg-white">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[#0F2A44] truncate">{usuario.nome_completo}</div>
                <div className="text-[11px] text-[#0F2A44]/50 truncate">
                  {[usuario.cargo, usuario.perfis_acesso?.nome].filter(Boolean).join(" · ") ||
                    usuario.email ||
                    "Sem cargo definido"}
                </div>
              </div>
              <BadgeSituacao status={usuario.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Categoria USUÁRIOS E SEGURANÇA: atalhos para as telas de equipe, política de
 * sessão/bloqueio e o panorama somente-leitura de quem está ativo ou bloqueado.
 *
 * Nada aqui duplica Equipe > Usuários: a lista não edita, não desbloqueia e
 * nunca mostra senha — cadastro e senha continuam sendo tratados lá.
 */
export default function CategoriaUsuariosSeguranca({ valores, autoria, podeEditar, onSalvo }) {
  const [form, setForm] = React.useState({
    sessao_minutos: String(valores.sessao_minutos ?? ""),
    tentativas_bloqueio: String(valores.tentativas_bloqueio ?? ""),
  });
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);

  const [usuarios, setUsuarios] = React.useState({ ativos: [], bloqueados: [] });
  const [carregandoUsuarios, setCarregandoUsuarios] = React.useState(true);
  const [erroUsuarios, setErroUsuarios] = React.useState(null);

  React.useEffect(() => {
    setForm({
      sessao_minutos: String(valores.sessao_minutos ?? ""),
      tentativas_bloqueio: String(valores.tentativas_bloqueio ?? ""),
    });
  }, [valores]);

  React.useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const lista = await listarUsuariosPorSituacao();
        if (ativo) setUsuarios(lista);
      } catch (e) {
        if (ativo) setErroUsuarios(mensagemAmigavel(e, "Não foi possível carregar a situação dos usuários."));
      } finally {
        if (ativo) setCarregandoUsuarios(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  function alterar(campo, valor) {
    setSucesso(null);
    // Somente dígitos: os dois campos são quantidades inteiras.
    setForm((atual) => ({ ...atual, [campo]: valor.replace(/\D/g, "").slice(0, 4) }));
  }

  const alterado =
    form.sessao_minutos !== String(valores.sessao_minutos ?? "") ||
    form.tentativas_bloqueio !== String(valores.tentativas_bloqueio ?? "");

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando || !podeEditar) return;

    setSalvando(true);
    setErro(null);
    setSucesso(null);
    try {
      const gravado = await salvarSeguranca(form);

      await registrarEvento({
        modulo: "administracao",
        acao: "alterou",
        registroAfetado: "Configurações do sistema — Segurança de acesso",
        valorAnterior: valores,
        valorNovo: gravado,
        nivel: "critico",
      });

      setSucesso("Política de acesso salva.");
      onSalvo(gravado);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar a política de acesso."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-5">
      <Cartao
        titulo="Atalhos de acesso"
        descricao="O cadastro de usuários e a definição de permissões são feitos na tela de Usuários, acessada pelos atalhos abaixo."
        icone={UserCog}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {ATALHOS.map((atalho) => (
            <Link
              key={atalho.titulo}
              to={atalho.to}
              className="flex items-center gap-3 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3.5 hover:bg-[#F5F3EF]"
            >
              <div className="w-9 h-9 rounded-xl bg-white border border-[#C9A227]/30 flex items-center justify-center shrink-0">
                <atalho.icone size={16} className="text-[#0F2A44]" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#0F2A44]">{atalho.titulo}</div>
                <div className="text-[11px] text-[#0F2A44]/55 mt-0.5 leading-relaxed">{atalho.descricao}</div>
              </div>
              <ChevronRight size={16} className="text-[#0F2A44]/25 ml-auto shrink-0" />
            </Link>
          ))}
        </div>
      </Cartao>

      <form onSubmit={salvar}>
        <Cartao
          titulo="Política de acesso"
          descricao="Tempo de inatividade que encerra a sessão e quantas tentativas incorretas de login bloqueiam o acesso."
          icone={ShieldCheck}
          rodape={
            <RodapeFormulario
              ultimaAlteracao={textoUltimaAlteracao(autoria)}
              podeEditar={podeEditar}
              salvando={salvando}
              alterado={alterado}
            />
          }
        >
          <div className="space-y-5">
            {erro && <Alerta tipo="erro">{erro}</Alerta>}
            {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Campo
                label="Tempo máximo de sessão (minutos)"
                obrigatorio
                dica={`Entre ${LIMITE_SESSAO.minimo} e ${LIMITE_SESSAO.maximo} minutos.`}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.sessao_minutos}
                  onChange={(e) => alterar("sessao_minutos", e.target.value)}
                  disabled={!podeEditar}
                  className={CLASSE_ENTRADA}
                />
              </Campo>

              <Campo
                label="Bloqueio após tentativas incorretas de login"
                obrigatorio
                dica={`Entre ${LIMITE_TENTATIVAS.minimo} e ${LIMITE_TENTATIVAS.maximo} tentativas.`}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.tentativas_bloqueio}
                  onChange={(e) => alterar("tentativas_bloqueio", e.target.value)}
                  disabled={!podeEditar}
                  className={CLASSE_ENTRADA}
                />
              </Campo>
            </div>

            <p className="text-[11px] text-[#0F2A44]/45 leading-relaxed">
              As senhas dos usuários nunca são exibidas em nenhuma tela do sistema. Para dar um novo
              acesso a alguém, use "Redefinir senha" no cadastro do usuário, no atalho Usuários
              desta página.
            </p>
          </div>
        </Cartao>
      </form>

      <Cartao
        titulo="Situação dos usuários"
        descricao="Panorama somente leitura de quem está ativo e de quem está bloqueado no sistema."
        icone={Users}
      >
        {carregandoUsuarios ? (
          <p className="text-sm text-[#0F2A44]/45">Carregando usuários...</p>
        ) : erroUsuarios ? (
          <Alerta tipo="erro">{erroUsuarios}</Alerta>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ListaUsuarios titulo="Ativos" usuarios={usuarios.ativos} vazio="Nenhum usuário ativo." />
            <ListaUsuarios
              titulo="Bloqueados"
              usuarios={usuarios.bloqueados}
              vazio="Nenhum usuário bloqueado."
            />
          </div>
        )}
      </Cartao>
    </div>
  );
}
