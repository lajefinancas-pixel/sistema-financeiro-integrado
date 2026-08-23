import React from "react";
import { Download, Eye, FileCheck2, Pencil, Plus, Settings2 } from "lucide-react";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import ModalCertidao from "../components/certidoes/ModalCertidao";
import ModalDetalheCertidao from "../components/certidoes/ModalDetalheCertidao";
import ModalTipoCertidao from "../components/certidoes/ModalTipoCertidao";
import TiposCertidao from "../components/certidoes/TiposCertidao";
import { BadgeSituacao } from "../components/certidoes/badges";
import { usePermissaoModulo } from "../lib/permissoes";
import {
  MODULO,
  formatarData,
  listarCertidoes,
  listarFornecedores,
  listarTipos,
  nomeFornecedor,
  situacaoEfetiva,
  urlDeDownload,
} from "../lib/certidoes";
import { mensagemAmigavel } from "../lib/erros";

const ABAS = [
  { id: "certidoes", label: "Certidões", icone: FileCheck2 },
  { id: "tipos", label: "Tipos de Certidão", icone: Settings2 },
];

export default function Certidoes() {
  const { carregando: verificando, usuario: usuarioLogado, permissao, erro: erroPermissao } =
    usePermissaoModulo(MODULO);

  const podeVisualizar = permissao?.pode_visualizar === true;
  const podeCadastrar = permissao?.pode_cadastrar === true;
  const podeEditar = permissao?.pode_editar === true;

  const [aba, setAba] = React.useState("certidoes");
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [certidoes, setCertidoes] = React.useState([]);
  const [tipos, setTipos] = React.useState([]);
  const [fornecedores, setFornecedores] = React.useState([]);

  const [certidaoEmEdicao, setCertidaoEmEdicao] = React.useState(null);
  const [certidaoDetalhe, setCertidaoDetalhe] = React.useState(null);
  const [tipoEmEdicao, setTipoEmEdicao] = React.useState(null);

  React.useEffect(() => {
    if (!podeVisualizar) return undefined;
    let ativo = true;

    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        const [listaCertidoes, listaTipos, listaFornecedores] = await Promise.all([
          listarCertidoes(),
          listarTipos(),
          listarFornecedores(),
        ]);
        if (!ativo) return;
        setCertidoes(listaCertidoes);
        setTipos(listaTipos);
        setFornecedores(listaFornecedores);
      } catch (e) {
        if (ativo) setErro(mensagemAmigavel(e, "Não foi possível carregar as certidões."));
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [podeVisualizar]);

  function aoSalvarCertidao(salva, edicao) {
    setCertidoes((atual) =>
      edicao ? atual.map((c) => (c.id === salva.id ? salva : c)) : [salva, ...atual],
    );
  }

  function aoSalvarTipo(salvo, edicao) {
    setTipos((atual) => {
      const lista = edicao ? atual.map((t) => (t.id === salvo.id ? salvo : t)) : [...atual, salvo];
      return [...lista].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    });
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
        <AcessoNegado modulo="Certidões" detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`} />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Certidões" />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">Documentação</div>
            <h1 className="text-2xl font-semibold text-[#0F2A44] mt-0.5">Certidões</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              {carregando
                ? "Carregando documentos..."
                : `${certidoes.length} ${
                    certidoes.length === 1 ? "certidão cadastrada" : "certidões cadastradas"
                  } para os fornecedores do sistema`}
            </p>
          </div>

          {podeCadastrar && aba === "certidoes" && (
            <button
              type="button"
              onClick={() => setCertidaoEmEdicao({})}
              className="self-start flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 whitespace-nowrap"
            >
              <Plus size={16} />
              Cadastrar Certidão
            </button>
          )}
        </div>

        {erro && (
          <div className="mb-5 border border-red-200 bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>
        )}

        <div className="flex gap-1 border-b border-black/10 mb-5 overflow-x-auto">
          {ABAS.map((item) => {
            const Icone = item.icone;
            const ativa = aba === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAba(item.id)}
                aria-current={ativa ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  ativa
                    ? "border-[#C9A227] text-[#0F2A44] font-medium"
                    : "border-transparent text-[#0F2A44]/50 hover:text-[#0F2A44]/80"
                }`}
              >
                <Icone size={15} />
                {item.label}
              </button>
            );
          })}
        </div>

        {aba === "tipos" ? (
          <TiposCertidao
            tipos={tipos}
            carregando={carregando}
            podeCadastrar={podeCadastrar}
            podeEditar={podeEditar}
            onNovo={() => setTipoEmEdicao({})}
            onEditar={(tipo) => setTipoEmEdicao(tipo)}
          />
        ) : (
          <ListaCertidoes
            certidoes={certidoes}
            carregando={carregando}
            podeEditar={podeEditar}
            onVisualizar={setCertidaoDetalhe}
            onEditar={setCertidaoEmEdicao}
          />
        )}
      </div>

      {certidaoEmEdicao && (
        <ModalCertidao
          certidao={certidaoEmEdicao.id ? certidaoEmEdicao : null}
          fornecedores={fornecedores}
          tipos={tipos}
          usuario={usuarioLogado}
          onFechar={() => setCertidaoEmEdicao(null)}
          onSalva={aoSalvarCertidao}
        />
      )}

      {certidaoDetalhe && (
        <ModalDetalheCertidao certidao={certidaoDetalhe} onFechar={() => setCertidaoDetalhe(null)} />
      )}

      {tipoEmEdicao && (
        <ModalTipoCertidao
          tipo={tipoEmEdicao.id ? tipoEmEdicao : null}
          onFechar={() => setTipoEmEdicao(null)}
          onSalvo={aoSalvarTipo}
        />
      )}
    </Layout>
  );
}

