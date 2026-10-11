def price_with_tax(amount, rate):
    """Add sales tax to an amount."""
    return round(amount * (1 + rate), 2)


class Cart:
    def __init__(self):
        self.items = []

    def add(self, name, amount):
        self.items.append((name, amount))

    def total(self):
        return sum(price_with_tax(a, 0.2) for _, a in self.items)
