(function () {
  var toggle = document.querySelector('.sidebar-toggle');
  var root = document.documentElement;

  function syncToggle() {
    if (!toggle) {
      return;
    }
    var collapsed = root.classList.contains('sidebar-collapsed');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.setAttribute('aria-label', collapsed ? 'Развернуть меню' : 'Свернуть меню');
    toggle.setAttribute('title', collapsed ? 'Развернуть меню' : 'Свернуть меню');
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      root.classList.toggle('sidebar-collapsed');
      try {
        localStorage.setItem('mm_sidebar_collapsed', root.classList.contains('sidebar-collapsed') ? '1' : '0');
      } catch (error) {
        // Ignore storage restrictions; the button still works for the current page.
      }
      syncToggle();
    });
  }

  syncToggle();

  var modal = document.querySelector('.flow-modal');
  if (!modal) {
    return;
  }

  var modalTitle = modal.querySelector('#flow-modal-title');
  var modalText = modal.querySelector('.flow-modal-text');
  var closeButtons = modal.querySelectorAll('[data-flow-modal-close]');

  function openFlowModal(title, text) {
    modalTitle.textContent = title;
    modalText.textContent = text;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    var close = modal.querySelector('.flow-modal-close');
    if (close) {
      close.focus();
    }
  }

  function closeFlowModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('.node-message-button');
    if (button) {
      openFlowModal(button.dataset.messageTitle || 'Сообщение', button.dataset.messageText || '');
    }
  });

  closeButtons.forEach(function (button) {
    button.addEventListener('click', closeFlowModal);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) {
      closeFlowModal();
    }
  });
})();
