from decimal import Decimal


def format_currency(value) -> str:
    v = Decimal(str(value))
    formatted = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatted}"


def number_to_words(value) -> str:
    v = Decimal(str(value))
    cents = int(round((v % 1) * 100))
    reais = int(v)

    def _units(n: int) -> str:
        u = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
             "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete",
             "dezoito", "dezenove"]
        return u[n] if n < 20 else ""

    def _tens(n: int) -> str:
        t = ["", "", "vinte", "trinta", "quarenta", "cinquenta",
             "sessenta", "setenta", "oitenta", "noventa"]
        d = n // 10
        u = n % 10
        if n < 20:
            return _units(n)
        if u == 0:
            return t[d]
        return f"{t[d]} e {_units(u)}"

    def _hundreds(n: int) -> str:
        h = n // 100
        rest = n % 100
        hundreds_words = ["", "cem", "duzentos", "trezentos", "quatrocentos",
                          "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]
        if rest == 0:
            return hundreds_words[h]
        if h == 1:
            return f"cento e {_tens(rest)}"
        return f"{hundreds_words[h]} e {_tens(rest)}"

    def _to_words(n: int) -> str:
        if n == 0:
            return "zero"
        if n < 100:
            return _tens(n)
        if n < 1000:
            return _hundreds(n)
        if n < 1_000_000:
            thousands = n // 1000
            rest = n % 1000
            t_word = "mil" if thousands == 1 else f"{_to_words(thousands)} mil"
            if rest == 0:
                return t_word
            return f"{t_word} e {_to_words(rest)}" if rest < 100 else f"{t_word}, {_to_words(rest)}"
        if n < 1_000_000_000:
            millions = n // 1_000_000
            rest = n % 1_000_000
            m_word = "um milhão" if millions == 1 else f"{_to_words(millions)} milhões"
            if rest == 0:
                return m_word
            return f"{m_word} e {_to_words(rest)}"
        return str(n)

    if reais == 0 and cents == 0:
        return "zero reais"

    parts = []
    if reais > 0:
        r_word = _to_words(reais)
        parts.append(f"{r_word} {'real' if reais == 1 else 'reais'}")
    if cents > 0:
        c_word = _to_words(cents)
        parts.append(f"{c_word} {'centavo' if cents == 1 else 'centavos'}")

    return " e ".join(parts)


def calculate_area(width: Decimal, height: Decimal) -> Decimal:
    return (width * height).quantize(Decimal("0.0001"))


def format_cpf_cnpj(value: str) -> str:
    digits = "".join(c for c in value if c.isdigit())
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    if len(digits) == 14:
        return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:]}"
    return value
