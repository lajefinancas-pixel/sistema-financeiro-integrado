import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Lock, Tags, ToggleLeft, Truck } from "lucide-react";
import { Alerta } from "../equipe/comuns";
import { Cartao } from "./comuns";
import { listarClassificacoesFornecedores } from "../../lib/configuracoesSistema";
import { mensagemAmigavel } from "../../lib/erros";

/** De onde cada lista foi lida, explicado para quem está olhando a tela. */
const ORIGENS = {
  cadastro: "Valores lidos da coluna do cadastro de fornecedores.",
  documento:
    "O cadastro não tem um campo próprio de tipo, então a classificação vem do CPF/CNPJ já registrado (11 dígitos = Pessoa Física, 14 = Pessoa Jurídica).",
  ativo:
    "O cadastro não tem um campo próprio de situação, então ela vem da marcação de fornecedor ativo/inativo.",
};

/** Lista somente leitura de uma classificação, com quantos fornecedores usam cada valor. */
function ListaClassificacao({ itens, total, vazio }) {
  if (itens.length === 0) {
    return (
      <p className="text-xs text-[#0F2A44]/40 rounded-xl border border-dashed border-black/10 px-4 py-6 text-center">
        {vazio}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-black/5 rounded-xl border border-black/5 overflow-hidden">
      {itens.map((item) => {
        const percentual = total > 0 ? Math.round((item.total / total) * 100) : 0;
        return (
          <li key={item.valor} className="flex items-center gap-3 px-4 py-3 bg-white">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-[#0F2A44] truncate">{item.valor}</div>
              <div className="text-[11px] text-[#0F2A44]/50">
                {item.total} {item.total === 1 ? "fornecedor" : "fornecedores"}
                {total > 0 && ` · ${percentual}% do cadastro`}
              </div>
            </div>
            <Lock size={14} className="text-[#0F2A44]/20 shrink-0" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Categoria FORNECEDORES: as classificações que os cadastros já usam hoje.
 *
 * Tudo é somente leitura por decisão de projeto: tipo e situação não são listas
 * mantidas aqui, e sim o retrato do que está gravado em cada fornecedor. Editar
 * ou remover um valor em uso significaria alterar os cadastros que dependem
 * dele — isso continua sendo feito na tela de Fornecedores, um cadastro por vez.
 */
export default function CategoriaFornecedores() {
  const [dados, setDados] = React.useState(null);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);

  React.useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const lista = await listarClassificacoesFornecedores();
        if (ativo) setDados(lista);
      } catch (e) {
        if (ativo) {
          setErro(mensagemAmigavel(e, "Não foi possível carregar as classificações dos fornecedores."));
        }
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  if (carregando) {
    return (
      <Cartao titulo="Classificações em uso" icone={Truck}>
        <p className="text-sm text-[#0F2A44]/45">Carregando classificações...</p>
      </Cartao>
    );
  }

  if (erro) {
    return (
      <Cartao titulo="Classificações em uso" icone={Truck}>
        <Alerta tipo="erro">{erro}</Alerta>
      </Cartao>
    );
  }

  const total = dados?.total ?? 0;

  return (
    <div className="space-y-5">
      <Cartao
        titulo="Categorias e tipos de fornecedor"
        descricao="Tipos que aparecem nos fornecedores já cadastrados, com quantos usam cada um."
        icone={Tags}
        rodape={
          <p className="text-[11px] text-[#0F2A44]/45 leading-relaxed">
            {ORIGENS[dados?.tipos?.origem] ?? ORIGENS.cadastro} A lista é somente leitura: um tipo em
            uso não pode ser renomeado ou removido daqui, porque isso alteraria os cadastros que
            dependem dele.
          </p>
        }
      >
        <ListaClassificacao
          itens={dados?.tipos?.itens ?? []}
          total={total}
          vazio="Nenhum tipo de fornecedor identificado nos cadastros atuais."
        />
      </Cartao>

      <Cartao
        titulo="Status de fornecedor"
        descricao="Situações em uso no cadastro de fornecedores hoje."
        icone={ToggleLeft}
        rodape={
          <p className="text-[11px] text-[#0F2A44]/45 leading-relaxed">
            {ORIGENS[dados?.status?.origem] ?? ORIGENS.cadastro} Também somente leitura — a situação
            de cada fornecedor continua sendo definida no próprio cadastro.
          </p>
        }
      >
        <ListaClassificacao
          itens={dados?.status?.itens ?? []}
          total={total}
          vazio="Nenhuma situação identificada nos cadastros atuais."
        />
      </Cartao>

      <Cartao
        titulo="Onde alterar"
        descricao={`${total} ${
          total === 1 ? "fornecedor cadastrado" : "fornecedores cadastrados"
        } no sistema. Tipo e situação são definidos em cada cadastro.`}
        icone={Truck}
      >
        <Link
          to="/fornecedores"
          className="flex items-center gap-3 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3.5 hover:bg-[#F5F3EF]"
        >
          <div className="w-9 h-9 rounded-xl bg-white border border-[#C9A227]/30 flex items-center justify-center shrink-0">
            <Truck size={16} className="text-[#0F2A44]" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-[#0F2A44]">Cadastro de Fornecedores</div>
            <div className="text-[11px] text-[#0F2A44]/55 mt-0.5 leading-relaxed">
              Abrir a tela de Fornecedores para cadastrar, editar ou reclassificar um fornecedor.
            </div>
          </div>
          <ChevronRight size={16} className="text-[#0F2A44]/25 ml-auto shrink-0" />
        </Link>
      </Cartao>
    </div>
  );
}
