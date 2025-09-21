// app.js — static site, centralized API base and correct endpoints

document.addEventListener("DOMContentLoaded", () => {
  // Base API URL from global config (set in index.html). Fallback is the deployed backend.
  const API_BASE = (window.CONFIG && window.CONFIG.API_BASE) || "https://s3-retail-solutions-backend.onrender.com";

  // --- 1. Security & Session Data ---
  const userRole = sessionStorage.getItem("userRole");
  let sd = sessionStorage.getItem("startDate"); // may be US or ISO
  let ed = sessionStorage.getItem("endDate");   // may be US or ISO
  if (!userRole || !sd || !ed) {
    window.location.href = "index.html";
    return;
  }

  // US/ISO helpers
  const isISODate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isUSDate = (s) => typeof s === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(s);
  const isoToUS = (iso) => {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
  };
  const usToISO = (us) => {
    const [m, d, y] = us.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  };

  // Normalize session to have both US and ISO
  let startDateUS, endDateUS, startISO, endISO;
  if (isISODate(sd) && isISODate(ed)) {
    startISO = sd;
    endISO = ed;
    startDateUS = isoToUS(sd);
    endDateUS = isoToUS(ed);
  } else if (isUSDate(sd) && isUSDate(ed)) {
    startDateUS = sd;
    endDateUS = ed;
    startISO = usToISO(sd);
    endISO = usToISO(ed);
  } else {
    alert("Invalid date format in session. Please log in again.");
    window.location.href = "index.html";
    return;
  }
  // Persist normalized keys
  sessionStorage.setItem("startDate", startDateUS);
  sessionStorage.setItem("endDate", endDateUS);
  sessionStorage.setItem("startDateISO", startISO);
  sessionStorage.setItem("endDateISO", endISO);

  // --- 2. DOM Elements ---
  const tableLoading = document.getElementById("table-loading");
  const tableContainer = document.getElementById("table-container");
  const tableHead = document.querySelector("#data-table thead tr");
  const tableBody = document.querySelector("#data-table tbody");
  const logoutBtn = document.getElementById("logout-btn");
  const exportBtn = document.getElementById("export-btn");
  const marketIdFilter = document.getElementById("market-id-filter");
  const custnoFilter = document.getElementById("custno-filter");
  const itmdescFilter = document.getElementById("itmdesc-filter");
  const dateFilter = document.getElementById("date-filter");
  const quantityFilter = document.getElementById("quantity-filter");
  const dataCountElement = document.getElementById("data-count");

  // --- 3. State ---
  let fullData = [];
  let headers = [];
  let currentFilteredData = [];
  const columnsToShow = 23;
  const rowsPerPage = 1000;
  let currentPage = 1;

  // --- 4. Global Listeners ---
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      sessionStorage.clear();
      window.location.href = "index.html";
    });
  }
  if (exportBtn) exportBtn.addEventListener("click", exportToExcel);

  // --- 5. Pagination Controls ---
  const paginationContainer = document.createElement("div");
  paginationContainer.classList.add("pagination-container");
  paginationContainer.style.marginTop = "10px";
  paginationContainer.style.textAlign = "center";
  paginationContainer.style.paddingBottom = "50px";
  if (tableContainer) {
    tableContainer.parentNode.insertBefore(paginationContainer, tableContainer.nextSibling);
  }

  function renderPaginationControls() {
    paginationContainer.innerHTML = "";
    const totalPages = Math.ceil(currentFilteredData.length / rowsPerPage);
    if (totalPages <= 1) return;

    const createPageButton = (text, disabled, isCurrent = false) => {
      const btn = document.createElement("button");
      btn.textContent = text;
      btn.disabled = disabled;
      btn.className =
        "mx-1 px-3 py-1 rounded border text-sm font-semibold " +
        (disabled
          ? "bg-gray-200 text-gray-400 cursor-not-allowed border-gray-300"
          : "bg-white text-gray-700 hover:bg-blue-600 hover:text-white border-gray-300");
      if (isCurrent) {
        btn.className =
          "mx-1 px-3 py-1 rounded border text-sm font-bold bg-blue-600 text-white border-blue-700 shadow";
        btn.disabled = true;
      }
      return btn;
    };

    const prevBtn = createPageButton("Previous", currentPage === 1);
    prevBtn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        updateTableByPage();
      }
    });
    paginationContainer.appendChild(prevBtn);

    const maxPageButtons = 10;
    let startPage = Math.max(1, currentPage - Math.floor(maxPageButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxPageButtons - 1);
    if (endPage - startPage < maxPageButtons - 1) {
      startPage = Math.max(1, endPage - maxPageButtons + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = createPageButton(i, false, i === currentPage);
      if (i !== currentPage) {
        pageBtn.addEventListener("click", () => {
          currentPage = i;
          updateTableByPage();
        });
      }
      paginationContainer.appendChild(pageBtn);
    }

    const nextBtn = createPageButton("Next", currentPage === totalPages);
    nextBtn.addEventListener("click", () => {
      if (currentPage < totalPages) {
        currentPage++;
        updateTableByPage();
      }
    });
    paginationContainer.appendChild(nextBtn);
  }

  function updateTableByPage() {
    const startIdx = (currentPage - 1) * rowsPerPage;
    const endIdx = currentPage * rowsPerPage;
    renderTableBody(currentFilteredData.slice(startIdx, endIdx));
    renderPaginationControls();
    updateDataCount();
  }

  // --- 6. Data Fetching ---
  async function fetchDataForRange() {
    tableLoading.textContent = `Loading data from ${startDateUS} to ${endDateUS}...`;
    try {
      // Use deployed backend and correct API route
      const response = await fetch(`${API_BASE}/get-data-for-range`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: startISO, endDate: endISO }),
      });
      if (!response.ok) {
        let msg = "Failed to fetch data";
        try {
          const errJson = await response.json();
          if (errJson?.message) msg = errJson.message;
        } catch (_) {}
        throw new Error(msg);
      }
      const result = await response.json();

      headers = result.headers || [];
      fullData = (result.data || []).map((r) => {
        const raw = r["Recommended Quntitty"];
        const num = parseFloat(raw);
        return {
          ...r,
          ["Recommended Quntitty"]:
            raw === undefined || raw === null || raw === "" || Number.isNaN(num) ? "0" : String(num),
        };
      });

      fullData.sort((a, b) => new Date(b.Date) - new Date(a.Date));

      // Login-based market filtering
      if (userRole !== "admin") {
        fullData = fullData.filter((row) => row.Marketid === userRole);
      }

      initializeView();
    } catch (error) {
      tableLoading.textContent = `Error: ${error.message}`;
    }
  }

  // --- 7. View Initialization ---
  function initializeView() {
    if (!fullData || fullData.length === 0) {
      tableLoading.textContent = "No data available for the selected date range.";
      return;
    }
    tableLoading.style.display = "none";
    tableContainer.style.display = "block";

    // Set market filter according to userRole
    if (userRole !== "admin") {
      marketIdFilter.disabled = true;
      marketIdFilter.innerHTML = `<option value="${userRole}" selected>${userRole}</option>`;
    } else {
      const markets = [...new Set(fullData.map((row) => row.Marketid).filter(Boolean))].sort();
      populateSelect(marketIdFilter, markets, "All Markets");
    }

    const dates = [...new Set(fullData.map((row) => row.Date).filter(Boolean))].sort();
    populateSelect(dateFilter, dates, "All Dates");

    const quantityOptions = {
      ALL: "All Quantities",
      less_than_zero: "Deficit",
      equal_to_zero: "No Requirement",
      more_than_zero: "Excess",
    };
    populateStaticSelect(quantityFilter, quantityOptions);

    updateDependentFilters();
    renderTableHeaders();
    applyFilters();

    marketIdFilter.addEventListener("change", () => {
      updateDependentFilters();
      applyFilters();
    });
    custnoFilter.addEventListener("change", () => {
      updateDependentFilters();
      applyFilters();
    });
    itmdescFilter.addEventListener("change", applyFilters);
    dateFilter.addEventListener("change", applyFilters);
    quantityFilter.addEventListener("change", applyFilters);
  }

  // --- 8. Filtering & Dropdown Updates ---
  function updateDependentFilters() {
    const marketQuery = marketIdFilter.value;
    let visibleData = fullData.filter((row) => marketQuery === "ALL" || row.Marketid === marketQuery);
    const customers = [...new Set(visibleData.map((row) => row.custno).filter(Boolean))].sort();
    populateSelect(custnoFilter, customers, "All Customers");

    const custnoQuery = custnoFilter.value;
    if (custnoQuery !== "ALL") visibleData = visibleData.filter((row) => row.custno === custnoQuery);

    const items = [...new Set(visibleData.map((row) => row.Itmdesc).filter(Boolean))].sort();
    populateSelect(itmdescFilter, items, "All Items");
  }

  function populateStaticSelect(selectElement, options) {
    if (!selectElement) return;
    selectElement.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "ALL";
    defaultOption.textContent = "All Quantities";
    selectElement.appendChild(defaultOption);
    for (const [value, text] of Object.entries(options)) {
      if (value === "ALL") continue;
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      selectElement.appendChild(option);
    }
  }

  function populateSelect(selectElement, values, defaultOptionText) {
    if (!selectElement) return;
    const currentVal = selectElement.value;
    selectElement.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "ALL";
    defaultOption.textContent = defaultOptionText;
    selectElement.appendChild(defaultOption);
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      selectElement.appendChild(option);
    });
    selectElement.value = [...selectElement.options].some((opt) => opt.value === currentVal) ? currentVal : "ALL";
  }

  function applyFilters() {
    const marketQuery = marketIdFilter.value;
    const custnoQuery = custnoFilter.value;
    const itmdescQuery = itmdescFilter.value;
    const dateQuery = dateFilter.value;
    const quantityQuery = quantityFilter.value;

    currentFilteredData = fullData.filter((row) => {
      const marketMatch = marketQuery === "ALL" || row.Marketid === marketQuery;
      const custnoMatch = custnoQuery === "ALL" || row.custno === custnoQuery;
      const itmdescMatch = itmdescQuery === "ALL" || row.Itmdesc === itmdescQuery;
      const dateMatch = dateQuery === "ALL" || row.Date === dateQuery;
      const qRaw = row["Recommended Quntitty"];
      const quantity = Number.isNaN(parseFloat(qRaw)) ? 0 : parseFloat(qRaw);

      let quantityMatch = true;
      if (quantityQuery === "less_than_zero") quantityMatch = quantity < 0;
      else if (quantityQuery === "equal_to_zero") quantityMatch = quantity === 0;
      else if (quantityQuery === "more_than_zero") quantityMatch = quantity > 0;

      return marketMatch && custnoMatch && itmdescMatch && dateMatch && quantityMatch;
    });

    currentPage = 1; // Reset to first page on filter change
    updateTableByPage();
  }

  // --- 9. Table Rendering ---
  function renderTableHeaders() {
    tableHead.innerHTML = "";
    for (let i = 0; i < Math.min(headers.length, columnsToShow); i++) {
      const th = document.createElement("th");
      th.className = "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider";
      th.textContent = headers[i].replace(/_/g, " ");
      tableHead.appendChild(th);
    }
  }

  function renderTableBody(data) {
    tableBody.innerHTML = "";
    if (data.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columnsToShow;
      td.className = "text-center py-8 text-gray-500";
      td.textContent = "No records match the current filters.";
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }

    data.forEach((row) => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-gray-50";
      for (let i = 0; i < Math.min(headers.length, columnsToShow); i++) {
        const header = headers[i];
        const td = document.createElement("td");
        td.className = "px-6 py-4 whitespace-nowrap text-sm text-gray-800";
        let value = row[header];
        if (value === undefined || value === null || value === "") value = 0;
        td.textContent = value;
        tr.appendChild(td);
      }
      tableBody.appendChild(tr);
    });

    updateDataCount();
  }

  // --- 10. Data count display ---
  function updateDataCount() {
    if (!dataCountElement) return;
    const rowCount = currentFilteredData.length;
    const colCount = Math.min(headers.length, columnsToShow);
    dataCountElement.textContent =
      rowCount > 0
        ? `Displaying ${Math.min(rowCount, rowsPerPage)} rows on page ${currentPage} of ${Math.ceil(
            rowCount / rowsPerPage
          )}, total ${rowCount} rows and ${colCount} columns`
        : "No data to display";
  }

  // --- 11. Export ---
  function exportToExcel() {
    if (!currentFilteredData || currentFilteredData.length === 0) {
      alert("No data to export.");
      return;
    }

    const dataForSheet = currentFilteredData.map((row) => {
      const newRow = {};
      headers.slice(0, columnsToShow).forEach((header) => {
        let value = row[header];
        if (value === undefined || value === null || value === "") value = 0;
        newRow[header] = value;
      });
      return newRow;
    });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(dataForSheet);
    XLSX.utils.book_append_sheet(workbook, worksheet, "DashboardData");
    XLSX.writeFile(workbook, "dashboard_export.xlsx");
  }

  // --- 12. Initialize pagination view ---
  fetchDataForRange();
});


