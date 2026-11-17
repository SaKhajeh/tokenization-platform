#!/usr/bin/env python3
"""
Golden cases for the credit-scoring engine (packages/domain/src/creditScoring.ts).

Fills copies of the fund's scoring workbook with random companies, recalculates them with LibreOffice,
and writes inputs + every output cell to packages/domain/test/fixtures/workbook-golden.json.

The workbook itself is the fund's file and is NOT kept in the repository; pass its path:

    python3 -I tools/workbook-golden/generate.py /path/to/scoring.xlsx [cases=40] [seed=1405]

Changes applied to the copy before recalculating (decided in plan/07 §8):
  - D-C5 / W2: «کسر اعتبار نُرم شده» (Z20:AI20) divides by (Ra × Re) instead of (Ra + Re).
Values are kept away from band boundaries, so the W4 typo (< vs ≤ at −0.25) never matters here.
"""
import json, os, random, shutil, subprocess, sys, tempfile

import openpyxl

SRC = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 40
SEED = int(sys.argv[3]) if len(sys.argv) > 3 else 1405
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "domain", "test", "fixtures", "workbook-golden.json")

SHEET1 = "گزارش ارزیابی"
SHEET2 = "تحلیل مالی"
YEAR_COLS = {"assets": ["E", "F", "G"], "liab": ["K", "L", "M"], "pl": ["S", "T", "U"]}  # Y0, Y-1, Y-2
ASSET_ROWS = {5: "cash", 6: "shortInvestments", 7: "receivables", 8: "otherReceivables", 9: "inventory", 10: "prepayments",
              11: "otherCurrentAssets", 13: "tangibleFixed", 14: "intangible", 15: "longInvestments", 16: "otherNonCurrent", 17: "partnersCurrentAsset"}
LIAB_ROWS = {5: "payables", 6: "otherPayables", 7: "shortLoans", 8: "advancesReceived", 9: "otherCurrentLiabilities", 11: "longLoans",
             12: "longLiabilities", 14: "partnersCurrentEquity", 15: "reserves", 16: "capital", 17: "retainedEarnings"}
PL_ROWS = {5: "sales", 6: "cogs", 8: "sga", 9: "otherOperatingNet", 11: "financialCosts", 12: "nonOperatingExpenses", 13: "nonOperatingIncome"}
ACTIVITY = {"تولیدی - پیمانکاری": "production_contracting", "تولیدی - خط تولید": "production_line", "تولیدی - بازرگانی": "production_trading",
            "خدماتی - پیمانکاری": "services_contracting", "بازرگانی - پیمانکاری": "trading_contracting"}
G_COLS = ["Z", "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI"]

# output cells to compare (sheet, cell, name)
OUTPUTS = []
for i, col in enumerate(["G", "F", "E"]):  # ratio columns: G = Y0, F = Y-1, E = Y-2
    for row, name in [(22, "profitability"), (23, "returnOnAssets"), (24, "interestCoverage"), (25, "currentRatio"), (26, "quickRatio"),
                      (27, "debtToAssets"), (28, "equityRatio"), (29, "collectionMonths"), (30, "inventoryMonths"), (31, "assetTurnover")]:
        OUTPUTS.append((SHEET1, f"{col}{row}", f"ratios.{i}.{name}"))
for i, (ac, lc, pc) in enumerate(zip(*YEAR_COLS.values())):
    for row, name in [(12, "currentAssets"), (18, "fixedAssets"), (19, "totalAssets"), (20, "balanceDifference")]:
        OUTPUTS.append((SHEET1, f"{ac}{row}", f"statements.{i}.{name}"))
    for row, name in [(10, "currentLiabilities"), (13, "totalLiabilities"), (18, "equity"), (19, "totalLiabilitiesAndEquity")]:
        OUTPUTS.append((SHEET1, f"{lc}{row}", f"statements.{i}.{name}"))
    for row, name in [(7, "grossProfit"), (10, "operatingProfit"), (14, "profitBeforeTax"), (15, "tax"), (16, "netProfit")]:
        OUTPUTS.append((SHEET1, f"{pc}{row}", f"statements.{i}.{name}"))
