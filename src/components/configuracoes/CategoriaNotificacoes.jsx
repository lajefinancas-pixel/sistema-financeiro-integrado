import React from "react";
import { Bell, BellRing, Info } from "lucide-react";
import { Alerta } from "../equipe/comuns";
import { Cartao, Interruptor, RodapeFormulario } from "./comuns";
import {
  NOTIFICACOES_PADRAO,
  salvarNotificacoes,
  textoUltimaAlteracao,
  TIPOS_NOTIFICACAO,
} from "../../lib/configuracoesSistema";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

/** Os valores gravados como um formulário de interruptores (ausente = ligado). */
function paraForm(valores) {
  return Object.fromEntries(
    TIPOS_NOTIFICACAO.map((tipo) => [tipo.chave, valores?.[tipo.chave] !== false])
  );
}

/**
 * Categoria NOTIFICAÇÕES: quais avisos o sistema gera automaticamente.
 *
 * A preferência é do sistema, não de cada pessoa — quem tem permissão de edição
 * em Administração define o que a equipe inteira recebe. Foi o caminho mais
 * simples e confiável com o que já existe no banco: uma única chave em
 * configuracoes_sistema, lida por qualquer usuário ativo no momento em que o
 * aviso seria criado.
 *
 * Desligar um tipo não apaga nem esconde nada: os avisos já recebidos continuam
 * no sino de notificações, e a mudança vale só para os próximos.
 */
export default function CategoriaNotificacoes({ valores, autoria, podeEditar, onSalvo }) {
  const gravado = valores ?? NOTIFICACOES_PADRAO;
  const [form, setForm] = React.useState(() => paraForm(gravado));
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);
  const [avisoAuditoria, setAvisoAuditoria] = React.useState(null);

  React.useEffect(() => {
    setForm(paraForm(gravado));
  }, [gravado]);

  const alterado = TIPOS_NOTIFICACAO.some(
    (tipo) => form[tipo.chave] !== (gravado?.[tipo.chave] !== false)
  );
  const desligados = TIPOS_NOTIFICACAO.filter((tipo) => !form[tipo.chave]).length;

  function alternar(chave, ligado) {
    setSucesso(null);
    setForm((atual) => ({ ...atual, [chave]: ligado }));
  }

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando || !podeEditar || !alterado) return;

    setSalvando(true);
    setErro(null);
    setSucesso(null);
    setAvisoAuditoria(null);
    try {
      const anterior = paraForm(gravado);
      const salvo = await salvarNotificacoes(form);

      // Mudar o que o sistema avisa é uma alteração de comportamento: fica
      // registrada na trilha, com o antes e o depois de cada tipo.
      const falhaAuditoria = await registrarEvento({
        modulo: "administracao",
        acao: "alterou",
        registroAfetado: "Configurações do sistema — Notificações",
        valorAnterior: anterior,
        valorNovo: salvo,
        nivel: "atencao",
      });
      if (falhaAuditoria) setAvisoAuditoria(falhaAuditoria);

      setSucesso(
        "Preferências de notificação salvas. Elas valem para os avisos gerados a partir de agora — nenhuma notificação já recebida foi apagada."
      );
      onSalvo(salvo);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar as preferências de notificação."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-5">
      <Cartao
        titulo="Avisos do sistema"
        descricao="Ligue ou desligue cada tipo de aviso que o sistema envia para a equipe pelo sino de notificações."
        icone={BellRing}
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
            <Bell size={15} className="mt-0.5 shrink-0 text-[#0F2A44]/40" />
            <p className="text-[11px] text-[#0F2A44]/55 leading-relaxed">
              Esta configuração vale para o sistema inteiro: define quais avisos são criados para
              toda a equipe. Desligar um tipo interrompe apenas a criação de novos avisos daquele
              tipo — o que já foi recebido continua disponível no sino de notificações.
            </p>
          </div>

          <ul className="divide-y divide-black/5 rounded-xl border border-black/5 overflow-hidden">
            {TIPOS_NOTIFICACAO.map((tipo) => (
              <li key={tipo.chave}>
                <Interruptor
                  titulo={tipo.label}
                  descricao={tipo.descricao}
                  ligado={form[tipo.chave]}
                  desabilitado={!podeEditar || salvando}
                  onAlternar={(ligado) => alternar(tipo.chave, ligado)}
                />
              </li>
            ))}
          </ul>

          {desligados > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-[#C9A227]/35 bg-[#FBF4DE] px-4 py-3 text-[#8A7526]">
              <Info size={15} className="mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">
                {desligados === 1
                  ? "1 tipo de aviso está desligado."
                  : `${desligados} tipos de aviso estão desligados.`}{" "}
                A equipe deixará de ser avisada nessas situações — as tarefas e os registros
                continuam existindo normalmente nas telas do sistema.
              </p>
            </div>
          )}
        </div>
      </Cartao>
    </form>
  );
}
