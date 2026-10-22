"""
LUBE OFFICE - gera os temas da Lube para o editor (ONLYOFFICE Docs).

Saida: office/srv-ia/temas/theme-lube-claro.json e theme-lube-noite.json. O INSTALAR
TEMA LUBE.bat copia para a pasta de temas do motor na SRV-IA
(web-apps/apps/common/main/resources/themes) e o editor passa a oferecer "Lube Claro" e
"Lube Noite" em Ver > Tema da interface; o painel abre no tema de office.config
(customization.uiTheme) e a pagina tema-lube.html deixa as cores prontas antes de o
editor abrir (sem ela o ONLYOFFICE so pinta tema proprio depois de escolhido no menu).

Os dois partem dos temas classicos do ONLYOFFICE (os da versao 10.0 instalada na
SRV-IA) e trocam so as cores: todo cinza vira o tom equivalente do azul-marinho da
Lube, o botao de destaque fica vermelho, o item escolhido (menu Arquivo, botao
apertado) fica azul vivo com texto e icone brancos, e a linha da aba ativa tem a cor
do tipo de arquivo (a mesma dos cartoes do Drive). Medidas e icones continuam os do
tema classico: os icones modernos so funcionam nos temas do proprio ONLYOFFICE.

Lube Noite e escuro, mas declara "type": "light" de proposito (teste de 2026-10-22):
num tema "dark" o ONLYOFFICE poe a classe theme-type-dark, cujas cores tem prioridade
sobre as guardadas, e a barra volta ao cinza a cada abertura. Por isso o Noite leva
TODAS as variaveis do tema classico escuro (cores, posicao dos icones brancos, filtros)
e assim se sustenta. O fundo atras do papel e azul quase preto; o brilho vermelho e
azul por cima e uma camada da pagina do editor do portal (office/editor.css), porque o
editor pinta essa area com cor solida.

Rodar (na pasta do portal):  python office/ferramentas/gerar_temas.py
Precisa de internet (baixa as tabelas de cores do ONLYOFFICE no GitHub).
Cores da marca: nota "Identidade visual da Lube" no cerebro.
"""
import json
import re
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SAIDA = RAIZ / "srv-ia" / "temas"
# mesma versao do motor na SRV-IA (ONLYOFFICE Docs 10.0)
FONTE = "https://raw.githubusercontent.com/ONLYOFFICE/web-apps/v10.0.0.176/apps/common/main/resources/less/"

# cinza (0 a 255) -> cor da Lube; entre dois pontos, a cor e interpolada
CLARO = [(0x00, "#000000"), (0x33, "#121836"), (0x44, "#1A2142"), (0x66, "#3A4263"), (0x88, "#5C6480"),
         (0xA5, "#8890AC"), (0xC0, "#B3BAD2"), (0xCB, "#C3C9E0"), (0xE0, "#DDE1EE"), (0xEF, "#ECEFF7"),
         (0xF7, "#F5F6FB"), (0xFF, "#FFFFFF")]
NOITE = [(0x00, "#000000"), (0x18, "#02040F"), (0x2A, "#030616"), (0x33, "#060B29"), (0x40, "#0C1547"),
         (0x50, "#16206A"), (0x55, "#1A2572"), (0x60, "#22307E"), (0x70, "#2E3B88"), (0x80, "#3B4791"),
         (0x99, "#5B66A0"), (0xB2, "#8790BB"), (0xCC, "#B0B7D6"), (0xE0, "#D6DAEC"), (0xF3, "#F0F2F9"),
         (0xFF, "#FFFFFF")]

AZUL, AZUL_VIVO, VERMELHO = "#0D176E", "#2C3FC4", "#E5101F"
TIPOS = ("document", "spreadsheet", "presentation", "pdf", "visio")
# posicao dos icones brancos nas tiras de icones classicas (as do tema classico escuro)
ICONES_BRANCOS_APERTADO = {
    "button-small-active-icon-offset-x": "-20px", "button-large-active-icon-offset-x": "-31px",
    "button-huge-active-icon-offset-x": "-40px", "button-xhuge-active-icon-offset-x": "-28px",
}


def baixar(nome):
    with urllib.request.urlopen(FONTE + nome, timeout=60) as r:
        return r.read().decode("utf-8")


def rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[:2], 16), int(h[2:4], 16), int(h[4:], 16)


def cinza_para(nivel, pontos):
    for (a, ca), (b, cb) in zip(pontos, pontos[1:]):
        if a <= nivel <= b:
            t = 0 if b == a else (nivel - a) / (b - a)
            x, y = rgb(ca), rgb(cb)
            return "#%02X%02X%02X" % tuple(round(x[i] + (y[i] - x[i]) * t) for i in range(3))
    return pontos[-1][1]


def variaveis(texto):
    return [(k, v.strip()) for k, v in re.findall(r"^\s*--([\w-]+):\s*([^;]+);", texto, re.M)]


