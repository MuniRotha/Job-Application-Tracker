// Handles both the login form and the register form.
(function () {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const errorBox = document.getElementById('form-error');

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('is-visible');
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.remove('is-visible');
  }

  async function submit(form, path, getBody, busyLabel) {
    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    clearError();

    // Let the browser check required fields and email format first.
    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector(':invalid');
      const label = form.querySelector(`label[for="${firstInvalid.id}"]`).textContent;
      showError(`${label}: ${firstInvalid.validationMessage}`);
      firstInvalid.focus();
      return;
    }

    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await api(path, { method: 'POST', body: getBody() });
      window.location.href = '/dashboard';
    } catch (err) {
      showError(err.message);
      button.disabled = false;
      button.textContent = label;
    }
  }

  if (loginForm) {
    loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submit(loginForm, '/api/auth/login', () => ({
        email: loginForm.elements.email.value,
        password: loginForm.elements.password.value,
      }), 'Logging in…');
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submit(registerForm, '/api/auth/register', () => ({
        name: registerForm.elements.name.value,
        email: registerForm.elements.email.value,
        password: registerForm.elements.password.value,
      }), 'Creating account…');
    });
  }
})();
