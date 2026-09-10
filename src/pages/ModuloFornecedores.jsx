import React from "react";
import { Navigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import Fornecedores from "./Fornecedores";
import SubabasFornecedores from "../components/fornecedores/areas/SubabasFornecedores.jsx";
import PaginaAreaFornecedores from "../components/fornecedores/areas/PaginaAreaFornecedores.jsx";
import { areaPorRota } from "../lib/areasFornecedores.js";
import { usePermissoesAreasFornecedores } from "../lib/permissoesAreasFornecedores.js";
import { carregarFornecedoresDaBaixa } from "../lib/baixasPagamentos";
import { carregarSecretariasDasAreas } from "../lib/areasFornecedoresDados.js";

/**
 * O módulo Fornecedores com as suas subabas: Todos | Patrocínios | Aluguéis |
 * Bandas.
 *
 * "Todos" é a página de Fornecedores como ela sempre foi — este componente não
 * a redesenha nem reimplementa: ele a renderiza inteira, passando apenas a
 * faixa de subabas para o topo. Tudo o que a aba tinha (total em aberto,
 * imprimir, PDF, Excel, novo valor em aberto, novo fornecedor, busca,
 * ordenação, filtros avançados, lista, certidões, situação, valores, ver
 * detalhes e dados para pagamento) continua vindo de lá, sem alteração.
 *
 * As outras três subabas são áreas operacionais próprias, e nenhuma delas é
 * categoria ou tipo de fornecedor: cada registro aponta para um fornecedor que
 * já existe, e o mesmo fornecedor pode aparecer nas três ao mesmo tempo sem
 * nunca ser recadastrado.
 *
 * A navegação é por rota (`/fornecedores/bandas`), dentro da própria página:
 * nenhum item novo entra no menu lateral, e o item "Fornecedores" da lateral
 * continua destacado nas subabas.
 */
export default function ModuloFornecedores() {
  const { area: rota } = useParams();
  const { carregando, usuario, permissoes, erro } = usePermissoesAreasFornecedores();
  const area = areaPorRota(rota);

  const [apoio, setApoio] = React.useState({ fornecedores: [], secretarias: [], carregando: false });

  // Fornecedores e secretarias só são carregados nas áreas; na aba "Todos" quem
  // carrega é a página de sempre, e nada muda para ela.
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

  const subabas = <SubabasFornecedores permissoes={permissoes} />;
  const infoLayout = usuario ? { nome: usuario.nome_completo } : undefined;

  // Rota de área desconhecida volta para a aba "Todos".
  if (rota && !area) return <Navigate to="/fornecedores" replace />;

  // Aba "Todos": a página de Fornecedores, inteira e inalterada.
  if (!area) return <Fornecedores subabas={subabas} />;

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

  // Quem não pode visualizar a área não vê a subaba dela e também não entra
  // pela rota. A recusa definitiva é a do banco: a RLS das tabelas confere
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
        {subabas}
        <PaginaAreaFornecedores
          area={area}
          permissao={permissoes[area.id]}
          fornecedores={apoio.fornecedores}
          secretarias={apoio.secretarias}
          carregandoApoio={apoio.carregando}
        />
      </div>
    </Layout>
  );
}
