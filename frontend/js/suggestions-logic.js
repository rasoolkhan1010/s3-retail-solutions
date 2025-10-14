document.addEventListener("DOMContentLoaded", () => {
  // 0) Backend base URL
  const API_BASE = (window.CONFIG && window.CONFIG.API_BASE) || "https://s3-retail-solutions-backend.onrender.com";

  // 1) Security/session check
  const userRole = sessionStorage.getItem("userRole");
  let sd = sessionStorage.getItem("startDate");
  let ed = sessionStorage.getItem("endDate");
  if (!userRole || !sd || !ed) {
    window.location.href = "index.html";
    return;
  }

  // 2) Date helpers
  const isISODate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isUSDate = s => typeof s === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(s);
  const isoToUS = iso => {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
  };
  const usToISO = us => {
    const [m, d, y] = us.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  };

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
  sessionStorage.setItem("startDate", startDateUS);
  sessionStorage.setItem("endDate", endDateUS);
  sessionStorage.setItem("startDateISO", startISO);
  sessionStorage.setItem("endDateISO", endISO);

  // 3) DOM references
  const tableLoading = document.getElementById("table-loading");
  const tableContainer = document.getElementById("table-container");
  const tableHead = document.querySelector("#data-table thead tr");
  const tableBody = document.querySelector("#data-table tbody");
  const sendSelectedBtn = document.getElementById("send-selected-btn");
  const marketIdFilter = document.getElementById("market-id-filter");
  const custnoFilter = document.getElementById("custno-filter");
  const itmdescFilter = document.getElementById("itmdesc-filter");
  const dateFilter = document.getElementById("date-filter");
  const quantityFilter = document.getElementById("quantity-filter");
  const logoutBtn = document.getElementById("logout-btn");
  const exportBtn = document.getElementById("export-btn");
  const approvalModal = document.getElementById("approval-modal");
  const modalApproverSelect = document.getElementById("modal-approver-select");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");
  const modalOkayBtn = document.getElementById("modal-okay-btn");
  const modalItemCount = document.getElementById("modal-item-count");
  const dataCountElement = document.getElementById("data-count");

  // 4) State variables
  let fullData = [];
  let currentFilteredData = [];
  let dataToSend = [];
  const rowsPerPage = 1000;
  let currentPage = 1;

  // 5) Headers and column mapping (UPDATED WITH COMMENTS)
  const desiredHeaders = [
    "Select", "Market-id", "company", "Itmdesc", "Cost",
    "Total_Stock", "30_days", "W3",
    "Recommended Quntitty", "required qty", "Total Cost",
    "recommended shipping", "Comments", "Action"
  ];
  const columnMapping = {
    "Market-id": "Marketid",
    company: "company",
    Itmdesc: "Itmdesc",
    Cost: "cost",
    "Total_Stock": "Total_Stock",
    "30_days": "30_days",
    "W3": "W3",
    "Recommended Quntitty": "Recommended Quntitty",
    "recommended shipping": "Recommended Shipping"
  };
  const SHIPPING_OPTIONS = ["No order needed", "Overnight", "2-day shipping", "Ground"];
  const keyOf = r => `${r.Marketid}||${r.company}||${r.Itmdesc}`.replace(/[^a-zA-Z0-9|]/g, '_');

  // 6) Setup logout and export
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      sessionStorage.clear();
      window.location.href = "index.html";
    });
  }
  if (exportBtn) exportBtn.addEventListener("click", exportToExcel);

  // 7) Setup Fixed Header Table Structure
  function setupFixedHeaderTable() {
    const dataTable = document.getElementById("data-table");
    if (!dataTable) return;

    const tableWrapper = document.createElement("div");
    tableWrapper.style.position = "relative";
    tableWrapper.style.maxHeight = "600px";
    tableWrapper.style.overflowY = "auto";
    tableWrapper.style.overflowX = "auto";
    tableWrapper.style.border = "1px solid #e5e7eb";
    tableWrapper.style.borderRadius = "8px";

    dataTable.parentNode.insertBefore(tableWrapper, dataTable);
    tableWrapper.appendChild(dataTable);

    dataTable.style.display = "table";
    dataTable.style.width = "100%";
    dataTable.style.borderCollapse = "collapse";

    const thead = dataTable.querySelector("thead");
    if (thead) {
      thead.style.position = "sticky";
      thead.style.top = "0";
      thead.style.zIndex = "5";
      thead.style.backgroundColor = "#f9fafb";
      thead.style.borderBottom = "2px solid #e5e7eb";
    }
  }

  // 8) Setup Modal with proper z-index
  function setupModalZIndex() {
    if (approvalModal) {
      approvalModal.style.zIndex = "9999";
      approvalModal.style.position = "fixed";
      approvalModal.style.top = "0";
      approvalModal.style.left = "0";
      approvalModal.style.width = "100%";
      approvalModal.style.height = "100%";
      approvalModal.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
      
      const modalContent = approvalModal.querySelector('.modal-content, .bg-white, [class*="modal"]');
      if (modalContent) {
        modalContent.style.position = "relative";
        modalContent.style.zIndex = "10000";
        modalContent.style.margin = "auto";
        modalContent.style.marginTop = "10vh";
        modalContent.style.maxHeight = "80vh";
        modalContent.style.overflowY = "auto";
      }
    }
  }

  // 9) Pagination setup
  const paginationContainer = document.createElement("div");
  paginationContainer.classList.add("pagination-container");
  paginationContainer.style.marginTop = "10px";
  paginationContainer.style.textAlign = "center";
  paginationContainer.style.paddingBottom = "50px";
  if (tableContainer) tableContainer.parentNode.insertBefore(paginationContainer, tableContainer.nextSibling);

  function renderPaginationControls() {
    paginationContainer.innerHTML = "";
    const totalPages = Math.ceil(currentFilteredData.length / rowsPerPage);
    if (totalPages <= 1) return;

    const createPageButton = (text, disabled, isCurrent = false) => {
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
    };

    const prevBtn = createPageButton("Previous", currentPage === 1);
    prevBtn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        updateTableByPage();
      }
    });
    paginationContainer.appendChild(prevBtn);

    let startPage = Math.max(1, currentPage - 4);
    let endPage = Math.min(totalPages, startPage + 9);
    if (endPage - startPage < 9) startPage = Math.max(1, endPage - 9);

    for (let i = startPage; i <= endPage; i++) {
      const btn = createPageButton(i, false, i === currentPage);
      if (i !== currentPage) {
        btn.addEventListener("click", () => {
          currentPage = i;
          updateTableByPage();
        });
      }
      paginationContainer.appendChild(btn);
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

  // 10) Fetch data function
  async function fetchDataForRange() {
    if (tableLoading) {
      tableLoading.textContent = `Loading data from ${startDateUS} to ${endDateUS}...`;
    }
    try {
      const response = await fetch(`${API_BASE}/api/get-data-for-range`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: startISO, endDate: endISO }),
      });
      if (!response.ok) {
        let msg = "Failed to fetch data";
        try {
          const j = await response.json();
          if (j && j.message) msg = j.message;
        } catch (_) {}
        throw new Error(msg);
      }
      const result = await response.json();
      fullData = (result.data || []).map(r => {
        const raw = r["Recommended Quntitty"];
        const num = parseFloat(raw);
        return {
          ...r,
          ["Recommended Quntitty"]: raw === undefined || raw === null || raw === "" || Number.isNaN(num) ? "0" : String(num),
          _comment: "" // Initialize comment field
        };
      });
      fullData.sort((a, b) => new Date(b.Date) - new Date(a.Date));
      if (userRole !== "admin") {
        fullData = fullData.filter(row => row.Marketid === userRole);
      }
      initializeView();
    } catch (error) {
      if (tableLoading) tableLoading.textContent = `Error: ${error.message}`;
    }
  }
  fetchDataForRange();

  // 11) Initialize and add event listeners
  function initializeView() {
    if (!fullData || fullData.length === 0) {
      if (tableLoading) tableLoading.textContent = "No data available for the selected date range.";
      return;
    }
    if (tableLoading) tableLoading.style.display = "none";
    if (tableContainer) tableContainer.style.display = "block";

    setupFixedHeaderTable();
    setupModalZIndex();

    if (userRole !== "admin" && marketIdFilter) {
      marketIdFilter.disabled = true;
      marketIdFilter.innerHTML = `<option value="${userRole}" selected>${userRole}</option>`;
    } else if (marketIdFilter) {
      const markets = [...new Set(fullData.map(r => r.Marketid).filter(Boolean))].sort();
      populateSelect(marketIdFilter, markets, "All Markets");
    }

    if (dateFilter) {
      const dates = [...new Set(fullData.map(r => r.Date).filter(Boolean))].sort();
      populateSelect(dateFilter, dates, "All Dates");
    }

    const quantityOptions = {
      ALL: "All Quantities",
      less_than_zero: "Deficit",
      equal_to_zero: "No Requirement",
      more_than_zero: "Excess"
    };
    if (quantityFilter) populateStaticSelect(quantityFilter, quantityOptions);

    updateDependentFilters();
    renderTableHeaders();
    applyFilters();

    // Filter event listeners
    if (marketIdFilter) marketIdFilter.addEventListener("change", () => { updateDependentFilters(); applyFilters(); });
    if (custnoFilter) custnoFilter.addEventListener("change", () => { updateDependentFilters(); applyFilters(); });
    if (itmdescFilter) itmdescFilter.addEventListener("change", applyFilters);
    if (dateFilter) dateFilter.addEventListener("change", applyFilters);
    if (quantityFilter) quantityFilter.addEventListener("change", applyFilters);

    // Modal event listeners with body scroll prevention
    if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeModal);
    if (modalOkayBtn) modalOkayBtn.addEventListener("click", sendApproval);
    if (sendSelectedBtn) sendSelectedBtn.addEventListener("click", handleBulkSend);
  }

  // 12) Modal functions with scroll prevention
  function closeModal() {
    if (approvalModal) {
      approvalModal.style.display = "none";
      document.body.style.overflow = "auto";
    }
  }

  function openModal() {
    if (approvalModal) {
      approvalModal.style.display = "flex";
      document.body.style.overflow = "hidden";
    }
  }

  // 13) Filter helpers and logic
  function updateDependentFilters() {
    if (!marketIdFilter) return;
    const marketQuery = marketIdFilter.value;
    let visibleData = fullData.filter(row => marketQuery === "ALL" || row.Marketid === marketQuery);

    if (custnoFilter) {
      const customers = [...new Set(visibleData.map(row => row.custno).filter(Boolean))].sort();
      populateSelect(custnoFilter, customers, "All Customers");
    }
    const custnoQuery = custnoFilter ? custnoFilter.value : "ALL";
    if (custnoFilter && custnoQuery !== "ALL") {
      visibleData = visibleData.filter(row => row.custno === custnoQuery);
    }
    if (itmdescFilter) {
      const items = [...new Set(visibleData.map(row => row.Itmdesc).filter(Boolean))].sort();
      populateSelect(itmdescFilter, items, "All Items");
    }
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
    values.forEach(value => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      selectElement.appendChild(option);
    });
    selectElement.value = [...selectElement.options].some(opt => opt.value === currentVal) ? currentVal : "ALL";
  }

  function applyFilters() {
    if (!marketIdFilter) return;
    const marketQuery = marketIdFilter.value;
    const custnoQuery = custnoFilter ? custnoFilter.value : "ALL";
    const itmdescQuery = itmdescFilter ? itmdescFilter.value : "ALL";
    const dateQuery = dateFilter ? dateFilter.value : "ALL";
    const quantityQuery = quantityFilter ? quantityFilter.value : "ALL";

    currentFilteredData = fullData.filter(row => {
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

    currentPage = 1;
    updateTableByPage();
  }

  // 14) Table rendering functions (UPDATED WITH COMMENTS)
  function renderTableHeaders() {
    if (!tableHead) return;
    tableHead.innerHTML = "";
    desiredHeaders.forEach(headerText => {
      const th = document.createElement("th");
      th.className = "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider";
      th.style.minWidth = "150px";
      th.style.whiteSpace = "nowrap";
      
      if (headerText === "Select") {
        th.style.minWidth = "80px";
        const selectAllCheckbox = document.createElement("input");
        selectAllCheckbox.type = "checkbox";
        selectAllCheckbox.className = "form-checkbox h-4 w-4 text-indigo-600";
        selectAllCheckbox.addEventListener("change", e => {
          const checked = e.target.checked;
          if (!tableBody) return;
          tableBody.querySelectorAll("input.row-checkbox").forEach(box => (box.checked = checked));
        });
        th.appendChild(selectAllCheckbox);
      } else if (headerText === "Action") {
        th.style.minWidth = "100px";
        th.textContent = headerText;
      } else if (headerText === "Comments") {
        th.style.minWidth = "200px";
        th.textContent = headerText;
      } else {
        th.textContent = headerText;
      }
      tableHead.appendChild(th);
    });
  }

  function renderTableBody(data) {
    if (!tableBody) return;
    tableBody.innerHTML = "";
    if (!data || data.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = desiredHeaders.length;
      td.className = "text-center py-8 text-gray-500";
      td.textContent = "No records match the current filters.";
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }
    data.forEach(row => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-gray-50";
      const rowKey = keyOf(row);
      desiredHeaders.forEach(headerKey => {
        const td = document.createElement("td");
        td.className = "px-6 py-4 whitespace-nowrap text-sm text-gray-800";
        td.style.minWidth = "150px";
        td.style.maxWidth = "200px";
        td.style.overflow = "hidden";
        td.style.textOverflow = "ellipsis";

        if (headerKey === "Select") {
          td.style.minWidth = "80px";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "form-checkbox h-4 w-4 text-indigo-600 row-checkbox";
          checkbox.dataset.key = rowKey;
          td.appendChild(checkbox);

        } else if (headerKey === "Action") {
          td.style.minWidth = "100px";
          const sendBtn = document.createElement("button");
          sendBtn.textContent = "Approve";
          sendBtn.className = "bg-green-500 hover:bg-green-600 text-white font-bold py-1 px-3 rounded text-xs";
          sendBtn.onclick = () => openSendModal([row]);
          td.appendChild(sendBtn);

        } else if (headerKey === "Comments") {
          td.style.minWidth = "200px";
          td.style.maxWidth = "250px";
          const textarea = document.createElement("textarea");
          textarea.className = "comment-field border rounded px-2 py-1 text-xs resize-none";
          textarea.style.width = "100%";
          textarea.style.height = "60px";
          textarea.placeholder = "Add your comments here...";
          textarea.value = row._comment || "";
          
          // SIMPLE: Store by finding the original row in fullData
          textarea.addEventListener("input", (e) => {
            // Find the original row and update it directly
            const originalRow = fullData.find(r => 
              r.Marketid === row.Marketid && 
              r.company === row.company && 
              r.Itmdesc === row.Itmdesc
            );
            if (originalRow) {
              originalRow._comment = e.target.value;
              console.log(`Comment saved: "${e.target.value}"`);
            }
          });
          
          td.appendChild(textarea);

        } else if (headerKey === "recommended shipping") {
          const select = document.createElement("select");
          select.className = "recommended-shipping border rounded px-2 py-1 text-xs";
          select.style.width = "100%";
          select.dataset.key = rowKey;
          SHIPPING_OPTIONS.forEach(v => {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = v;
            select.appendChild(o);
          });
          select.value = row["Recommended Shipping"] || "No order needed";
          select.addEventListener("change", () => {
            const rec = fullData.find(r => keyOf(r) === rowKey);
            if (rec) rec["Recommended Shipping"] = select.value;
          });
          td.appendChild(select);

        } else if (headerKey === "required qty") {
          const init = row._neededQty !== undefined ? row._neededQty : 0;
          const input = document.createElement("input");
          input.type = "number";
          input.step = "any";
          input.className = "needed-qty border rounded px-2 py-1 w-full text-xs";
          input.style.maxWidth = "100px";
          input.value = init;
          input.dataset.key = rowKey;
          input.addEventListener("input", () => {
            const rec = fullData.find(r => keyOf(r) === rowKey);
            if (!rec) return;
            const val = parseFloat(input.value);
            rec._neededQty = isNaN(val) ? 0 : val;
            
            // FIXED: Find Total Cost cell in current row only
            const currentRow = input.closest('tr');
            const totalCostCell = currentRow.querySelector('td.total-cost');
            
            if (totalCostCell) {
              const cst = parseFloat(rec.cost) || 0;
              const qty = rec._neededQty !== undefined ? rec._neededQty : 0;
              totalCostCell.textContent = (qty * cst).toFixed(2);
            }
          });
          td.appendChild(input);

        } else if (headerKey === "Total Cost") {
          const need = row._neededQty !== undefined ? row._neededQty : 0;
          const cst = parseFloat(row.cost) || 0;
          td.classList.add("total-cost");
          td.dataset.key = rowKey;
          td.textContent = (need * cst).toFixed(2);

        } else {
          const csvHeader = columnMapping[headerKey];
          let value = row[csvHeader];
          if (headerKey === "recommended qty") {
            const n = parseFloat(value);
            value = value === undefined || value === null || value === "" || Number.isNaN(n) ? 0 : n;
          }
          if (value === undefined || value === null || value === "") value = 0;
          td.textContent = value;
          td.title = value;
        }
        tr.appendChild(td);
      });
      tableBody.appendChild(tr);
    });
  }

  // 15) Modal approval flow
  function openSendModal(items) {
    if (!items || items.length === 0) {
      alert("Please select at least one item to send.");
      return;
    }
    dataToSend = items;
    if (modalItemCount) modalItemCount.textContent = items.length;
    if (modalApproverSelect) modalApproverSelect.value = "";
    openModal();
  }

  function handleBulkSend() {
    const selectedRowsData = [];
    if (!tableBody) return;
    const checkedBoxes = tableBody.querySelectorAll("input.row-checkbox:checked");
    checkedBoxes.forEach(checkbox => {
      const rec = fullData.find(r => keyOf(r) === checkbox.dataset.key);
      if (rec) selectedRowsData.push(rec);
    });
    openSendModal(selectedRowsData);
  }

  // FIXED sendApproval function - gets comments from data object directly
  async function sendApproval() {
    if (!dataToSend || dataToSend.length === 0) {
      alert("Error: No data to send.");
      return;
    }
    const approver = modalApproverSelect ? modalApproverSelect.value : "";
    if (!approver) {
      alert("Please select an approver.");
      return;
    }
    
    for (const item of dataToSend) {
      const rqRaw = item["Recommended Quntitty"];
      const recommendedQty = Number.isNaN(parseFloat(rqRaw)) ? 0 : parseFloat(rqRaw);
      const neededQty = item._neededQty !== undefined ? parseFloat(item._neededQty) : 0;
      const itemCost = parseFloat(item.cost) || 0;
      const itemKey = keyOf(item);
      
      // Get shipping
      const shippingSelect = tableBody.querySelector(`select.recommended-shipping[data-key="${itemKey}"]`);
      const shipping = shippingSelect ? shippingSelect.value : item["Recommended Shipping"] || "No order needed";
      
      // FIXED: Get comments directly from data object (already updated by textarea event)
      const comments = item._comment || "";
      
      console.log(`Sending comment for ${item.Itmdesc}: "${comments}"`);
      
      const totalCost = (neededQty * itemCost).toFixed(2);
      
      try {
        await fetch(`${API_BASE}/api/add-history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            Marketid: item.Marketid,
            company: item.company,
            Itmdesc: item.Itmdesc,
            cost: item.cost,
            "Total_Stock": item["Total_Stock"] || 0,
            Original_Recommended_Qty: recommendedQty,
            Order_Qty: neededQty,
            Total_Cost: totalCost,
            Recommended_Shipping: shipping,
            Approved_By: approver,
            Comments: comments // This should now work!
          }),
        });
      } catch (error) {
        alert(`An error occurred while sending item: ${item.Itmdesc}. Process stopped.`);
        return;
      }
    }
    
    alert(`${dataToSend.length} item(s) sent for approval successfully!`);
    closeModal();
    dataToSend = [];
    if (tableBody) {
      tableBody.querySelectorAll("input.row-checkbox:checked").forEach(cb => (cb.checked = false));
    }
    applyFilters();
  }

  // 16) Update data count
  function updateDataCount() {
    if (!dataCountElement) return;
    const rowCount = currentFilteredData.length;
    const colCount = desiredHeaders.length;
    dataCountElement.textContent = rowCount > 0
      ? `Displaying ${Math.min(rowCount, rowsPerPage)} rows on page ${currentPage} of ${Math.ceil(rowCount / rowsPerPage)}, total ${rowCount} rows and ${colCount} columns`
      : "No data to display";
  }

  // 17) Export to Excel
  function exportToExcel() {
    if (!currentFilteredData || currentFilteredData.length === 0) {
      alert("No data to export.");
      return;
    }
    const headersForExport = desiredHeaders.filter(h => h !== "Select" && h !== "Action");
    const dataForSheet = currentFilteredData.map(row => {
      const newRow = {};
      headersForExport.forEach(headerKey => {
        if (headerKey === "required qty") {
          newRow[headerKey] = row._neededQty !== undefined ? row._neededQty : 0;
          return;
        }
        if (headerKey === "Total Cost") {
          const need = row._neededQty !== undefined ? row._neededQty : 0;
          const cst = parseFloat(row.cost) || 0;
          newRow[headerKey] = (need * cst).toFixed(2);
          return;
        }
        if (headerKey === "recommended qty") {
          const raw = row["Recommended Quntitty"];
          const val = Number.isNaN(parseFloat(raw)) ? 0 : parseFloat(raw);
          newRow[headerKey] = val;
          return;
        }
        if (headerKey === "Comments") {
          newRow[headerKey] = row._comment || "";
          return;
        }
        const dbKey = columnMapping[headerKey];
        let value = row[dbKey];
        if (value === undefined || value === null || value === "") value = 0;
        newRow[headerKey] = value;
      });
      return newRow;
    });
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(dataForSheet);
    XLSX.utils.book_append_sheet(workbook, worksheet, "SuggestionsData");
    XLSX.writeFile(workbook, "suggestions_export.xlsx");
  }

  // 18) Handle clicks outside modal to close it
  if (approvalModal) {
    approvalModal.addEventListener("click", (e) => {
      if (e.target === approvalModal) {
        closeModal();
      }
    });
  }

  // 19) Handle ESC key to close modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && approvalModal && approvalModal.style.display === "flex") {
      closeModal();
    }
  });
});