OUTPUTS += [(SHEET1, c, n) for c, n in [
    ("G32", "avgMargin"), ("G33", "avgGrowth"), ("Z4", "guaranteeBase"), ("Z5", "facilityBase"), ("AA24", "c1"), ("AA25", "c2"),
    ("L23", "coefficients.betaGuarantee"), ("M23", "coefficients.betaFacility"), ("L27", "coefficients.cp"), ("L28", "coefficients.cr"),
    ("AA29", "coefficients.crlRaw"), ("M28", "coefficients.crl"),
    ("Z10", "guarantee.norm.cheque"), ("AA10", "guarantee.norm.mortgage_2"), ("AB10", "guarantee.norm.mortgage_1"),
    ("Z11", "facility.norm.cheque"), ("AA11", "facility.norm.mortgage_2"), ("AB11", "facility.norm.mortgage_1"),
    ("F35", "guarantee.ceiling.cheque"), ("F36", "guarantee.ceiling.mortgage_2"), ("F37", "guarantee.ceiling.mortgage_1"),
    ("F38", "facility.ceiling.cheque"), ("F39", "facility.ceiling.mortgage_2"), ("F40", "facility.ceiling.mortgage_1"),
    ("AD11", "normCeiling"), ("AE11", "ledger.used"), ("AF11", "ledger.remaining"),
]]
for j, col in enumerate(G_COLS):
    for row, name in [(16, "ceiling"), (20, "deduction"), (21, "remainingAfter")]:
        OUTPUTS.append((SHEET1, f"{col}{row}", f"ledger.rows.{j}.{name}"))
# sheet 2: analysis (F = Y0, G = Y-1, H = Y-2)
A_ROWS = {3: "currentRatio", 4: "quickRatio", 5: "currentAssetsToTotal", 6: "debtToAssets", 7: "debtToEquity", 8: "currentLiabilitiesToEquity",
          9: "fixedAssetsToEquity", 10: "equityRatio", 11: "interestCoverage", 12: "cogsToSales", 13: "grossMargin", 14: "netMargin",
          15: "returnOnAssets", 16: "returnOnEquity", 17: "leverageBenefit", 18: "assetTurnover", 19: "collectionMonths",
          20: "inventoryMonths", 21: "operatingCycleMonths", 22: "inventoryToWorkingCapital"}
for i, col in enumerate(["F", "G", "H"]):
    for row, name in A_ROWS.items():
        OUTPUTS.append((SHEET2, f"{col}{row}", f"analysis.years.{i}.{name}"))
for i, col in enumerate(["F", "G"]):
    for row, name in [(24, "sales"), (25, "operatingProfit"), (26, "equity"), (27, "workingCapital")]:
        OUTPUTS.append((SHEET2, f"{col}{row}", f"analysis.trends.{i}.{name}"))
for row, name in [(3, "currentAssets"), (4, "fixedAssets"), (5, "currentLiabilities"), (6, "nonCurrentLiabilities"), (7, "equity"), (8, "totalAssets")]:
    for col, part in [("K", "y0"), ("L", "y1"), ("M", "change"), ("N", "pct")]:
        OUTPUTS.append((SHEET2, f"{col}{row}", f"analysis.horizontal.{name}.{part}"))
for row, name in [(11, "currentAssets"), (12, "fixedAssets"), (13, "currentLiabilities"), (14, "nonCurrentLiabilities"), (15, "totalLiabilities"), (16, "equity"), (17, "totalAssets")]:
    for i, col in enumerate(["K", "L"]):  # M column is the literal 1
        OUTPUTS.append((SHEET2, f"{col}{row}", f"analysis.index.{name}.{i}"))
for row, name in [(21, "currentAssets"), (22, "fixedAssets"), (23, "currentLiabilities"), (24, "nonCurrentLiabilities"), (25, "totalLiabilities"), (26, "equity")]:
    for i, col in enumerate(["K", "L", "M"]):
        OUTPUTS.append((SHEET2, f"{col}{row}", f"analysis.commonSize.{name}.{i}"))


def r(a, b):
    return round(random.uniform(a, b), 0)


def coef():
    return round(random.uniform(0.3, 1.0), 2)


