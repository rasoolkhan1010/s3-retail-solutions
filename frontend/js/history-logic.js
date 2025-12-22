document.addEventListener("DOMContentLoaded", () => {
  const tableLoading = document.getElementById("table-loading");
  const tableContainer = document.getElementById("table-container");
  const tableHead = document.querySelector("#history-table thead tr");
  const tableBody = document.querySelector("#history-table tbody");
  const exportBtn = document.getElementById("export-btn");
  const dataCountElement = document.getElementById("data-count");
  const filterStartDateInput = document.getElementById("filter-start-date");
  const filterEndDateInput = document.getElementById("filter-end-date");
  const applyFilterBtn = document.getElementById("apply-filter-btn");

  let fullHistoryData = [];
  let currentFilteredData = [];
  let currentPage = 1;
  const rowsPerPage = 1000;

  // Setup Fixed Header Table Structure
  function setupFixedHeaderTable() {
    const historyTable = document.getElementById("history-table");
    if (!historyTable) return;

    const tableWrapper = document.createElement("div");
    tableWrapper.style.position = "relative";
    tableWrapper.style.maxHeight = "600px";
    tableWrapper.style.overflowY = "auto";
    tableWrapper.style.overflowX = "auto";
    tableWrapper.style.border = "1px solid #e5e7eb";
    tableWrapper.style.borderRadius = "8px";

    historyTable.parentNode.insertBefore(tableWrapper, historyTable);
    tableWrapper.appendChild(historyTable);

    historyTable.style.display = "table";
    historyTable.style.width = "100%";
    historyTable.style.borderCollapse = "collapse";

    const thead = historyTable.querySelector("thead");
    if (thead) {
      thead.style.position = "sticky";
      thead.style.top = "0";
      thead.style.zIndex = "10";
      thead.style.backgroundColor = "#f9fafb";
      thead.style.borderBottom = "2px solid #e5e7eb";
    }
  }

  function initFilters() {
    const start = sessionStorage.getItem("startDateISO") || "2025-01-01";
    const end = sessionStorage.getItem("endDateISO") || new Date().toISOString().slice(0,10);
    filterStartDateInput.value = start;
    filterEndDateInput.value = end;
    return { startDate: start, endDate: end };
  }

  async function fetchHistoryData(startDate, endDate) {
    if (tableLoading) {
      tableLoading.textContent = `Loading history from ${startDate} to ${endDate}...`;
      tableLoading.style.display = "";
    }
    try {
      const userRole = sessionStorage.getItem("userRole") || "admin";
      console.log("Sending history request with marketid:", userRole);

      const response = await fetch(`${window.CONFIG.API_BASE}/api/get-history-for-range`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate, endDate, marketid: userRole }),
      });
      if (!response.ok) throw new Error("Failed to fetch history data");

      const json = await response.json();
      fullHistoryData = json.data || [];
      currentFilteredData = fullHistoryData;
      currentPage = 1;

      setupFixedHeaderTable();
      
      renderTableHeaders();
      updateTableByPage();

      if (tableLoading) tableLoading.style.display = "none";
      if (tableContainer) tableContainer.style.display = "block";
    }
    catch (error) {
      if (tableLoading) {
        tableLoading.textContent = `Error loading history: ${error.message}`;
        tableLoading.style.display = "";
      }
      if (tableContainer) tableContainer.style.display = "none";
    }
  }

  // UPDATED HEADERS AND KEYS (WITH COMMENTS)
  const headers = [
    "Marketid", "Company", "Itmdesc", "Cost", "Total Stock",
    "Original Recommended Qty", "Order Qty", "Total Cost",
    "Recommended Shipping", "Approved By", "Approved At", "Comments"
  ];
