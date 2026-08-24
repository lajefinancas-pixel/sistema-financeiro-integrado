import React from "react";
import { gerarBackupManual, permissaoGerarBackupManual } from "./backups";
import { registrarEvento } from "./auditoria";
import { erroAmigavel, mensagemAmigavel } from "./erros";

/**
 * "Criar backup antes de continuar" — a salvaguarda opcional das operações
 * críticas do sistema (hoje: restaurar e excluir definitivamente, na Lixeira).
 *
 * A ideia é simples: antes de uma ação que mexe no que já está gravado, a pessoa
 * pode pedir uma cópia de segurança do estado atual. Marcar a caixa não muda a
 * operação em si — só antecipa um backup manual, o MESMO que a tela de
 * Configurações → Backup gera, com o mesmo registro em backups_log e a mesma
 * linha na trilha de auditoria.
 *
 * Duas regras que o restante do fluxo depende:
 *
 *   1. A opção é opcional. Quem não marca segue exatamente como antes, e quem
 *      não tem pode_gerar_backup_manual() sequer vê a caixa — mas continua
 *      podendo executar a operação normalmente.
 *   2. Se o backup pedido falhar, a operação NÃO acontece. Foi justamente para
 *      não perder o estado anterior que a caixa foi marcada; seguir em frente
 *      sem a cópia entregaria o contrário do que foi pedido.
 */
export function useBackupAntesDeContinuar(usuarioId) {
  const [disponivel, setDisponivel] = React.useState(false);
  const [marcado, setMarcado] = React.useState(false);
  const [gerando, setGerando] = React.useState(false);
  const [concluido, setConcluido] = React.useState(null);

  React.useEffect(() => {
    let ativo = true;

    if (!usuarioId) {
      setDisponivel(false);
      return undefined;
    }

    permissaoGerarBackupManual(usuarioId)
      .then((permitido) => {
        if (ativo) setDisponivel(permitido === true);
      })
      .catch(() => {
        // Sem resposta sobre a permissão, a opção não aparece: a operação
        // original continua disponível, que é o que importa nesta tela.
        if (ativo) setDisponivel(false);
      });

    return () => {
      ativo = false;
    };
  }, [usuarioId]);

  /** Volta ao estado inicial — chamado ao fechar o modal que hospeda a opção. */
  const reiniciar = React.useCallback(() => {
    setMarcado(false);
    setConcluido(null);
  }, []);

  /**
   * Gera o backup, se a caixa estiver marcada. Lança quando não conseguir — e é
   * essa exceção que impede a operação crítica de continuar.
   *
   * @param descricaoOperacao texto curto para a auditoria ("excluir
   *        definitivamente um registro da Lixeira")
   * @returns o resultado do backup, ou null quando a caixa não estava marcada
   */
  const executarSeMarcado = React.useCallback(
    async (descricaoOperacao) => {
      if (!marcado || !disponivel) return null;

      setGerando(true);
      try {
        const resultado = await gerarBackupManual({ usuarioId });

        // Mesmo evento de "Gerar Backup Agora", com o motivo no registro: quem
        // ler a trilha entende por que aquele backup existe.
        await registrarEvento({
          modulo: "administracao",
          acao: "gerou_backup",
          nivel: "atencao",
          registroAfetado: `Backup do sistema — antes de ${descricaoOperacao}`,
          valorNovo: {
            tipo: "manual",
            origem: "criar_backup_antes_de_continuar",
            operacao: descricaoOperacao,
            tamanho_bytes: resultado.tamanhoBytes,
            observacao: resultado.detalhe,
          },
          usuarioId,
        });

        setConcluido(resultado);
        return resultado;
      } catch (e) {
        throw erroAmigavel(
          `O backup pedido antes de continuar não foi concluído: ${mensagemAmigavel(
            e,
            "não foi possível gerar o backup agora."
          )} A operação foi interrompida e nada foi alterado. Tente novamente ou desmarque a opção para prosseguir sem o backup.`
        );
      } finally {
        setGerando(false);
      }
    },
    [marcado, disponivel, usuarioId]
  );

  return { disponivel, marcado, definir: setMarcado, gerando, concluido, reiniciar, executarSeMarcado };
}