def eh_hex(v):
    return re.fullmatch(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", v) is not None


def cinza(v):
    r, g, b = rgb(v)
    return r == g == b


def cores(texto, pontos):
    """so as variaveis que sao cinza puro (#rgb ou #rrggbb com r = g = b), ja na cor da Lube"""
    return {k: cinza_para(rgb(v)[0], pontos) for k, v in variaveis(texto) if eh_hex(v) and cinza(v)}


def todas(texto, pontos):
    """todas as variaveis do tema: cinza vira Lube, fade() vira rgba, o resto fica como esta"""
    nomes = {"black": "#000000", "white": "#FFFFFF"}
    saida = {}
    for k, v in variaveis(texto):
        m = re.fullmatch(r"fade\(\s*([#\w]+)\s*,\s*([\d.]+)%\s*\)", v)
        if m:
            c = nomes.get(m.group(1).lower(), m.group(1))
            if eh_hex(c) and cinza(c) and c.upper() not in ("#FFF", "#FFFFFF", "#000", "#000000"):
                c = cinza_para(rgb(c)[0], pontos)
            r, g, b = rgb(c)
            saida[k] = "rgba(%d, %d, %d, %s)" % (r, g, b, float(m.group(2)) / 100)
        elif eh_hex(v) and cinza(v):
            saida[k] = cinza_para(rgb(v)[0], pontos)
        else:
            if "fade(" in v or "@" in v:
                raise SystemExit("valor que o gerador nao sabe converter: --%s: %s" % (k, v))
            saida[k] = v
    return saida


def por_tipo(prefixo, cores_):
    return {prefixo + t: c for t, c in zip(TIPOS, cores_)}


def tema(ident, nome, tipo, colors):
    return {
        "name": nome,
        "l10n": {"pt": nome, "pt-BR": nome, "en": nome.replace("Noite", "Night").replace("Claro", "Light")},
        "id": ident,
        "type": tipo,
        "colors": colors,
    }


def main():
    claro = cores(baixar("colors-table.less"), CLARO)
    claro.update({
        **por_tipo("toolbar-header-", [AZUL] * 5),
        **por_tipo("text-toolbar-header-on-background-", [AZUL] * 5),
        "background-accent-button": VERMELHO,
        "background-primary-dialog-button": AZUL,
        "highlight-text-select": AZUL_VIVO,
        **{k: AZUL_VIVO for k in ("text-link", "text-link-hover", "text-link-active", "text-link-visited")},
        **por_tipo("highlight-header-tab-underline-", [AZUL_VIVO, "#13945A", "#E0352B", "#C9324A", AZUL]),
        **por_tipo("highlight-toolbar-tab-underline-", [AZUL_VIVO, "#13945A", "#E0352B", "#C9324A", AZUL]),
        # menu Arquivo e paineis: coluna azulada, item escolhido em azul vivo com texto e icone brancos
        "background-pane": "#EEF1FA",
        "highlight-button-hover": "#E2E7F6",
        "highlight-button-pressed": AZUL_VIVO,
        "highlight-button-pressed-hover": "#2435A8",
        "text-normal-pressed": "#FFFFFF",
        "icon-normal-pressed": "#FFFFFF",
        **ICONES_BRANCOS_APERTADO,
    })

    noite = todas(baixar("colors-table-dark.less"), NOITE)
    noite.update({
        # topo igual ao do portal (#030616)
        **por_tipo("toolbar-header-", ["#030616"] * 5),
        **por_tipo("text-toolbar-header-on-background-", ["#030616"] * 5),
        # atras do papel: azul quase preto (o brilho vem da pagina do editor)
        "canvas-background": "#05081C",
        "canvas-ruler-background": "#05081C",
        "background-accent-button": VERMELHO,
        "background-notification-popover": "#1E2B8C",
        "highlight-text-select": "#8FA0FF",
        "border-preview-hover": "#8FA0FF",
        "border-preview-select": "#6680FF",
        **{k: "#B9C4FF" for k in ("text-link", "text-link-hover", "text-link-active", "text-link-visited")},
        **por_tipo("highlight-header-tab-underline-", ["#6F86FF", "#2BC47A", "#FF5A4E", "#F0596B", "#8F9BFF"]),
        **por_tipo("highlight-toolbar-tab-underline-", ["#6F86FF", "#2BC47A", "#FF5A4E", "#F0596B", "#8F9BFF"]),
        # menu Arquivo: item escolhido em azul vivo com texto branco
        "highlight-button-pressed": AZUL_VIVO,
        "highlight-button-pressed-hover": "#3A4EDB",
        "text-normal-pressed": "#FFFFFF",
        "icon-normal-pressed": "#FFFFFF",
    })

    SAIDA.mkdir(parents=True, exist_ok=True)
    for t in (tema("theme-lube-claro", "Lube Claro", "light", claro),
              # "light" de proposito: ver o texto do topo
              tema("theme-lube-noite", "Lube Noite", "light", noite)):
        destino = SAIDA / (t["id"] + ".json")
        destino.write_text(json.dumps(t, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("ok", destino.relative_to(RAIZ.parent), len(t["colors"]), "cores")


if __name__ == "__main__":
    main()
