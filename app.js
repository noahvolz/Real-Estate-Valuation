// app.js
// app.js
import { simulateExcelModel } from "./excelModel.js";
let cashflowChart = null;
let roeChart = null;
let costChart = null;
let socioData = [];

/* -------- Helpers -------- */

function parseNumber(id, defaultValue = 0) {
  const el = document.getElementById(id);
  const value = Number(el.value.replace(",", "."));
  return Number.isFinite(value) ? value : defaultValue;
}

function formatCurrency(amount) {
  return amount.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function formatPercent(value, decimals = 1) {
  return `${value.toFixed(decimals)} %`;
}

/* -------- Core Simulation Logic -------- */
/**
 * This function encapsulates the financial model so you can later
 * adapt it to match your Excel one-to-one.
 *
 * Assumptions:
 * - Annuitäten-Darlehen (constant annual debt service)
 * - Rental income taxed at user's marginal tax rate
 * - AfA as linear % of purchase price (simplified: no separate land share)
 * - Sale at end of investment horizon, ignoring capital gains tax
 */
function runSimulation(inputs) {
  const purchasePrice = inputs.purchasePrice;
  const purchaseCostRate = inputs.purchaseCostRate / 100;
  const appreciationRate = inputs.appreciationRate / 100;
  const sellingCostRate = inputs.sellingCostRate / 100;

  const equity = inputs.equity;
  const interestRate = inputs.interestRate / 100;
  const loanTermYears = inputs.loanTermYears;
  const investmentYears = inputs.investmentYears;

  const monthlyRent = inputs.monthlyRent;
  const vacancyRate = inputs.vacancyRate / 100;
  const maintenanceRate = inputs.maintenanceRate / 100;
  const otherCostsAnnual = inputs.otherCostsAnnual;
  const taxRate = inputs.taxRate / 100;
  const depreciationRate = inputs.depreciationRate / 100;

  const purchasingCosts = purchasePrice * purchaseCostRate;
  const totalInitialCost = purchasePrice + purchasingCosts;

  const loanAmount = Math.max(totalInitialCost - equity, 0);

  // Annual annuity formula (constant annual payment)
  let annualDebtService = 0;
  if (interestRate > 0 && loanTermYears > 0) {
    const r = interestRate;
    const n = loanTermYears;
    const annuityFactor = r / (1 - Math.pow(1 + r, -n));
    annualDebtService = loanAmount * annuityFactor;
  } else if (loanTermYears > 0) {
    // interest-free (edge case, mostly for testing)
    annualDebtService = loanAmount / loanTermYears;
  }

  const annualGrossRent = monthlyRent * 12 * (1 - vacancyRate);
  const annualMaintenance = annualGrossRent * maintenanceRate;
  const annualDepreciation = purchasePrice * depreciationRate; // simplification

  let remainingDebt = loanAmount;
  const years = Math.min(investmentYears, loanTermYears || investmentYears);

  const yearLabels = [];
  const annualCashflows = [];
  const cumulativeCashflows = [];
  const roeOverTime = [];
  let cumulativeCF = 0;

  let year1CostBreakdown = null;

  for (let year = 1; year <= years; year++) {
    const interestPayment = remainingDebt * interestRate;
    const principalRepayment = Math.max(annualDebtService - interestPayment, 0);

    remainingDebt = Math.max(remainingDebt - principalRepayment, 0);

    const taxableIncome =
      annualGrossRent -
      annualMaintenance -
      otherCostsAnnual -
      interestPayment -
      annualDepreciation;

    const taxes = Math.max(taxableIncome * taxRate, 0);
    const cashflowAfterTax =
      annualGrossRent -
      annualMaintenance -
      otherCostsAnnual -
      interestPayment -
      taxes;

    cumulativeCF += cashflowAfterTax;

    yearLabels.push(`Year ${year}`);
    annualCashflows.push(cashflowAfterTax);
    cumulativeCashflows.push(cumulativeCF);

    // Equity position at end of year = propertyValue - remainingDebt
    const propertyValueThisYear =
      purchasePrice * Math.pow(1 + appreciationRate, year);
    const equityAtYear =
      propertyValueThisYear - remainingDebt - equity + cumulativeCF;

    const roeToDate = equity > 0 ? (equityAtYear / equity) * 100 : 0;
    roeOverTime.push(roeToDate);

    if (year === 1) {
      year1CostBreakdown = {
        rent: annualGrossRent,
        maintenance: annualMaintenance,
        other: otherCostsAnnual,
        interest: interestPayment,
        taxes,
      };
    }
  }

  // At end of investment horizon: sale
  const propertyValueEnd =
    purchasePrice * Math.pow(1 + appreciationRate, investmentYears);
  const sellingCosts = propertyValueEnd * sellingCostRate;
  const netSaleProceeds = propertyValueEnd - sellingCosts - remainingDebt;

  const totalProfit = cumulativeCF + netSaleProceeds - equity;
  const totalROE = equity > 0 ? (totalProfit / equity) * 100 : 0;
  const equityMultiple = equity > 0 ? (equity + totalProfit) / equity : 0;

  const annualizedROE =
    equity > 0 && investmentYears > 0
      ? (Math.pow((equity + totalProfit) / equity, 1 / investmentYears) - 1) *
        100
      : 0;

  return {
    yearLabels,
    annualCashflows,
    cumulativeCashflows,
    roeOverTime,
    year1CostBreakdown,
    cumulativeCF,
    netSaleProceeds,
    totalProfit,
    totalROE,
    annualizedROE,
    equityMultiple,
    remainingDebtEnd: remainingDebt,
    purchasingCosts,
    loanAmount,
    totalInitialCost,
  };
}

/* -------- UI Rendering -------- */

function renderResultsSummary(result, inputs) {
  const container = document.getElementById("resultsSummary");
  if (!result) {
    container.innerHTML = "<em>No results yet. Run the simulation.</em>";
    return;
  }

  const firstYearCF = result.annualCashflows[0] || 0;

  container.innerHTML = `
    <div class="metric-card">
      <h3>Total ROE (end of year ${inputs.investmentYears})</h3>
      <div class="metric-value">${formatPercent(result.totalROE, 1)}</div>
      <div class="metric-extra">Equity multiple: ${result.equityMultiple.toFixed(
        2
      )}x</div>
    </div>

    <div class="metric-card">
      <h3>Annualized ROE</h3>
      <div class="metric-value">${formatPercent(result.annualizedROE, 2)}</div>
      <div class="metric-extra">Total profit: ${formatCurrency(
        result.totalProfit
      )}</div>
    </div>

    <div class="metric-card">
      <h3>Year 1 Cashflow (after tax)</h3>
      <div class="metric-value">${formatCurrency(firstYearCF)}</div>
      <div class="metric-extra">On equity: ${
        inputs.equity > 0
          ? formatPercent((firstYearCF / inputs.equity) * 100, 1)
          : "–"
      }</div>
    </div>

    <div class="metric-card">
      <h3>Financing Overview</h3>
      <div class="metric-extra">
        Total initial cost: ${formatCurrency(result.totalInitialCost)}<br />
        Equity: ${formatCurrency(inputs.equity)}<br />
        Loan amount: ${formatCurrency(result.loanAmount)}<br />
        Remaining debt at end: ${formatCurrency(result.remainingDebtEnd)}
      </div>
    </div>
  `;
}

function initCharts() {
  const cashflowCtx = document.getElementById("cashflowChart").getContext("2d");
  const roeCtx = document.getElementById("roeChart").getContext("2d");
  const costCtx = document.getElementById("costChart").getContext("2d");

  cashflowChart = new Chart(cashflowCtx, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Cashflow after tax (€)",
          data: [],
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          ticks: {
            callback: (value) =>
              value.toLocaleString("de-DE", { maximumFractionDigits: 0 }),
          },
        },
      },
    },
  });

  roeChart = new Chart(roeCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "ROE to date (%)",
          data: [],
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          ticks: {
            callback: (value) => `${value}%`,
          },
        },
      },
    },
  });

  costChart = new Chart(costCtx, {
    type: "doughnut",
    data: {
      labels: ["Maintenance", "Other costs", "Interest", "Taxes", "Net CF"],
      datasets: [
        {
          label: "Cost breakdown (Year 1)",
          data: [0, 0, 0, 0, 0],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
        },
      },
    },
  });
}

