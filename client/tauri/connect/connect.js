// The connect window of the Tauri shell: list, add, remove and open brains.
// Plain JS on the shell's own mantle-connect:// page, no framework. Every
// call goes to a command only this window is granted (capabilities/connect.json).
'use strict';

(function () {
  /** @param {string} cmd @param {Record<string, unknown>} [args] */
  const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

  const form = document.getElementById('add-form');
  const input = document.getElementById('url-input');
  const button = document.getElementById('add-button');
  const errorEl = document.getElementById('error');
  const savedEl = document.getElementById('saved');
  const listEl = document.getElementById('profile-list');

  /** @param {string | null} message */
  function showError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  }

  /** @param {unknown} error */
  const messageOf = (error) => (typeof error === 'string' ? error : String(error));

  async function open(id) {
    try {
      await invoke('profiles_open', { id });
    } catch (error) {
      showError(messageOf(error));
    }
  }

  async function renderProfiles() {
    const profiles = await invoke('profiles_list');
    savedEl.hidden = profiles.length === 0;
    listEl.replaceChildren(
      ...profiles
        .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
        .map((profile) => {
          const li = document.createElement('li');

          const openButton = document.createElement('button');
          openButton.className = 'profile';
          const name = document.createElement('span');
          name.className = 'name';
          name.textContent = profile.name;
          const origin = document.createElement('span');
          origin.className = 'origin';
          origin.textContent = profile.origin + (profile.version ? ` · v${profile.version}` : '');
          openButton.append(name, origin);
          openButton.addEventListener('click', () => void open(profile.id));

          // Removing a brain deletes its logins and its window's storage, so
          // it takes a second click.
          const remove = document.createElement('button');
          remove.className = 'remove';
          remove.title = 'Forget this brain';
          remove.textContent = '×';
          let armed = null;
          remove.addEventListener('click', async () => {
            if (!armed) {
              remove.classList.add('confirm');
              remove.textContent = 'Remove?';
              armed = setTimeout(() => {
                armed = null;
                remove.classList.remove('confirm');
                remove.textContent = '×';
              }, 3000);
              return;
            }
            clearTimeout(armed);
            try {
              await invoke('profiles_remove', { id: profile.id });
            } catch (error) {
              showError(messageOf(error));
            }
            void renderProfiles();
          });

          li.append(openButton, remove);
          return li;
        }),
    );
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    showError(null);
    button.disabled = true;
    button.textContent = 'Connecting…';
    try {
      const profile = await invoke('profiles_add', { url });
      await open(profile.id);
      void renderProfiles();
    } catch (error) {
      showError(messageOf(error));
    } finally {
      button.disabled = false;
      button.textContent = 'Connect';
    }
  });

  renderProfiles().catch((error) => showError(messageOf(error)));
})();
