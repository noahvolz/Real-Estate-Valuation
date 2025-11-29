// excelModel.js
// Port of your "Immobilieninvestment_Template.xlsx" core logic into JS

// --- 1. Helper: PMT (Excel-like annuity function) -----------------
function pmt(rate, nper, pv) {
  if (Math.abs(rate) < 1e-9) {
    return -(pv / nper);
  }
  return -(pv * rate) / (1 - Math.pow(1 + rate, -nper));
}

// --- 2. Helper: AfA rate per year (mirror AfA sheet) --------------
function afaRate(afaArt, year, lifetimeYears = 50) {
  const y = year;

  switch (afaArt) {
    case "Degressiv 5% + Linear 3%":
      return y <= 6 ? 0.05 : 0.03;
    case "Degressiv 5% + Linear 2%":
      return y <= 6 ? 0.05 : 0.02;
    case "Linear 3 % p.a.":
    case "Linear 3%":
      return y <= 33 ? 0.03 : 0.0;
    case "Linear 2 % p.a.":
    case "Linear 2%":
      return y <= 50 ? 0.02 : 0.0;
    case "Linear x%":
      // Spezialfall: 1 / Restnutzungsdauer
      return y <= lifetimeYears ? 1.0 / lifetimeYears : 0.0;
    default:
      // Fallback: simple pattern recognition
      if (afaArt && afaArt.includes("3")) return 0.03;
      if (afaArt && afaArt.includes("2")) return 0.02;
      return 0.02;
  }
}

// --- 3. Main simulation (Excel-style) ------------------------------
/**
 * params: object with keys mirroring your Parameter sheet
 *
 * Required keys (all numbers except afaArt):
 *  startYear, buildingValue, landValue,
 *  grEStRate, maklerRate, grundbuchRate, notaryRate, companyCost,
 *  fittingUp, initialRepairs,
 *  buildingLossRate, landGrowthRate, constructionCostGrowth,
 *  annualMaintenance, maintenanceGrowth,
 *  monthlyRent, vacancyRate, rentGrowth,
 *  taxRate,
 *  equity, loanTermYears, fixRateYears,
 *  discountRate, interestRate1, interestRate2,
 *  afaArt, (optional) buildingLifetimeYears
 *
 * options:
 *  horizonYears: how many years to simulate (investment horizon)
 */