def make_case(k):
    sales0 = r(20_000, 600_000)
    growth = [random.uniform(-0.6, 1.6), random.uniform(-0.6, 1.6)]  # Y0 vs Y-1, Y-1 vs Y-2
    sales = [sales0, round(sales0 / (1 + growth[0])), 0]
    sales[2] = round(sales[1] / (1 + growth[1]))
    years = []
    for i in range(3):
        s = max(sales[i], 1000)
        y = {name: r(0, s * 0.4) for name in list(ASSET_ROWS.values()) + list(LIAB_ROWS.values())}
        y["payables"] = r(s * 0.02, s * 0.4)  # current liabilities never zero
        y["capital"] = r(s * 0.05, s * 0.6)
        if random.random() < 0.25:
            y["retainedEarnings"] = -r(0, s * 0.3)
        margin = random.uniform(-0.3, 0.45)
        y["sales"] = s
        y["cogs"] = r(s * 0.3, s * 0.8)
        y["financialCosts"] = 0 if random.random() < 0.15 else r(0, s * 0.05)
        y["nonOperatingExpenses"] = r(0, s * 0.02)
        y["nonOperatingIncome"] = r(0, s * 0.02)
        y["otherOperatingNet"] = r(-s * 0.02, s * 0.02)
        # sga sets the profit margin
        y["sga"] = round(s - y["cogs"] - y["otherOperatingNet"] - y["financialCosts"] - y["nonOperatingExpenses"] + y["nonOperatingIncome"] - margin * s)
        years.append(y)
    activity = random.choice(list(ACTIVITY))
    g = {"rc": coef(), "ra": coef(), "re": coef()}
    f = {"rc": coef(), "ra": coef(), "re": coef()} if random.random() < 0.5 else dict(g)
    usages = []
    for j in range(random.randint(0, 10)):
        ra, re_ = (g["ra"], g["re"]) if j == 0 else (coef(), coef())  # guarantee 1 uses the project's Ra/Re (Z14 = L25)
        usages.append({"id": f"g{j + 1}", "amount": r(100, sales0 * random.choice([0.002, 0.01, 0.05])), "ra": ra, "re": re_, "active": random.random() < 0.75})
    return {"id": f"case-{k + 1:02d}", "activity": activity, "years": years, "guarantee": g, "facility": f, "usages": usages}


def fill(wb, c):
    ws = wb[SHEET1]
    ws["O2"] = c["activity"]
    for i in range(3):
        y = c["years"][i]
        for row, name in ASSET_ROWS.items():
            ws[f"{YEAR_COLS['assets'][i]}{row}"] = y[name]
        for row, name in LIAB_ROWS.items():
            ws[f"{YEAR_COLS['liab'][i]}{row}"] = y[name]
        for row, name in PL_ROWS.items():
            ws[f"{YEAR_COLS['pl'][i]}{row}"] = y[name]
    for cell, v in [("L24", c["guarantee"]["rc"]), ("L25", c["guarantee"]["ra"]), ("L26", c["guarantee"]["re"]),
                    ("M24", c["facility"]["rc"]), ("M25", c["facility"]["ra"]), ("M26", c["facility"]["re"])]:
        ws[cell] = v
    for j, col in enumerate(G_COLS):
        u = c["usages"][j] if j < len(c["usages"]) else None
        if j > 0:
            ws[f"{col}14"] = u["ra"] if u else None
            ws[f"{col}15"] = u["re"] if u else None
        ws[f"{col}17"] = u["amount"] if u else None
        ws[f"{col}19"] = (1 if u["active"] else 0) if u else 0
        # D-C5: divide by (Ra × Re)
        ws[f"{col}20"] = f"=IF({col}19=1,{col}17/({col}14*{col}15),0)"


def num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    return None  # #DIV/0!, #VALUE!, empty


def main():
    random.seed(SEED)
    cases = [make_case(k) for k in range(N)]
    tmp = tempfile.mkdtemp()
    paths = []
    for c in cases:
        wb = openpyxl.load_workbook(SRC)
        fill(wb, c)
        p = os.path.join(tmp, f"{c['id']}.xlsx")
        wb.save(p)
        paths.append(p)
    out = os.path.join(tmp, "calc")
    os.makedirs(out)
    subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", out, *paths], check=True, capture_output=True)
    fixtures = []
    for c, p in zip(cases, paths):
        wb = openpyxl.load_workbook(os.path.join(out, os.path.basename(p)), data_only=True)
        expected = {}
        for sheet, cell, name in OUTPUTS:
            if name.startswith("ledger.rows."):
                j = int(name.split(".")[2])
                if j >= len(c["usages"]):
                    continue
            expected[name] = num(wb[sheet][cell].value)
        fixtures.append({
            "id": c["id"],
            "input": {"activityType": ACTIVITY[c["activity"]], "years": c["years"], "guarantee": c["guarantee"], "facility": c["facility"]},
            "usages": c["usages"],
            "expected": expected,
        })
    shutil.rmtree(tmp)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "fund scoring workbook, recalculated by LibreOffice; D-C5 applied", "seed": SEED, "cases": fixtures}, f, ensure_ascii=False, indent=1)
    cells = sum(len(x["expected"]) for x in fixtures)
    print(f"{len(fixtures)} cases, {cells} output cells → {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