function updateCharts(result) {
  if (!result) return;

  // Cashflow chart
  cashflowChart.data.labels = result.yearLabels;
  cashflowChart.data.datasets[0].data = result.annualCashflows;
  cashflowChart.update();

  // ROE chart
  roeChart.data.labels = result.yearLabels;
  roeChart.data.datasets[0].data = result.roeOverTime;
  roeChart.update();

  // Cost breakdown chart (Year 1)
  const c = result.year1CostBreakdown;
  if (c) {
    const netCF =
      c.rent - c.maintenance - c.other - c.interest - c.taxes;

    costChart.data.datasets[0].data = [
      c.maintenance,
      c.other,
      c.interest,
      c.taxes,
      netCF,
    ];
    costChart.update();
  }
}

/* -------- Socio-Economic Data Handling -------- */

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(",");
    const row = {};
    headers.forEach((h, idx) => {
      const raw = (cols[idx] || "").trim();
      const num = Number(raw);
      row[h] = Number.isNaN(num) ? raw : num;
    });
    rows.push(row);
  }
  return rows;
}

function renderSocioTable(data) {
  const table = document.getElementById("socioTable");
  if (!data || data.length === 0) {
    table.innerHTML = "";
    return;
  }

  const headers = Object.keys(data[0]);
  const thead = `
    <thead>
      <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
    </thead>
  `;
  const tbody = `
    <tbody>
      ${data
        .map(
          (row) => `
        <tr>
          ${headers
            .map((h) => `<td>${row[h] ?? ""}</td>`)
            .join("")}
        </tr>`
        )
        .join("")}
    </tbody>
  `;

  table.innerHTML = thead + tbody;
}

