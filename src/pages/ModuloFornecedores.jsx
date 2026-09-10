import React from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import Fornecedores from "./Fornecedores";
import PaginaAreaFornecedores from "../components/fornecedores/areas/PaginaAreaFornecedores.jsx";
import { areaPorRota } from "../lib/areasFornecedores.js";
import { usePermissoesAreasFornecedores } from "../lib/permissoesAreasFornecedores.js";
import { usePermissaoModulo } from "../lib/permissoes";
import { carregarFornecedoresDaBaixa } from "../lib/baixasPagamentos";
import { carregarSecretariasDasAreas } from "../lib/areasFornecedoresDados.js";

/**
 * O módulo Fornecedores e as suas áreas: Todos os Fornecedores, Patrocínios,
 * Aluguéis e Bandas.
 *
 * "Todos os Fornecedores" é a página de Fornecedores como ela sempre foi — este
 * componente não a redesenha nem reimplementa: ele a renderiza inteira. Tudo o
 * que ela tinha (total em aberto, imprimir, PDF, Excel, novo valor em aberto,
 * novo fornecedor, busca, ordenação, filtros avançados, lista, certidões,
 * situação, valores, ver detalhes e dados para pagamento) continua vindo de lá,
 * sem alteração.
 *
 * As outras três são áreas operacionais próprias, e nenhuma delas é categoria
 * ou tipo de fornecedor: cada registro aponta para um fornecedor que já existe,
 * e o mesmo fornecedor pode aparecer nas três ao mesmo tempo sem nunca ser
 * recadastrado.
 *
 * A navegação continua por rota (`/fornecedores/bandas`), mas o acesso é
 * exclusivamente pelo SUBMENU DE FORNECEDORES no menu lateral (em
 * components/Layout.jsx): a faixa de subabas no topo da página não existe mais,
 * para não haver duas navegações para o mesmo lugar.
 */
export default function ModuloFornecedores() {
  const { area: rota } = useParams();
  const [parametros] = useSearchParams();
  const { carregando, usuario, permissoes, erro } = usePermissoesAreasFornecedores();
  // Quem manda um registro para a Programação Diária precisa poder editar a
  // programação. A permissão é lida do módulo 'pagamentos', o mesmo que a tela
  // de Pagamentos usa — e, como lá, a ausência de linha não bloqueia.
  const { permissao: permissaoPagamentos } = usePermissaoModulo("pagamentos");
  const area = areaPorRota(rota);
  // /fornecedores/bandas?fornecedor=12 — vem dos "Vínculos Específicos" da
  // ficha do fornecedor e apenas recorta a lista pelo fornecedor_id.
  const fornecedorInicial = parametros.get("fornecedor") ?? "";

  const [apoio, setApoio] = React.useState({ fornecedores: [], secretarias: [], carregando: false });

  // Fornecedores e secretarias só são carregados nas áreas; em "Todos os
  // Fornecedores" quem carrega é a página de sempre, e nada muda para ela.
  React.useEffect(() => {
    if (!area) return;
    let ativo = true;
    setApoio((atual) => ({ ...atual, carregando: true }));

    Promise.all([
      carregarFornecedoresDaBaixa().catch(() => []),
      carregarSecretariasDasAreas().catch(() => []),
    ]).then(([fornecedores, secretarias]) => {
      if (ativo) setApoio({ fornecedores, secretarias, carregando: false });
    });

    return () => {
      ativo = false;
    };
  }, [area]);

  const infoLayout = usuario ? { nome: usuario.nome_completo } : undefined;

  // Rota de área desconhecida volta para "Todos os Fornecedores".
  if (rota && !area) return <Navigate to="/fornecedores" replace />;

  // "Todos os Fornecedores": a página de Fornecedores, inteira e inalterada.
  if (!area) return <Fornecedores />;

  if (carregando) {
    return (
      <Layout usuario={infoLayout}>
        <div className="px-6 py-7 text-sm text-[#0F2A44]/50 sm:px-8">Verificando permissões...</div>
      </Layout>
    );
  }

  if (erro) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado
          modulo={area.rotulo}
          detalhe={`Não foi possível confirmar suas permissões: ${erro}`}
        />
      </Layout>
    );
  }

  // Quem não pode visualizar a área não vê o item dela no submenu e também não
  // entra pela rota. A recusa definitiva é a do banco: a RLS das tabelas confere
  // pode_em_area_fornecedor antes de devolver qualquer linha.
  if (!permissoes?.[area.id]?.visualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo={area.rotulo} />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 py-6 sm:px-8 sm:py-7">
        <PaginaAreaFornecedores
          area={area}
          permissao={permissoes[area.id]}
          fornecedores={apoio.fornecedores}
          secretarias={apoio.secretarias}
          carregandoApoio={apoio.carregando}
          podeProgramar={permissaoPagamentos?.pode_editar !== false}
          fornecedorInicial={fornecedorInicial}
        />
      </div>
    </Layout>
  );
}
