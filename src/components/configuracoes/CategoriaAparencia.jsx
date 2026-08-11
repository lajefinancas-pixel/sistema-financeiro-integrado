import React from "react";
import { Info, Palette, Sparkles } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA } from "../equipe/comuns";
import { Cartao, RodapeFormulario, SeletorLogomarca } from "./comuns";
import {
  enviarLogomarca,
  LIMITE_LOGO_MB,
  LIMITE_NOME_EXIBICAO,
  nomeExibidoDoSistema,
  salvarAparencia,
  salvarLogomarcaSistema,
  textoUltimaAlteracao,
} from "../../lib/configuracoesSistema";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

/**
 * Categoria APARÊNCIA: a identidade visual do sistema — logomarca e nome exibido.
 *
 * A logomarca é a MESMA imagem da categoria Geral. Quando já existe uma
 * logomarca configurada lá, ela aparece aqui como a atual; trocar ou remover
 * aqui substitui aquela, em vez de criar uma segunda logomarca no sistema.
 *
 * O nome exibido é gravado na chave própria 'aparencia'. Deixá-lo vazio é uma
 * escolha válida: o sistema volta a usar o nome definido em Geral.
 *
 * Aparência é só identidade visual. Nada nesta categoria altera componentes
 * funcionais, colunas, filtros, permissões ou as ordens já aprovadas nas telas
 * de Painel Principal, Saldos, Fornecedores, Pagamentos, Equipe, Tarefas,
 * Histórico, Relatórios e Auditoria.
 */
