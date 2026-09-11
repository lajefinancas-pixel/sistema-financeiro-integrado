import React from "react";
import { Navigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import PaginaDiarias from "../components/processos/PaginaDiarias.jsx";
import { usePermissoesProcessos } from "../lib/permissoesProcessos.js";
import { podeVerDiarias } from "../lib/processosDiarias.js";
import { carregarSecretarias } from "../lib/processosDiariasDados.js";
import { carregarFornecedoresDaBaixa } from "../lib/baixasPagamentos";

/**
 * O módulo PROCESSOS e as suas áreas.
 *
 * Neste envio existe uma área: DIÁRIAS. Serviços/Materiais, o arquivo
 * permanente e as configurações institucionais vêm nos envios próprios deles —
 * as rotas ainda não existem, e uma rota desconhecida volta para Diárias.
 *
 * PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO. Nenhuma tela deste módulo debita
 * conta, dá baixa em NF, altera saldo, marca fornecedor como pago, cria
 * pagamento ou mexe na Programação Diária. As secretarias e os fornecedores são
 * os JÁ CADASTRADOS no sistema: o módulo lê as duas listas e não cria nenhuma
 * segunda lista, nem grava nos cadastros.
 */
export default function ModuloProcessos() {
  const { area: rota } = useParams();
  const { carregando, usuario, permissoes, erro } = usePermissoesProcessos();
  const area = rota === undefined || rota === "diarias" ? "diarias" : null;

  const [apoio, setApoio] = React.useState({ fornecedores: [], secretarias: [], carregando: true });

  // Fornecedores para a busca do beneficiário e secretarias para os Dados
  // Gerais. Só leitura: nada é gravado em nenhum dos dois cadastros.
  React.useEffect(() => {
    if (!area) return undefined;
    let ativo = true;
    setApoio((atual) => ({ ...atual, carregando: true }));

    Promise.all([
      carregarFornecedoresDaBaixa().catch(() => []),
      carregarSecretarias().catch(() => []),
    ]).then(([fornecedores, secretarias]) => {
      if (ativo) setApoio({ fornecedores, secretarias, carregando: false });
    });

    return () => {
      ativo = false;
    };
  }, [area]);

  const infoLayout = usuario ? { nome: usuario.nome_completo } : undefined;

  if (!area) return <Navigate to="/processos/diarias" replace />;

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
        <AcessoNegado modulo="Processos · Diárias" detalhe={`Não foi possível confirmar suas permissões: ${erro}`} />
      </Layout>
    );
  }

  // Quem não pode visualizar não vê a subaba no menu e também não entra pela
  // rota. A recusa definitiva é a do banco: a RLS das tabelas do módulo confere
  // `pode_em_processos` antes de devolver qualquer linha.
  if (!podeVerDiarias(permissoes)) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Processos · Diárias" />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 py-6 sm:px-8 sm:py-7">
        <PaginaDiarias
          permissoes={permissoes}
          fornecedores={apoio.fornecedores}
          secretarias={apoio.secretarias}
          carregandoApoio={apoio.carregando}
          usuario={usuario}
        />
      </div>
    </Layout>
  );
}
