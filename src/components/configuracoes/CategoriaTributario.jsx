import React from "react";
import { Info, Percent, ShieldAlert } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA } from "../equipe/comuns";
import { Cartao, ModalConfirmacao, RodapeFormulario } from "./comuns";
import {
  aliquotaNumero,
  LIMITE_ALIQUOTA,
  salvarTributario,
  textoAliquota,
  textoUltimaAlteracao,
} from "../../lib/configuracoesSistema";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

const CAMPOS = [
  {
    chave: "aliquota_iss_padrao",
    label: "Alíquota de ISS (%)",
    dica: "Percentual de referência do Imposto Sobre Serviços. Deixe em 0 para não sugerir nenhuma alíquota.",
  },
  {
    chave: "aliquota_ir_padrao",
    label: "Alíquota de IRPJ (%)",
    dica: "Percentual de referência do Imposto de Renda Pessoa Jurídica. Deixe em 0 para não sugerir nenhuma alíquota.",
  },
];

/** Número gravado ("5" ou 5.5) no texto que o campo mostra. */
function paraCampo(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero === 0) return "";
  return String(numero).replace(".", ",");
}

/**
 * Categoria TRIBUTÁRIO: alíquotas de referência de ISS e IRPJ.
 *
 * Duas regras valem aqui e em nenhuma outra categoria:
 *
 *  1. Confirmação explícita. Salvar abre um "Tem certeza?" com o antes e o
 *     depois de cada alíquota — parâmetro tributário não se muda por engano.
 *  2. Auditoria crítica. Toda gravação registra um evento de nível 'critico' na
 *     trilha de auditoria, com usuário, data/hora, valor anterior e valor novo.
 *
 * E uma garantia: nada é recalculado. Pagamentos, retenções e valores já
 * lançados continuam com as alíquotas que tinham quando foram registrados; o
 * número novo vale apenas para o que for informado a partir de agora.
 */
export default function CategoriaTributario({ valores, autoria, podeEditar, onSalvo }) {
  const [form, setForm] = React.useState({
    aliquota_iss_padrao: paraCampo(valores.aliquota_iss_padrao),
    aliquota_ir_padrao: paraCampo(valores.aliquota_ir_padrao),
  });
  const [confirmando, setConfirmando] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);
  const [avisoAuditoria, setAvisoAuditoria] = React.useState(null);

  React.useEffect(() => {
    setForm({
      aliquota_iss_padrao: paraCampo(valores.aliquota_iss_padrao),
      aliquota_ir_padrao: paraCampo(valores.aliquota_ir_padrao),
    });
  }, [valores]);

  function alterar(campo, valor) {
    setSucesso(null);
    // Só dígitos e um separador decimal: alíquota é percentual, não texto livre.
    const limpo = valor.replace(/[^\d.,]/g, "").replace(/\./g, ",").replace(/,(?=.*,)/g, "");
    setForm((atual) => ({ ...atual, [campo]: limpo.slice(0, 6) }));
  }

  const alterado = CAMPOS.some(
    (campo) => form[campo.chave] !== paraCampo(valores[campo.chave])
  );

  /** O que vai mudar, para o "Tem certeza?" mostrar antes de gravar. */
  const mudancas = CAMPOS.filter((campo) => form[campo.chave] !== paraCampo(valores[campo.chave])).map(
    (campo) => ({
      label: campo.label,
      antes: textoAliquota(valores[campo.chave]),
      depois: textoAliquota(aliquotaNumero(form[campo.chave])),
    })
  );

  function pedirConfirmacao(evento) {
    evento.preventDefault();
    if (salvando || !podeEditar || !alterado) return;

    // Valida antes de perguntar: ninguém confirma uma alteração que não passaria.
    const invalido = CAMPOS.find((campo) => aliquotaNumero(form[campo.chave]) === null);
    if (invalido) {
      setErro(
        `Informe ${invalido.label.toLowerCase()} entre ${LIMITE_ALIQUOTA.minimo} e ${
          LIMITE_ALIQUOTA.maximo
        }, com até duas casas decimais.`
      );
      return;
    }

    setErro(null);
    setSucesso(null);
    setConfirmando(true);
  }

  async function confirmarSalvar() {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    setAvisoAuditoria(null);
    try {
      const anterior = {
        aliquota_iss_padrao: Number(valores.aliquota_iss_padrao ?? 0),
        aliquota_ir_padrao: Number(valores.aliquota_ir_padrao ?? 0),
      };
      const gravado = await salvarTributario(form);

      // Exigência da categoria: parâmetro tributário alterado é evento crítico.
      // Usuário e data/hora são preenchidos pela própria trilha de auditoria.
      const falhaAuditoria = await registrarEvento({
        modulo: "tributario",
        acao: "alterou",
        registroAfetado: "Configurações do sistema — Parâmetros tributários (ISS e IRPJ)",
        valorAnterior: anterior,
        valorNovo: gravado,
        nivel: "critico",
      });
      if (falhaAuditoria) setAvisoAuditoria(falhaAuditoria);

      setConfirmando(false);
      setSucesso(
        "Parâmetros tributários salvos. Eles valem para os lançamentos feitos a partir de agora — nenhum pagamento ou registro anterior foi recalculado."
      );
      onSalvo(gravado);
    } catch (e) {
      setConfirmando(false);
      setErro(mensagemAmigavel(e, "Não foi possível salvar os parâmetros tributários."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <form onSubmit={pedirConfirmacao} className="space-y-5">
        <Cartao
          titulo="Parâmetros de ISS e IRPJ"
          descricao="Alíquotas de referência usadas nos lançamentos tributários de fornecedores e pagamentos."
          icone={Percent}
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

            <div className="flex items-start gap-2.5 rounded-xl border border-[#C9A227]/35 bg-[#FBF4DE] px-4 py-3 text-[#8A7526]">
              <ShieldAlert size={15} className="mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">
                Alterar uma alíquota exige confirmação e fica registrado na Auditoria como ação
                crítica, com o valor anterior, o valor novo, o usuário e a data/hora.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {CAMPOS.map((campo) => (
                <Campo key={campo.chave} label={campo.label} dica={campo.dica}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form[campo.chave]}
                    onChange={(e) => alterar(campo.chave, e.target.value)}
                    disabled={!podeEditar}
                    placeholder="0"
                    className={CLASSE_ENTRADA}
                  />
                </Campo>
              ))}
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3">
              <Info size={15} className="mt-0.5 shrink-0 text-[#0F2A44]/40" />
              <p className="text-[11px] text-[#0F2A44]/55 leading-relaxed">
                Nenhum pagamento, retenção ou valor já lançado é recalculado quando estas alíquotas
                mudam. O histórico permanece exatamente como foi registrado, e o número novo vale
                apenas para os lançamentos seguintes.
              </p>
            </div>
          </div>
        </Cartao>
      </form>

      {confirmando && (
        <ModalConfirmacao
          titulo="Tem certeza?"
          subtitulo="Alteração de parâmetro tributário"
          aviso="Esta mudança será registrada na Auditoria como ação crítica. Ela vale apenas para os lançamentos feitos a partir de agora: nenhum pagamento ou registro já existente será recalculado."
          detalhes={mudancas}
          confirmarLabel="Confirmar alteração"
          confirmando={salvando}
          onConfirmar={confirmarSalvar}
          onCancelar={() => {
            if (!salvando) setConfirmando(false);
          }}
        />
      )}
    </>
  );
}
