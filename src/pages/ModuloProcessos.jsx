import React from "react";
import { Navigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import PaginaDiarias from "../components/processos/PaginaDiarias.jsx";
import PaginaServidores from "../components/processos/PaginaServidores.jsx";
import { usePermissoesProcessos } from "../lib/permissoesProcessos.js";
import { podeVerDiarias } from "../lib/processosDiarias.js";
import { podeVerServidores } from "../lib/processosServidores.js";
import { carregarSecretarias } from "../lib/processosDiariasDados.js";
import { carregarServidores } from "../lib/processosServidoresDados.js";
import { carregarBancos, carregarSolicitantes } from "../lib/processosCadastrosDados.js";
import { listaDeSecretariasDoProcesso } from "../lib/processosSecretariasSolicitantes.js";
import { carregarFornecedoresDaBaixa } from "../lib/baixasPagamentos";

/**
 * O módulo PROCESSOS e as suas áreas.
 *
 * Neste envio existem duas: DIÁRIAS e SERVIDORES. Serviços/Materiais, o arquivo
 * permanente e as configurações institucionais vêm nos envios próprios deles --
 * as rotas ainda não existem, e uma rota desconhecida volta para Diárias.
 *
 * SERVIDORES é o CADASTRO das pessoas que trabalham no município, e tem
 * permissão própria: quem vê Diárias não passa a ver Servidores. ⚠️ Ele NÃO é o
 * cadastro de fornecedores e não se mistura com ele -- fornecedor vende para o
 * município, servidor trabalha nele.
 *
 * PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO. Nenhuma tela deste módulo debita
 * conta, dá baixa em NF, altera saldo, marca fornecedor como pago, cria
 * pagamento ou mexe na Programação Diária.
 *
 * ⚠️ AS SECRETARIAS SOLICITANTES SÃO UM CADASTRO À PARTE. Quem REQUISITA a
 * diária vem de `processos_secretarias_solicitantes`, o cadastro próprio do
 * módulo; o cadastro de secretarias do MÓDULO FINANCEIRO (`secretarias`) segue
 * intocado, servindo contas bancárias, fornecedores, Saldos, Pagamentos e
 * relatórios. Os dois coexistem, cada um com a sua finalidade, e este módulo só
 * LÊ o financeiro -- e só para que processo antigo continue mostrando a
 * secretaria que gravou. Fornecedores também são só leitura.
 */
const AREAS = ["diarias", "servidores"];

export default function ModuloProcessos() {
  const { area: rota } = useParams();
  const { carregando, usuario, permissoes, permissoesServidores, erro } = usePermissoesProcessos();
  const area = rota === undefined ? "diarias" : AREAS.includes(rota) ? rota : null;

  const [apoio, setApoio] = React.useState({
    fornecedores: [],
    solicitantes: [],
    secretariasFinanceiras: [],
    bancos: [],
    servidores: [],
    carregando: true,
  });

  // Fornecedores para os vínculos antigos, secretarias para os Dados Gerais e
  // SERVIDORES para a escolha do beneficiário e dos signatários. Só leitura:
  // nada é gravado em nenhum dos três cadastros a partir daqui.
  React.useEffect(() => {
    if (!area) return undefined;
    let ativo = true;
    setApoio((atual) => ({ ...atual, carregando: true }));

    Promise.all([
      carregarFornecedoresDaBaixa().catch(() => []),
      // As SOLICITANTES: o cadastro do módulo, o que o formulário oferece.
      carregarSolicitantes().catch(() => []),
      // As secretarias do financeiro: LEITURA, e só para o processo antigo
      // continuar mostrando a secretaria que gravou.
      carregarSecretarias().catch(() => []),
      carregarBancos().catch(() => []),
      // O cadastro de servidores pode ainda não existir no banco (a migration é
      // rodada à mão): sem ele, o formulário da diária continua sendo
      // preenchido à mão, como sempre foi.
      carregarServidores().catch(() => []),
    ]).then(([fornecedores, solicitantes, secretariasFinanceiras, bancos, servidores]) => {
      if (ativo) {
        setApoio({ fornecedores, solicitantes, secretariasFinanceiras, bancos, servidores, carregando: false });
      }
    });

    return () => {
      ativo = false;
    };
  }, [area]);

  // A lista única que as telas usam para RESOLVER NOME e FILTRAR: as
  // solicitantes primeiro, as financeiras depois (só o processo antigo as usa).
  const secretariasParaConsulta = React.useMemo(
    () => listaDeSecretariasDoProcesso(apoio.solicitantes, apoio.secretariasFinanceiras),
    [apoio.solicitantes, apoio.secretariasFinanceiras],
  );

  const infoLayout = usuario ? { nome: usuario.nome_completo } : undefined;

  if (!area) return <Navigate to="/processos/diarias" replace />;

  const rotuloDaArea = area === "servidores" ? "Processos · Servidores" : "Processos · Diárias";

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
        <AcessoNegado modulo={rotuloDaArea} detalhe={`Não foi possível confirmar suas permissões: ${erro}`} />
      </Layout>
    );
  }

  // Quem não pode visualizar não vê a subaba no menu e também não entra pela
  // rota. Cada subaba tem a permissão DELA. A recusa definitiva é a do banco: a
  // RLS das tabelas do módulo confere `pode_em_processos` antes de devolver
  // qualquer linha.
  const liberado = area === "servidores" ? podeVerServidores(permissoesServidores) : podeVerDiarias(permissoes);
  if (!liberado) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo={rotuloDaArea} />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 py-6 sm:px-8 sm:py-7">
        {area === "servidores" ? (
          <PaginaServidores
            permissoes={permissoesServidores}
            solicitantes={apoio.solicitantes}
            secretarias={secretariasParaConsulta}
            bancos={apoio.bancos}
            carregandoApoio={apoio.carregando}
          />
        ) : (
          <PaginaDiarias
            permissoes={permissoes}
            permissoesServidores={permissoesServidores}
            fornecedores={apoio.fornecedores}
            solicitantes={apoio.solicitantes}
            secretarias={secretariasParaConsulta}
            bancos={apoio.bancos}
            servidores={apoio.servidores}
            carregandoApoio={apoio.carregando}
            usuario={usuario}
          />
        )}
      </div>
    </Layout>
  );
}
