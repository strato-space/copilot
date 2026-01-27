(() => {
  const loginScreen = document.getElementById("login-screen");
  const appRoot = document.getElementById("app-root");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const loginButton = document.getElementById("login-submit");
  const logoutButton = document.getElementById("logout-btn");
  const userName = document.getElementById("user-name");
  const userEmail = document.getElementById("user-email");

  if (!loginScreen || !appRoot || !loginForm) {
    return;
  }

  const AUTH_KEY = "COPILOT_AUTH_TOKEN";
  const USER_KEY = "COPILOT_AUTH_USER";

  const showLogin = () => {
    loginScreen.classList.remove("is-hidden");
    appRoot.classList.add("is-hidden");
  };

  const showApp = () => {
    loginScreen.classList.add("is-hidden");
    appRoot.classList.remove("is-hidden");
  };

  const setUserInfo = (user) => {
    if (userName) {
      userName.textContent = user?.name || "User";
    }
    if (userEmail) {
      userEmail.textContent = user?.email || "";
    }
  };

  const storedToken = localStorage.getItem(AUTH_KEY);
  const storedUser = localStorage.getItem(USER_KEY);
  if (storedToken) {
    if (storedUser) {
      try {
        setUserInfo(JSON.parse(storedUser));
      } catch (error) {
        console.warn("Failed to parse stored user:", error);
      }
    }
    showApp();
  } else {
    showLogin();
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginError) {
      loginError.textContent = "";
    }

    const login = loginForm.elements["login"]?.value?.trim();
    const password = loginForm.elements["password"]?.value ?? "";

    if (!login || !password) {
      if (loginError) {
        loginError.textContent = "Введите корпоративную почту и пароль.";
      }
      return;
    }

    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent = "Signing in...";
    }

    try {
      const response = await fetch("/api/try_login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ login, password }),
      });

      let data = {};
      try {
        data = await response.json();
      } catch (error) {
        data = {};
      }

      if (!response.ok) {
        const message =
          data?.error ||
          data?.detail ||
          "Не удалось войти. Проверьте данные и попробуйте снова.";
        if (loginError) {
          loginError.textContent = message;
        }
        return;
      }

      if (data?.auth_token) {
        localStorage.setItem(AUTH_KEY, data.auth_token);
        localStorage.setItem("VOICEBOT_AUTH_TOKEN", data.auth_token);
      }

      if (data?.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        setUserInfo(data.user);
      }

      showApp();
      loginForm.reset();
    } catch (error) {
      console.error(error);
      if (loginError) {
        loginError.textContent =
          "Сервис авторизации недоступен. Попробуйте позже.";
      }
    } finally {
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Enter";
      }
    }
  });

  if (logoutButton) {
    logoutButton.addEventListener("click", () => {
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem("VOICEBOT_AUTH_TOKEN");
      showLogin();
    });
  }
})();
