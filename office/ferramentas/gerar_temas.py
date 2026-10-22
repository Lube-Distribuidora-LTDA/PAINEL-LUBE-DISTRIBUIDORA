"""
LUBE OFFICE - gera os temas da Lube para o editor (ONLYOFFICE Docs).

Saida: office/srv-ia/temas/theme-lube-claro.json. O INSTALAR TEMA LUBE.bat copia
para a pasta de temas do motor na SRV-IA (web-apps/apps/common/main/resources/themes)
e o editor passa a oferecer "Lube Claro" em Ver > Tema da interface; o painel abre
nele (customization.uiTheme) e a pagina tema-lube.html deixa as cores prontas antes
de o editor abrir (sem ela o ONLYOFFICE so pinta tema proprio depois de escolhido no menu).

So tema claro (teste de 2026-10-22): num tema escuro proprio o ONLYOFFICE poe a classe
theme-type-dark, cujas cores tem prioridade sobre as guardadas, e a barra volta ao cinza
a cada abertura. Quem quiser escuro escolhe um dos temas escuros do proprio ONLYOFFICE.

O tema parte do tema classico claro do ONLYOFFICE (o da versao 10.0 instalada na
SRV-IA) e troca so as cores: todo cinza vira o tom equivalente
do azul-marinho da Lube, o botao de destaque fica vermelho e a linha da aba ativa
tem a cor do tipo de arquivo (a mesma dos cartoes do Drive). Medidas e icones
continuam os do tema classico: os icones modernos so funcionam nos temas do
proprio ONLYOFFICE (achado no teste de 2026-10-22).

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

AZUL, VERMELHO = "#0D176E", "#E5101F"
TIPOS = ("document", "spreadsheet", "presentation", "pdf", "visio")


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


def cores(texto, pontos):
    """so as variaveis que sao cinza puro (#rgb ou #rrggbb com r = g = b), ja na cor da Lube"""
    saida = {}
    for k, v in re.findall(r"^\s*--([\w-]+):\s*([^;]+);", texto, re.M):
        v = v.strip()
        if re.fullmatch(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", v):
            r, g, b = rgb(v)
            if r == g == b:
                saida[k] = cinza_para(r, pontos)
    return saida


def por_tipo(prefixo, cores_):
    return {prefixo + t: c for t, c in zip(TIPOS, cores_)}


def tema(ident, nome, tipo, colors):
    return {
        "name": nome,
        "l10n": {"pt": nome, "pt-BR": nome, "en": nome.replace("Escuro", "Dark").replace("Claro", "Light")},
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
        "highlight-text-select": "#2C3FC4",
        **{k: "#2C3FC4" for k in ("text-link", "text-link-hover", "text-link-active", "text-link-visited")},
        **por_tipo("highlight-header-tab-underline-", ["#2C3FC4", "#13945A", "#E0352B", "#C9324A", AZUL]),
        **por_tipo("highlight-toolbar-tab-underline-", ["#2C3FC4", "#13945A", "#E0352B", "#C9324A", AZUL]),
    })

    SAIDA.mkdir(parents=True, exist_ok=True)
    for t in (tema("theme-lube-claro", "Lube Claro", "light", claro),):
        destino = SAIDA / (t["id"] + ".json")
        destino.write_text(json.dumps(t, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("ok", destino.relative_to(RAIZ.parent), len(t["colors"]), "cores")


if __name__ == "__main__":
    main()