function renderSocioSummary(data) {
  const summary = document.getElementById("socioSummary");
  if (!data || data.length === 0) {
    summary.innerHTML = "<em>No socio-economic data loaded yet.</em>";
    return;
  }

  const lastRow = data[data.length - 1];
  const city = lastRow.city || lastRow.City || "N/A";
  const year = lastRow.year || lastRow.Year || "N/A";
  const popGrowth =
    lastRow.population_growth_pct ??
    lastRow.pop_growth ??
    lastRow.PopulationGrowthPct;
  const medianIncome =
    lastRow.median_income ??
    lastRow.MedianIncome ??
    null;

  const unemployment =
    lastRow.unemployment_rate ??
    lastRow.UnemploymentRate ??
    null;

  let trendText = "";
  if (typeof popGrowth === "number") {
    if (popGrowth > 0.5) trendText = "Growing population";
    else if (popGrowth < -0.5) trendText = "Shrinking population";
    else trendText = "Stable population";
  }

  summary.innerHTML = `
    <strong>Latest socio-economic snapshot:</strong>
    <div>Location: <b>${city}</b> (${year})</div>
    ${
      medianIncome != null
        ? `<div>Median income: ${medianIncome.toLocaleString(
            "de-DE"
          )} €</div>`
        : ""
    }
    ${
      typeof popGrowth === "number"
        ? `<div>Population growth: ${popGrowth.toFixed(2)} % p.a. (${trendText})</div>`
        : ""
    }
    ${
      typeof unemployment === "number"
        ? `<div>Unemployment: ${unemployment.toFixed(1)} %</div>`
        : ""
    }
    <div style="margin-top:4px;color:#6b7280;font-size:0.8rem;">
      Use this context together with the financial results to judge long-term risk
      and demand.
    </div>
  `;
}

function handleSocioFileChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;
      let data;
      if (file.name.toLowerCase().endsWith(".json")) {
        data = JSON.parse(text);
        if (!Array.isArray(data)) {
          data = [data];
        }
      } else {
        data = parseCSV(text);
      }
      socioData = data;
      renderSocioTable(data);
      renderSocioSummary(data);
    } catch (err) {
      console.error(err);
      alert("Could not parse socio-economic data. Check file format.");
    }
  };
  reader.readAsText(file);
}

/* -------- Event Wiring -------- */

function collectInputs() {
  return {
    purchasePrice: parseNumber("purchasePrice", 0),
    purchaseCostRate: parseNumber("purchaseCostRate", 10),
    appreciationRate: parseNumber("appreciationRate", 2),
    sellingCostRate: parseNumber("sellingCostRate", 3),

    equity: parseNumber("equity", 0),
    interestRate: parseNumber("interestRate", 3.5),
    loanTermYears: parseNumber("loanTermYears", 30),

    monthlyRent: parseNumber("monthlyRent", 0),
    vacancyRate: parseNumber("vacancyRate", 5),
    maintenanceRate: parseNumber("maintenanceRate", 10),
    otherCostsAnnual: parseNumber("otherCostsAnnual", 0),

    taxRate: parseNumber("taxRate", 30),
    depreciationRate: parseNumber("depreciationRate", 3),

    investmentYears: parseNumber("investmentYears", 15),
  };
}

function loadSampleInputs() {
  document.getElementById("purchasePrice").value = 300000;
  document.getElementById("purchaseCostRate").value = 10;
  document.getElementById("appreciationRate").value = 2;
  document.getElementById("sellingCostRate").value = 3;

  document.getElementById("equity").value = 80000;
  document.getElementById("interestRate").value = 3.5;
  document.getElementById("loanTermYears").value = 30;

  document.getElementById("monthlyRent").value = 1200;
  document.getElementById("vacancyRate").value = 5;
  document.getElementById("maintenanceRate").value = 10;
  document.getElementById("otherCostsAnnual").value = 0;

  document.getElementById("taxRate").value = 30;
  document.getElementById("depreciationRate").value = 3;

  document.getElementById("investmentYears").value = 15;
}

document.addEventListener("DOMContentLoaded", () => {
  initCharts();

  document
    .getElementById("runSimulationBtn")
    .addEventListener("click", () => {
      const inputs = collectInputs();
      const result = runSimulation(inputs);
      renderResultsSummary(result, inputs);
      updateCharts(result);
    });

  document
    .getElementById("socioFile")
    .addEventListener("change", handleSocioFileChange);

  document
    .getElementById("loadSampleBtn")
    .addEventListener("click", loadSampleInputs);

  // Run once on load with defaults
  const initialInputs = collectInputs();
  const initialResult = runSimulation(initialInputs);
  renderResultsSummary(initialResult, initialInputs);
  updateCharts(initialResult);
});