// UPDATED KEYS TO MATCH DATABASE SCREENSHOT
const dataKeys = [
  "marketid", 
  "company", 
  "itmdesc", 
  "cost", 
  "Total_Stock",           // Changed from total_stock
  "Original_Recomr",        // Changed from original_recommended_qty
  "Order_Qty",              // Changed from order_qty
  "Total_Cost",             // Changed from total_cost
  "Recommended_",           // Changed from recommended_shipping
  "Approved_By",            // Changed from approved_by
  "approved_at", 
  "comments"
];

  function renderTableHeaders() {
    if (!tableHead) return;
    tableHead.innerHTML = "";
    headers.forEach(header => {
      const th = document.createElement("th");
      th.className = "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider";
      th.style.minWidth = "150px";
      th.style.whiteSpace = "nowrap";
      
      if (header === "Marketid") {
        th.style.minWidth = "100px";
      } else if (header === "Cost" || header === "Total Cost") {
        th.style.minWidth = "120px";
      } else if (header === "Approved At") {
        th.style.minWidth = "180px";
      } else if (header === "Recommended Shipping") {
        th.style.minWidth = "160px";
      } else if (header === "Comments") {
        th.style.minWidth = "200px";
      }
      
      th.textContent = header;
      tableHead.appendChild(th);
    });
  }

  function renderTableBody(data) {
    if (!tableBody) return;
    tableBody.innerHTML = "";

    if (!data.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = headers.length;
      td.className = "text-center py-8 text-gray-500";
      td.textContent = "No records match the current filters.";
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }

    data.forEach((row, index) => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-gray-50";

      dataKeys.forEach((key, colIndex) => {
        const td = document.createElement("td");
        td.className = "px-6 py-4 whitespace-nowrap text-sm text-gray-800";
        td.style.minWidth = "150px";
        td.style.maxWidth = "200px";
        td.style.overflow = "hidden";
        td.style.textOverflow = "ellipsis";
        
        const header = headers[colIndex];
        if (header === "Marketid") {
          td.style.minWidth = "100px";
        } else if (header === "Cost" || header === "Total Cost") {
          td.style.minWidth = "120px";
        } else if (header === "Approved At") {
          td.style.minWidth = "180px";
          td.style.maxWidth = "220px";
        } else if (header === "Recommended Shipping") {
          td.style.minWidth = "160px";
        } else if (header === "Comments") {
          td.style.minWidth = "200px";
          td.style.maxWidth = "300px";
          // Special handling for comments - expandable
          const commentText = row[key] || "";
          if (commentText.length > 50) {
            td.style.cursor = "pointer";
            td.textContent = commentText.substring(0, 50) + "...";
            td.title = "Click to expand/collapse";
            td.addEventListener("click", () => {
              const isExpanded = td.dataset.expanded === "true";
              if (isExpanded) {
                td.textContent = commentText.substring(0, 50) + "...";
                td.style.whiteSpace = "nowrap";
                td.dataset.expanded = "false";
              } else {
                td.textContent = commentText;
                td.style.whiteSpace = "normal";
                td.style.wordWrap = "break-word";
                td.dataset.expanded = "true";
              }
            });
          } else {
            td.textContent = commentText;
          }
          td.title = commentText; // Full text as tooltip
          tr.appendChild(td);
          return;
        }

        let val = row[key];
        if (key === "approved_at" && val) {
          val = new Date(val).toLocaleString();
        }
        
        const displayValue = val !== null && val !== undefined ? val : "";
        td.textContent = displayValue;
        td.title = displayValue;
        tr.appendChild(td);
      });

      tableBody.appendChild(tr);
    });
  }

  function createPaginationContainer() {
    const container = document.createElement("div");
    container.className = "pagination-container";
    container.style.marginTop = "10px";
    container.style.textAlign = "center";
    container.style.paddingBottom = "50px";
    if (tableContainer) {
      tableContainer.parentNode.insertBefore(container, tableContainer.nextSibling);
    }
    return container;
  }

  function renderPaginationControls() {
    const container = document.querySelector(".pagination-container") || createPaginationContainer();
    container.innerHTML = "";
    const totalPages = Math.ceil(currentFilteredData.length / rowsPerPage);
    if (totalPages <= 1) return;

    function createPageButton(text, disabled, isCurrent = false) {
      const btn = document.createElement("button");
      btn.textContent = text;
      btn.disabled = disabled;
      btn.className = isCurrent
        ? "mx-1 px-3 py-1 rounded border text-sm font-bold bg-blue-600 text-white border-blue-700 shadow"
        : "mx-1 px-3 py-1 rounded border text-sm font-semibold bg-white text-gray-700 hover:bg-blue-600 hover:text-white border-gray-300";

      if (disabled) {
        btn.className = "mx-1 px-3 py-1 rounded border text-sm font-semibold bg-gray-200 text-gray-400 cursor-not-allowed border-gray-300";
      }
      return btn;
    }

    const prevBtn = createPageButton("Previous", currentPage === 1);
    prevBtn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        updateTableByPage();
      }
    });
    container.appendChild(prevBtn);

    let startPage = Math.max(1, currentPage - 4);
    let endPage = Math.min(totalPages, startPage + 9);
    if (endPage - startPage < 9) startPage = Math.max(1, endPage - 9);

    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = createPageButton(i, false, i === currentPage);
      if (i !== currentPage) {
        pageBtn.addEventListener("click", () => {
          currentPage = i;
          updateTableByPage();
        });
      }
      container.appendChild(pageBtn);
    }

    const nextBtn = createPageButton("Next", currentPage === totalPages);
    nextBtn.addEventListener("click", () => {
      if (currentPage < totalPages) {
        currentPage++;
        updateTableByPage();
      }
    });
    container.appendChild(nextBtn);
  }

  function updateTableByPage() {
    const startIdx = (currentPage - 1) * rowsPerPage;
    const endIdx = currentPage * rowsPerPage;
    renderTableBody(currentFilteredData.slice(startIdx, endIdx));
    renderPaginationControls();
    updateDataCount();
  }

  function updateDataCount() {
    if (!dataCountElement) return;
    const rowCount = currentFilteredData.length;
    const colCount = headers.length;
    dataCountElement.textContent = rowCount > 0
      ? `Displaying ${Math.min(rowCount, rowsPerPage)} rows on page ${currentPage} of ${Math.ceil(rowCount / rowsPerPage)}, total ${rowCount} rows and ${colCount} columns`
      : "No data to display";
  }

  // UPDATED EXPORT FUNCTION (WITH COMMENTS)
  function exportToExcel() {
    if (!currentFilteredData.length) {
      alert("No data to export.");
      return;
    }
    const worksheetData = currentFilteredData.map(item => {
      const obj = {};
      headers.forEach((header, i) => {
        let value = item[dataKeys[i]] || "";
        if (dataKeys[i] === "approved_at" && value) {
          value = new Date(value).toLocaleString();
        }
        obj[header] = value;
      });
      return obj;
    });
    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "History");
    XLSX.writeFile(workbook, "Approval_History.xlsx");
  }

  const filters = initFilters();
  fetchHistoryData(filters.startDate, filters.endDate);

  applyFilterBtn.addEventListener("click", () => {
    const startDate = filterStartDateInput.value;
    const endDate = filterEndDateInput.value;
    if (!startDate || !endDate) {
      alert("Please select both start and end dates.");
      return;
    }
    sessionStorage.setItem("startDateISO", startDate);
    sessionStorage.setItem("endDateISO", endDate);
    fetchHistoryData(startDate, endDate);
  });

  if (exportBtn) {
    exportBtn.addEventListener("click", exportToExcel);
  }
});