/** Listagem principal: tabela nas telas médias e cartões no celular. */
function ListaCertidoes({ certidoes, carregando, podeEditar, onVisualizar, onEditar }) {
  if (carregando) {
    return (
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-6 py-12 text-center text-sm text-[#0F2A44]/40">
        Carregando certidões...
      </div>
    );
  }

  if (certidoes.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-6 py-12 text-center">
        <FileCheck2 size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
        <div className="text-sm text-[#0F2A44]/40">
          Nenhuma certidão cadastrada ainda. Use “Cadastrar Certidão” para registrar o primeiro documento.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Tabela — telas médias e grandes */}
      <div className="hidden md:block bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40 bg-[#F5F3EF]">
              <th className="py-3 pl-5 pr-3 font-medium">Fornecedor</th>
              <th className="py-3 px-3 font-medium">Documento</th>
              <th className="py-3 px-3 font-medium whitespace-nowrap">Emissão</th>
              <th className="py-3 px-3 font-medium whitespace-nowrap">Vencimento</th>
              <th className="py-3 px-3 font-medium">Situação</th>
              <th className="py-3 pl-3 pr-5 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {certidoes.map((certidao) => (
              <tr key={certidao.id} className="border-t border-black/5 hover:bg-black/[0.02]">
                <td className="py-3 pl-5 pr-3 font-medium text-[#0F2A44]">
                  {nomeFornecedor(certidao.fornecedores)}
                  {certidao.fornecedores?.cpf_cnpj && (
                    <span className="block text-[11px] font-normal text-[#0F2A44]/40">
                      {certidao.fornecedores.cpf_cnpj}
                    </span>
                  )}
                </td>
                <td className="py-3 px-3 text-[#0F2A44]/70">
                  {certidao.tipos_certidao?.nome ?? "--"}
                  {certidao.numero_documento && (
                    <span className="block text-[11px] text-[#0F2A44]/40">nº {certidao.numero_documento}</span>
                  )}
                </td>
                <td className="py-3 px-3 text-[#0F2A44]/70 whitespace-nowrap">
                  {formatarData(certidao.data_emissao)}
                </td>
                <td className="py-3 px-3 text-[#0F2A44]/70 whitespace-nowrap">
                  {certidao.data_vencimento ? formatarData(certidao.data_vencimento) : "--"}
                </td>
                <td className="py-3 px-3">
                  <BadgeSituacao situacao={situacaoEfetiva(certidao)} />
                </td>
                <td className="py-3 pl-3 pr-5">
                  <Acoes
                    certidao={certidao}
                    podeEditar={podeEditar}
                    onVisualizar={onVisualizar}
                    onEditar={onEditar}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cartões — celular */}
      <div className="md:hidden space-y-3">
        {certidoes.map((certidao) => (
          <div key={certidao.id} className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#0F2A44] break-words">
                  {nomeFornecedor(certidao.fornecedores)}
                </div>
                <div className="text-xs text-[#0F2A44]/55 mt-0.5">
                  {certidao.tipos_certidao?.nome ?? "--"}
                  {certidao.numero_documento ? ` — nº ${certidao.numero_documento}` : ""}
                </div>
              </div>
              <BadgeSituacao situacao={situacaoEfetiva(certidao)} />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-black/5 text-xs">
              <div>
                <div className="text-[#0F2A44]/40">Emissão</div>
                <div className="text-[#0F2A44]/75 mt-0.5">{formatarData(certidao.data_emissao)}</div>
              </div>
              <div>
                <div className="text-[#0F2A44]/40">Vencimento</div>
                <div className="text-[#0F2A44]/75 mt-0.5">
                  {certidao.data_vencimento ? formatarData(certidao.data_vencimento) : "--"}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-black/5">
              <Acoes
                certidao={certidao}
                podeEditar={podeEditar}
                onVisualizar={onVisualizar}
                onEditar={onEditar}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Acoes({ certidao, podeEditar, onVisualizar, onEditar }) {
  const classe =
    "w-9 h-9 rounded-lg flex items-center justify-center text-[#0F2A44]/50 hover:text-[#0F2A44] hover:bg-black/5";

  return (
    <div className="flex items-center gap-1 md:justify-end">
      <button
        type="button"
        onClick={() => onVisualizar(certidao)}
        title="Visualizar certidão"
        aria-label="Visualizar certidão"
        className={classe}
      >
        <Eye size={16} />
      </button>

      {certidao.arquivo_url ? (
        <a
          href={urlDeDownload(certidao.arquivo_url)}
          target="_blank"
          rel="noreferrer"
          title="Baixar anexo"
          aria-label="Baixar anexo"
          className={classe}
        >
          <Download size={16} />
        </a>
      ) : (
        <span
          title="Sem anexo"
          aria-label="Sem anexo"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[#0F2A44]/15"
        >
          <Download size={16} />
        </span>
      )}

      {podeEditar && (
        <button
          type="button"
          onClick={() => onEditar(certidao)}
          title="Editar certidão"
          aria-label="Editar certidão"
          className={classe}
        >
          <Pencil size={16} />
        </button>
      )}
    </div>
  );
}
