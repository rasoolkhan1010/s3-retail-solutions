document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  if (!loginForm) {
    console.error("Fatal Error: Login form not found!");
    return;
  }

  // Single source of truth for backend URL (set in index.html)
  const API_BASE = (window.CONFIG && window.CONFIG.API_BASE) || "https://iasr-s3-2.onrender.com";

  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const marketSelect = document.getElementById("market-select");
  const errorMessage = document.getElementById("error-message");
  const loginButton = loginForm.querySelector('button[type="submit"]');
  const startDateInput = document.getElementById("start-date"); // type="date"
  const endDateInput = document.getElementById("end-date");     // type="date"

  // Date helpers
  const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isUS = s => /^\d{2}\/\d{2}\/\d{4}$/.test(s);
  const isDMY = s => /^\d{2}-\d{2}-\d{4}$/.test(s);

  const isoToUS = iso => {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
  };
  const usToISO = us => {
    const [m,d,y] = us.split("/");
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  };
  const dmyToUS = dmy => {
    const [d,m,y] = dmy.split("-");
    return `${m.padStart(2,"0")}/${d.padStart(2,"0")}/${y}`;
  };

  function readAnyToISO(val) {
    if (!val) return "";
    if (isISO(val)) return val;
    if (isUS(val)) return usToISO(val);
    if (isDMY(val)) return usToISO(dmyToUS(val));
    return "";
  }
  function readAnyToUS(val) {
    if (!val) return "";
    if (isISO(val)) return isoToUS(val);
    if (isUS(val)) return val;
    if (isDMY(val)) return dmyToUS(val);
    return "";
  }

  // Default today (ISO for input, US for UI/session)
  const now = new Date();
  const isoToday = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  startDateInput.value = isoToday;
  endDateInput.value = isoToday;

  // Always keep .value ISO for browser
  ["blur","change"].forEach(evt => {
    startDateInput.addEventListener(evt, () => {
      const iso = readAnyToISO(startDateInput.value.trim());
      if (iso) startDateInput.value = iso;
    });
    endDateInput.addEventListener(evt, () => {
      const iso = readAnyToISO(endDateInput.value.trim());
      if (iso) endDateInput.value = iso;
    });
  });

  // User DB
  let userDatabase = {};
  let isDataReady = false;

  if (loginButton) {
    loginButton.disabled = true;
    loginButton.textContent = "Loading Data...";
  }

  // FIX: load markets from correct backend route (no localhost, no domain root)
  fetch(`${API_BASE}/api/get-all-markets`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(result => {
      const markets = result.data || [];

      // Mock/simple user DB for demo: admin + per-market user
      const db = { admin: { password: "admin", allowedRole: "admin" } };
      markets.forEach(market => {
        const uname = `${String(market).toLowerCase()}_user`;
        db[uname] = { password: "password123", allowedRole: market };
      });
      userDatabase = db;

      // Market dropdown (placeholder+Admin first; append markets)
      const fragment = document.createDocumentFragment();
      markets.forEach(market => {
        const option = document.createElement("option");
        option.value = market;
        option.textContent = `Market - ${market}`;
        fragment.appendChild(option);
      });
      while (marketSelect.options.length > 2) marketSelect.remove(2);
      marketSelect.appendChild(fragment);

      isDataReady = true;
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Login";
      }
    })
    .catch(err => {
      console.error("Error loading markets:", err);
      if (loginButton) loginButton.textContent = "Error Loading Data";
      errorMessage.textContent = "Could not load login data.";
      errorMessage.classList.remove("hidden");
    });

  loginForm.addEventListener("submit", e => {
    e.preventDefault();

    if (!isDataReady) {
      errorMessage.textContent = "Please wait, the application is still loading.";
      errorMessage.classList.remove("hidden");
      return;
    }

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const selectedRole = marketSelect.value;

    const rawStart = startDateInput.value.trim();
    const rawEnd = endDateInput.value.trim();

    const startISO = readAnyToISO(rawStart);
    const endISO = readAnyToISO(rawEnd);
    const startUS = readAnyToUS(rawStart);
    const endUS = readAnyToUS(rawEnd);

    if (!startISO || !endISO || !startUS || !endUS) {
      errorMessage.textContent = "Please enter valid dates in MM/DD/YYYY.";
      errorMessage.classList.remove("hidden");
      return;
    }

    const sdt = new Date(startISO);
    const edt = new Date(endISO);
    if (!(sdt instanceof Date) || isNaN(sdt) || !(edt instanceof Date) || isNaN(edt)) {
      errorMessage.textContent = "Please enter valid dates in MM/DD/YYYY.";
      errorMessage.classList.remove("hidden");
      return;
    }
    if (edt < sdt) {
      errorMessage.textContent = "End date cannot be before the start date.";
      errorMessage.classList.remove("hidden");
      return;
    }

    const user = userDatabase[username];
    if (!user || user.password !== password) {
      errorMessage.textContent = "Invalid username or password.";
      errorMessage.classList.remove("hidden");
      return;
    }

    // Role lock
    if (user.allowedRole === "admin") {
      marketSelect.disabled = false;
      marketSelect.value = "admin";
    } else {
      marketSelect.value = user.allowedRole;
      marketSelect.disabled = true;
    }

    let roleToStore;
    if (user.allowedRole === "admin") {
      if (selectedRole !== "admin") {
        errorMessage.textContent = "Admin role must be selected for this user.";
        errorMessage.classList.remove("hidden");
        return;
      }
      roleToStore = "admin";
    } else {
      if (selectedRole !== user.allowedRole) {
        errorMessage.textContent = `Access Denied: You are not authorized for market '${selectedRole}'.`;
        errorMessage.classList.remove("hidden");
        return;
      }
      roleToStore = user.allowedRole;
    }

    // Save session
    sessionStorage.setItem("userRole", roleToStore);
    sessionStorage.setItem("startDate", startUS);
    sessionStorage.setItem("endDate", endUS);
    sessionStorage.setItem("startDateISO", startISO);
    sessionStorage.setItem("endDateISO", endISO);

    // Redirect to dashboard page that uses /api/get-data-for-range
    window.location.href = "dashboard.html";
  });
});