export default function CategoriaAparencia({ valores, geral, autoria, podeEditar, onSalvo }) {
  const nomeGravado = valores?.nome_exibicao ?? "";
  const logoGravada = geral?.logo_url ?? null;

  const [nome, setNome] = React.useState(nomeGravado);
  const [logo, setLogo] = React.useState(null); // imagem nova, ainda não enviada
  const [logoRemovida, setLogoRemovida] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);
  const [avisoAuditoria, setAvisoAuditoria] = React.useState(null);

  // Quando a página recarrega os valores (depois de salvar), o formulário acompanha.
  React.useEffect(() => {
    setNome(nomeGravado);
    setLogo(null);
    setLogoRemovida(false);
  }, [nomeGravado, logoGravada]);

  const logoAtual = logoRemovida ? null : logoGravada;
  const nomeLimpo = nome.trim().replace(/\s+/g, " ");
  const logoAlterada = logo !== null || (logoRemovida && logoGravada !== null);
  const alterado = logoAlterada || nomeLimpo !== String(nomeGravado).trim();

  // Prévia da imagem escolhida agora: criada uma vez e liberada ao trocar/sair,
  // para não deixar URLs temporárias abertas a cada redesenho da tela.
  const [previaArquivo, setPreviaArquivo] = React.useState(null);
  React.useEffect(() => {
    if (!logo) {
      setPreviaArquivo(null);
      return undefined;
    }
    const url = URL.createObjectURL(logo);
    setPreviaArquivo(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const previaLogo = previaArquivo ?? logoAtual;

  const previaNome = nomeExibidoDoSistema({
    aparencia: { nome_exibicao: nomeLimpo },
    geral,
  });

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando || !podeEditar || !alterado) return;

    setSalvando(true);
    setErro(null);
    setSucesso(null);
    setAvisoAuditoria(null);
    try {
      // A imagem sobe primeiro: se o envio falhar, nada é gravado na tabela.
      let geralGravado = geral;
      if (logoAlterada) {
        const logoUrl = logo ? await enviarLogomarca(logo) : null;
        geralGravado = await salvarLogomarcaSistema(geral, logoUrl);
      }

      let aparenciaGravada = { nome_exibicao: String(nomeGravado).trim() };
      if (nomeLimpo !== String(nomeGravado).trim()) {
        aparenciaGravada = await salvarAparencia({ nome_exibicao: nomeLimpo });
      }

      // Aparência é uma alteração de identidade visual, sem efeito sobre valores
      // ou regras — entra na trilha com nível de informação.
      const falhaAuditoria = await registrarEvento({
        modulo: "administracao",
        acao: "alterou",
        registroAfetado: "Configurações do sistema — Aparência",
        valorAnterior: { nome_exibicao: nomeGravado, logo_url: logoGravada },
        valorNovo: {
          nome_exibicao: aparenciaGravada.nome_exibicao,
          logo_url: geralGravado?.logo_url ?? null,
        },
        nivel: "informacao",
      });
      if (falhaAuditoria) setAvisoAuditoria(falhaAuditoria);

      setSucesso(
        logoAlterada
          ? "Aparência salva. A logomarca do sistema foi substituída — é a mesma imagem da categoria Geral."
          : "Aparência salva."
      );
      onSalvo(aparenciaGravada);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar a aparência do sistema."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-5">
      <Cartao
        titulo="Identidade visual"
        descricao="A logomarca e o nome com que o sistema se apresenta na tela e nos documentos."
        icone={Palette}
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
          {avisoAuditoria && <Alerta tipo="erro">{avisoAuditoria}</Alerta>}

          <div className="flex items-start gap-2.5 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3">
            <Info size={15} className="mt-0.5 shrink-0 text-[#0F2A44]/40" />
            <p className="text-[11px] text-[#0F2A44]/55 leading-relaxed">
              Estas opções mudam apenas a apresentação do sistema. Nenhum componente funcional,
              coluna, filtro, permissão ou ordem já aprovada nas demais telas é alterado por elas.
            </p>
          </div>

          <div>
            <span className="text-xs font-medium text-[#0F2A44]/70">Logo do sistema</span>
            <p className="text-[11px] text-[#0F2A44]/45 mt-0.5 leading-relaxed">
              É a mesma logomarca da categoria Geral: se já houver uma configurada lá, ela aparece
              abaixo. Enviar uma nova imagem aqui substitui aquela — o sistema mantém uma logomarca
              só.
            </p>
            <div className="mt-3">
              <SeletorLogomarca
                urlAtual={logoAtual}
                arquivo={logo}
                limiteMb={LIMITE_LOGO_MB}
                desabilitado={!podeEditar || salvando}
                onSelecionar={(arquivo) => {
                  setSucesso(null);
                  setErro(null);
                  setLogoRemovida(false);
                  setLogo(arquivo);
                }}
                onRemover={() => {
                  setSucesso(null);
                  setLogo(null);
                  setLogoRemovida(true);
                }}
              />
            </div>
          </div>

          <div className="pt-4 border-t border-black/5">
            <Campo
              label="Nome exibido no sistema"
              dica="Deixe em branco para usar o nome do sistema definido na categoria Geral."
            >
              <input
                type="text"
                value={nome}
                onChange={(e) => {
                  setSucesso(null);
                  setNome(e.target.value);
                }}
                disabled={!podeEditar || salvando}
                maxLength={LIMITE_NOME_EXIBICAO}
                placeholder={geral?.nome_sistema || "Sistema Financeiro Integrado"}
                className={CLASSE_ENTRADA}
              />
            </Campo>

            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#0F2A44]/40 mb-2">
                Prévia
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-black/5 bg-[#0F2A44] px-4 py-3.5">
                <div className="w-11 h-11 rounded-xl bg-white/10 border border-[#C9A227]/40 flex items-center justify-center shrink-0 overflow-hidden">
                  {previaLogo ? (
                    <img src={previaLogo} alt="" className="w-full h-full object-contain p-1" />
                  ) : (
                    <Sparkles size={17} className="text-[#C9A227]" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">
                    {geral?.nome_instituicao || "Instituição"}
                  </div>
                  <div className="text-sm font-medium text-white truncate">{previaNome}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Cartao>

      <Cartao
        titulo="Em breve"
        descricao="Preferências visuais previstas para uma próxima etapa, ainda não construídas."
        icone={Sparkles}
      >
        <ul className="divide-y divide-black/5 rounded-xl border border-black/5 overflow-hidden">
          {[
            {
              titulo: "Tema claro e escuro",
              descricao: "Alternar a paleta do sistema entre claro e escuro.",
            },
            {
              titulo: "Modo compacto",
              descricao: "Reduzir espaçamentos para mostrar mais linhas por tela.",
            },
          ].map((item) => (
            <li key={item.titulo} className="flex items-start gap-4 px-4 py-3.5 bg-white">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[#0F2A44]/50">{item.titulo}</div>
                <p className="text-[11px] text-[#0F2A44]/40 mt-0.5 leading-relaxed">
                  {item.descricao}
                </p>
              </div>
              <span className="text-[9px] uppercase tracking-[0.14em] text-[#0F2A44]/30 shrink-0 mt-1">
                Em breve
              </span>
            </li>
          ))}
        </ul>
      </Cartao>
    </form>
  );
}
