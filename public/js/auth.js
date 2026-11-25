const forms = [...document.querySelectorAll('form[data-endpoint]')];
const message = document.querySelector('#auth-message');
const switchButtons = [...document.querySelectorAll('[data-show-form]')];

switchButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.showForm;
    forms.forEach((form) => { form.hidden = form.id !== targetId; });
    switchButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    message.textContent = '';
  });
});

forms.forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = 'Sending…';
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch(form.dataset.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) {
        message.textContent = (result.errors || []).map((error) => error.message).join(' ');
        return;
      }
      window.location.assign(result.redirect || '/lobby.html');
    } catch (error) {
      message.textContent = 'The server could not be reached. Is npm start running?';
    }
  });
});

// A signed-in player skips the form.
fetch('/api/session')
  .then((response) => response.json())
  .then((session) => { if (session.signedIn) window.location.replace('/lobby.html'); })
  .catch(() => { message.textContent = 'The server could not be reached.'; });