export function simulateExcelModel(params, options = {}) {
  const {
    startYear,
    buildingValue,
    landValue,
    grEStRate,
    maklerRate,
    grundbuchRate,
    notaryRate,
    companyCost,
    fittingUp,
    initialRepairs,
    buildingLossRate,
    landGrowthRate,
    constructionCostGrowth,
    annualMaintenance,
    maintenanceGrowth,
    monthlyRent,
    vacancyRate,
    rentGrowth,
    taxRate,
    equity,
    loanTermYears,
    fixRateYears,
    discountRate,
    interestRate1,
    interestRate2,
    afaArt,
    buildingLifetimeYears = 50,
  } = params;

  const horizonYears = options.horizonYears ?? loanTermYears;

  // --- 3.1 Basic investment & financing values (Parameter sheet) ---

  const purchasePrice = (buildingValue || 0) + (landValue || 0);

  const sideCostRate =
    (grEStRate || 0) + (maklerRate || 0) + (grundbuchRate || 0) + (notaryRate || 0);

  const sideCostsVar = purchasePrice * sideCostRate;       // GrESt, Makler, etc.
  const sideCostsTotal = sideCostsVar + (companyCost || 0);

  const totalInvest =
    purchasePrice + (fittingUp || 0) + (initialRepairs || 0) + sideCostsTotal;

  const finanzbedarf = totalInvest - (equity || 0);

  const auszahlungsKurs = 1 - (discountRate || 0);
  const auszahlung =
    Math.abs(auszahlungsKurs) > 1e-12 ? finanzbedarf / auszahlungsKurs : finanzbedarf;

  const disagio = auszahlung - finanzbedarf;

  // AfA Basis: Gebäude + FittingUp + anteilige ENK (nur Gebäude-Anteil)
  const buildingShare =
    purchasePrice > 0 ? (buildingValue || 0) / purchasePrice : 0;

  const afaBasis =
    (buildingValue || 0) +
    (fittingUp || 0) +
    sideCostsVar * buildingShare;

  // --- 3.2 Loan schedule (matching Cash & Assets columns D–J) -----

  const loanYears = loanTermYears;
  const firstPhaseYears = Math.min(fixRateYears, loanYears);
  const r1 = interestRate1 || 0;
  const r2 = interestRate2 != null ? interestRate2 : r1;

  const loanSchedule = {}; // year -> { restStart, interest, annuity, principal, cumPrincipal }

  let remaining = auszahlung;
  let cumPrincipal = 0;
  const annuity1 = pmt(r1, loanYears, auszahlung);

  // Phase 1: during first interest fixation
  for (let year = 1; year <= firstPhaseYears; year++) {
    const restStart = remaining;
    const interestPaid = -restStart * r1;
    const principalPaid = annuity1 - interestPaid; // (both negative)
    remaining += principalPaid;
    cumPrincipal += -principalPaid;

    loanSchedule[year] = {
      restStart,
      interest: interestPaid,
      annuity: annuity1,
      principal: principalPaid,
      cumPrincipal,
    };
  }

  // Phase 2: Anschlusskredit
  const restAtFix = remaining;
  const remainingYears = Math.max(loanYears - firstPhaseYears, 0);
  let annuity2 = 0;

  if (remainingYears > 0) {
    annuity2 = pmt(r2, remainingYears, restAtFix);

    for (let n = 1; n <= remainingYears; n++) {
      const year = firstPhaseYears + n;
      const restStart = remaining;
      const interestPaid = -restStart * r2;
      const principalPaid = annuity2 - interestPaid;
      remaining += principalPaid;
      cumPrincipal += -principalPaid;

      loanSchedule[year] = {
        restStart,
        interest: interestPaid,
        annuity: annuity2,
        principal: principalPaid,
        cumPrincipal,
      };
    }
  }

  // Extend schedule beyond loan term with zeros (years after Kreditlaufzeit)
  for (let year = loanYears + 1; year <= horizonYears; year++) {
    loanSchedule[year] = {
      restStart: 0,
      interest: 0,
      annuity: 0,
      principal: 0,
      cumPrincipal,
    };
  }

  // --- 3.3 Property values at year 0 (Cash & Assets row 7) -------

  let buildingVal = (buildingValue || 0) + (fittingUp || 0); // AD7
  let landVal = landValue || 0;                              // AC7
  let propertyVal = buildingVal + landVal;                   // AE7

  // --- 3.4 Year-by-year simulation (Cash & Assets rows 8+) -------

  let cumCF = 0; // X7 = 0

  const years = []; // collect results per year (for charts + KPIs)

  for (let year = 1; year <= horizonYears; year++) {
    const loan = loanSchedule[year];
    const restStart = loan.restStart;
    const interestPaid = loan.interest;
    const principalPaid = loan.principal;
    const cumPrincipalYear = loan.cumPrincipal;

    // Rent evolution (Miete, Leerstand, Steigerung)
    const grossRent =
      (monthlyRent || 0) * 12 * Math.pow(1 + (rentGrowth || 0), year - 1);
    const netRent = grossRent * (1 - (vacancyRate || 0));

    // Maintenance & repairs
    let maintenance;
    if (year === 1) {
      // L8: -Unterhaltskosten_p.a. - Instanhaltungskosten_am_Anfang
      maintenance = -((annualMaintenance || 0) + (initialRepairs || 0));
    } else {
      // Formula pattern: -Unterhaltskosten_p.a. * (1 + Unterhaltskostensteigerung)^year
      maintenance =
        -(annualMaintenance || 0) *
        Math.pow(1 + (maintenanceGrowth || 0), year);
    }

    // AfA (depreciation)
    const afaR = afaRate(afaArt, year, buildingLifetimeYears);
    const afaAmount = -afaBasis * afaR;

    // Taxable result S_t (Vermietung, AfA, Disagio in year 1)
    let taxable;
    if (year === 1) {
      taxable =
        netRent + maintenance + interestPaid + afaAmount - (disagio || 0);
    } else {
      taxable = netRent + maintenance + interestPaid + afaAmount;
    }

    // Tax cashflow (U_t): positive = tax saving, negative = tax payment
    const taxCash = -(taxRate || 0) * taxable;

    // Cashflow before tax (V_t): Miete + Aufwand + Zinsen + Tilgung
    const cashBeforeTax =
      netRent + maintenance + interestPaid + principalPaid;

    // Cashflow after tax (W_t)
    const cashAfterTax = cashBeforeTax + taxCash;

    // Cumulative CF (X_t)
    cumCF += cashAfterTax;

    // Update property values (AE_t)
    landVal = landVal * (1 + (landGrowthRate || 0)); // AC_t
    buildingVal =
      buildingVal *
      (1 - (buildingLossRate || 0) + (constructionCostGrowth || 0)); // AD_t
    propertyVal = buildingVal + landVal; // AE_t

    // Vermögen aus Tilgung + kumul. Cash Flow (Z_t)
    const Zverm = cumCF + cumPrincipalYear;

    // Equity position vs. Gesamtinvestition (AG_t)
    const equityPosition = propertyVal + Zverm - totalInvest;

    years.push({
      yearIndex: year,
      calendarYear: startYear ? startYear + year : null,
      restDebtStart: restStart,
      interestPaid,
      principalPaid,
      grossRent,
      netRent,
      maintenance,
      depreciation: afaAmount,
      taxable,
      taxCash,
      cashBeforeTax,
      cashAfterTax,
      cumulativeCF: cumCF,
      propertyValue: propertyVal,
      cumulativePrincipal: cumPrincipalYear,
      wealthFromCFAndLoan: Zverm, // equivalent to Z_t
      equityPosition,             // AG_t
    });
  }

  // --- 3.5 Aggregate KPIs for selected horizon --------------------

  const last = years[years.length - 1];
  const equityInvested = equity || 0;

  const totalProfitOnInvestment = last.equityPosition; // same as AG_t
  const roiOnInvestment =
    totalInvest > 0 ? totalProfitOnInvestment / totalInvest : 0;

  const roeTotal =
    equityInvested > 0 ? totalProfitOnInvestment / equityInvested : 0;

  const yearsCount = horizonYears > 0 ? horizonYears : 1;
  const roeAnnualized =
    roeTotal > -1
      ? Math.pow(1 + roeTotal, 1 / yearsCount) - 1
      : NaN;

  return {
    meta: {
      startYear,
      horizonYears,
      totalInvest,
      finanzbedarf,
      auszahlung,
      disagio,
      afaBasis,
    },
    loanSchedule,
    years,
    kpis: {
      equityInvested,
      equityPositionEnd: last.equityPosition,
      roiOnInvestment,
      roeTotal,
      roeAnnualized,
      propertyValueEnd: last.propertyValue,
      restDebtStartLastYear: last.restDebtStart,
      cumulativeCF: last.cumulativeCF,
    },
  };
}
