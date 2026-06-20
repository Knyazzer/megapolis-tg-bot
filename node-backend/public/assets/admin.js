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

  document.querySelectorAll('form[data-autosubmit-select]').forEach(function (form) {
    form.querySelectorAll('select').forEach(function (select) {
      select.addEventListener('change', function () {
        form.requestSubmit();
      });
    });
  });

  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      var message = form.getAttribute('data-confirm') || 'Подтвердите действие';
      if (!window.confirm(message)) {
        event.preventDefault();
      }
    });
  });

  function refreshColumnCount(list, delta) {
    var column = list && list.closest('[data-kanban-column]');
    var count = column && column.querySelector('header strong');
    if (!count) {
      return;
    }
    count.textContent = String(Math.max(0, Number(count.textContent || 0) + delta));
  }

  function removeEmptyState(list) {
    var empty = list && list.querySelector('.kanban-empty');
    if (empty) {
      empty.remove();
    }
  }

  function ensureEmptyState(list) {
    if (!list || list.querySelector('[data-registration-card]') || list.querySelector('.kanban-empty')) {
      return;
    }
    var empty = document.createElement('p');
    empty.className = 'kanban-empty';
    empty.textContent = 'Пусто';
    list.appendChild(empty);
  }

  function insertCardByFreshness(list, card) {
    var freshness = card.dataset.createdAt || '';
    var cards = list.querySelectorAll('[data-registration-card]');
    for (var index = 0; index < cards.length; index += 1) {
      if ((cards[index].dataset.createdAt || '') < freshness) {
        list.insertBefore(card, cards[index]);
        return;
      }
    }
    list.appendChild(card);
  }

  function htmlElement(html) {
    var template = document.createElement('template');
    template.innerHTML = String(html || '').trim();
    return template.content.firstElementChild;
  }

  function registrationScrollSnapshot() {
    var kanban = document.querySelector('.registrations-workspace .kanban');
    var table = document.querySelector('.registrations-workspace > table');
    var lists = [];
    document.querySelectorAll('[data-kanban-column]').forEach(function (column) {
      var list = column.querySelector('[data-kanban-list]');
      if (list) {
        lists.push({ status: column.dataset.status || '', top: list.scrollTop });
      }
    });
    return {
      href: window.location.href,
      windowX: window.scrollX || window.pageXOffset || 0,
      windowY: window.scrollY || window.pageYOffset || 0,
      kanbanLeft: kanban ? kanban.scrollLeft : 0,
      kanbanTop: kanban ? kanban.scrollTop : 0,
      tableLeft: table ? table.scrollLeft : 0,
      tableTop: table ? table.scrollTop : 0,
      lists: lists,
    };
  }

  function restoreRegistrationScroll(snapshot) {
    if (!snapshot) {
      return;
    }
    var kanban = document.querySelector('.registrations-workspace .kanban');
    var table = document.querySelector('.registrations-workspace > table');
    if (kanban) {
      kanban.scrollLeft = snapshot.kanbanLeft || 0;
      kanban.scrollTop = snapshot.kanbanTop || 0;
    }
    if (table) {
      table.scrollLeft = snapshot.tableLeft || 0;
      table.scrollTop = snapshot.tableTop || 0;
    }
    (snapshot.lists || []).forEach(function (item) {
      var column = document.querySelector('[data-kanban-column][data-status="' + item.status + '"]');
      var list = column && column.querySelector('[data-kanban-list]');
      if (list) {
        list.scrollTop = item.top || 0;
      }
    });
    window.scrollTo(snapshot.windowX || 0, snapshot.windowY || 0);
  }

  function saveRegistrationScroll(snapshot) {
    try {
      sessionStorage.setItem('mm_registration_scroll', JSON.stringify(snapshot || registrationScrollSnapshot()));
    } catch (error) {
      // Scroll restoration is a comfort feature; ignore private-mode storage limits.
    }
  }

  function restoreSavedRegistrationScroll() {
    if (!document.querySelector('.registrations-workspace')) {
      return;
    }
    try {
      var raw = sessionStorage.getItem('mm_registration_scroll');
      if (!raw) {
        return;
      }
      var snapshot = JSON.parse(raw);
      sessionStorage.removeItem('mm_registration_scroll');
      if (snapshot && snapshot.href === window.location.href) {
        window.requestAnimationFrame(function () {
          restoreRegistrationScroll(snapshot);
        });
      }
    } catch (error) {
      // Keep the page usable if saved scroll data is malformed.
    }
  }

  restoreSavedRegistrationScroll();

  document.querySelectorAll('.registrations-workspace a').forEach(function (link) {
    link.addEventListener('click', function () {
      saveRegistrationScroll();
    });
  });

  document.querySelectorAll('.registrations-workspace form:not([data-registration-action])').forEach(function (form) {
    form.addEventListener('submit', function () {
      saveRegistrationScroll();
    });
  });

  function setRegistrationBusy(element, busy) {
    if (!element) {
      return;
    }
    element.classList.toggle('is-action-pending', busy);
    element.querySelectorAll('button').forEach(function (button) {
      button.disabled = busy;
    });
  }

  function runCardFlight(card, startRect) {
    var endRect = card.getBoundingClientRect();
    var dx = startRect.left - endRect.left;
    var dy = startRect.top - endRect.top;
    card.classList.add('is-card-landing');
    if (card.animate) {
      card.animate([
        {
          opacity: 0.78,
          transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(0.985)',
          boxShadow: '0 18px 42px rgba(30, 107, 255, 0.18)',
        },
        {
          opacity: 1,
          transform: 'translate(0, 0) scale(1)',
          boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04)',
        },
      ], {
        duration: 560,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }
    window.setTimeout(function () {
      card.classList.remove('is-card-landing');
    }, 620);
  }

  function removeRegistrationCard(card, list, snapshot) {
    card.classList.remove('is-action-pending');
    card.classList.add('is-moving-out');
    refreshColumnCount(list, -1);
    window.setTimeout(function () {
      if (card.parentNode) {
        card.remove();
      }
      ensureEmptyState(list);
      restoreRegistrationScroll(snapshot);
    }, 240);
  }

  function applyRegistrationCardResult(form, card, payload, snapshot) {
    var currentList = card.closest('[data-kanban-list]');
    var targetStatus = payload.status || form.dataset.targetStatus || '';
    var targetColumn = targetStatus ? document.querySelector('[data-kanban-column][data-status="' + targetStatus + '"]') : null;
    var targetList = targetColumn && targetColumn.querySelector('[data-kanban-list]');
    var nextCard = htmlElement(payload.cardHtml);
    var startRect = card.getBoundingClientRect();

    if (!currentList) {
      return;
    }

    if (!targetList || !nextCard) {
      removeRegistrationCard(card, currentList, snapshot);
      return;
    }

    removeEmptyState(targetList);
    insertCardByFreshness(targetList, nextCard);

    if (targetList !== currentList) {
      refreshColumnCount(targetList, 1);
      refreshColumnCount(currentList, -1);
      targetList.classList.add('is-drop-target');
      window.setTimeout(function () {
        targetList.classList.remove('is-drop-target');
      }, 620);
    }

    card.remove();
    ensureEmptyState(currentList);
    restoreRegistrationScroll(snapshot);
    runCardFlight(nextCard, startRect);
  }

  function registrationRowStaysVisible(payload) {
    var params = new URLSearchParams(window.location.search);
    var view = params.get('view') || 'all';
    if (payload.archived) {
      return view === 'archived';
    }
    if (view === 'archived') {
      return false;
    }
    if (view === 'online') {
      return payload.attendance === 'online';
    }
    if (view === 'offline') {
      return payload.attendance === 'offline';
    }
    return true;
  }

  function applyRegistrationRowResult(row, payload, snapshot) {
    if (!registrationRowStaysVisible(payload)) {
      row.classList.remove('is-action-pending');
      row.classList.add('is-moving-out');
      window.setTimeout(function () {
        row.remove();
        restoreRegistrationScroll(snapshot);
      }, 220);
      return;
    }

    var nextRow = htmlElement(payload.tableRowHtml);
    if (!nextRow) {
      restoreRegistrationScroll(snapshot);
      return;
    }
    row.replaceWith(nextRow);
    restoreRegistrationScroll(snapshot);
    nextRow.classList.add('is-row-landing');
    if (nextRow.animate) {
      nextRow.animate([
        { opacity: 0.55, transform: 'translateY(-6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 260, easing: 'ease-out' });
    }
    window.setTimeout(function () {
      nextRow.classList.remove('is-row-landing');
    }, 360);
  }

  document.addEventListener('submit', function (event) {
    var form = event.target.closest('form[data-registration-action]');
    if (!form || !form.closest('.registrations-workspace')) {
      return;
    }

    var card = form.closest('[data-registration-card]');
    var row = form.closest('[data-registration-row]');
    if ((!card && !row) || !window.fetch || !window.FormData) {
      saveRegistrationScroll();
      return;
    }

    event.preventDefault();
    if (form.dataset.pending === '1') {
      return;
    }
    form.dataset.pending = '1';

    var snapshot = registrationScrollSnapshot();
    var target = card || row;
    setRegistrationBusy(target, true);

    var body = new FormData(form);
    body.set('_ajax', '1');

    fetch(form.getAttribute('action') || window.location.href, {
      method: 'POST',
      body: body,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('request failed');
      }
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.ok !== true) {
        throw new Error((payload && payload.error) || 'request failed');
      }
      if (card) {
        applyRegistrationCardResult(form, card, payload, snapshot);
      } else {
        applyRegistrationRowResult(row, payload, snapshot);
      }
    }).catch(function () {
      form.dataset.pending = '';
      setRegistrationBusy(target, false);
      saveRegistrationScroll(snapshot);
      HTMLFormElement.prototype.submit.call(form);
    });
  });

  function refreshReceptionCount(list, delta) {
    var group = list && list.closest('[data-reception-group]');
    var count = group && group.querySelector('header strong');
    if (!count) {
      return;
    }
    count.textContent = String(Math.max(0, Number(count.textContent || 0) + delta));
  }

  function removeReceptionEmpty(list) {
    var empty = list && list.querySelector('.reception-empty');
    if (empty) {
      empty.remove();
    }
  }

  function ensureReceptionEmpty(list) {
    if (!list || list.querySelector('[data-reception-row]') || list.querySelector('.reception-empty')) {
      return;
    }
    var empty = document.createElement('p');
    empty.className = 'reception-empty';
    empty.textContent = 'Пусто';
    list.appendChild(empty);
  }

  function insertReceptionRowByName(list, row) {
    var name = row.dataset.personName || '';
    var rows = list.querySelectorAll('[data-reception-row]');
    for (var index = 0; index < rows.length; index += 1) {
      if ((rows[index].dataset.personName || '').localeCompare(name, 'ru') > 0) {
        list.insertBefore(row, rows[index]);
        return;
      }
    }
    list.appendChild(row);
  }

  function reflectReceptionTargetState(row, targetStatus) {
    row.classList.toggle('is-visited', targetStatus === 'visited');
    row.dataset.status = targetStatus;
    var button = row.querySelector('.checkin-toggle');
    if (!button) {
      return;
    }
    button.classList.toggle('is-on', targetStatus === 'visited');
    button.innerHTML = '<span class="check-box"></span>' + (targetStatus === 'visited' ? 'Пришел' : 'Отметить приход');
  }

  document.querySelectorAll('form[data-reception-action]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      var row = form.closest('[data-reception-row]');
      var currentList = row && row.closest('[data-reception-list]');
      if (!row || !currentList || !window.fetch || !window.FormData) {
        return;
      }

      event.preventDefault();
      if (form.dataset.pending === '1') {
        return;
      }
      form.dataset.pending = '1';

      var targetStatus = form.dataset.targetStatus || '';
      var targetList = targetStatus ? document.querySelector('[data-reception-list][data-status="' + targetStatus + '"]') : null;
      var clone = null;
      var removalTimer = null;
      var movedToVisibleGroup = targetList && targetList !== currentList;

      row.querySelectorAll('button').forEach(function (button) {
        button.disabled = true;
      });

      if (movedToVisibleGroup) {
        clone = row.cloneNode(true);
        clone.classList.add('is-moving-in');
        reflectReceptionTargetState(clone, targetStatus);
        clone.querySelectorAll('button').forEach(function (button) {
          button.disabled = true;
        });
        removeReceptionEmpty(targetList);
        insertReceptionRowByName(targetList, clone);
        targetList.classList.add('is-drop-target');
        refreshReceptionCount(targetList, 1);
        window.requestAnimationFrame(function () {
          clone.classList.remove('is-moving-in');
        });
      }

      row.classList.add('is-moving-out');
      refreshReceptionCount(currentList, -1);
      removalTimer = window.setTimeout(function () {
        if (row.parentNode) {
          row.remove();
          ensureReceptionEmpty(currentList);
        }
      }, 260);

      fetch(form.getAttribute('action') || window.location.href, {
        method: 'POST',
        body: new FormData(form),
        credentials: 'same-origin',
      }).then(function (response) {
        if (!response.ok) {
          throw new Error('request failed');
        }
        goAfterAnimation(response.url);
      }).catch(function () {
        if (removalTimer) {
          window.clearTimeout(removalTimer);
        }
        form.dataset.pending = '';
        if (clone && clone.parentNode) {
          clone.remove();
          refreshReceptionCount(targetList, -1);
          ensureReceptionEmpty(targetList);
        }
        targetList && targetList.classList.remove('is-drop-target');
        removeReceptionEmpty(currentList);
        if (!row.parentNode) {
          insertReceptionRowByName(currentList, row);
        }
        row.classList.remove('is-moving-out');
        row.querySelectorAll('button').forEach(function (button) {
          button.disabled = false;
        });
        refreshReceptionCount(currentList, 1);
        form.submit();
      });
    });
  });

  var simFeed = document.querySelector('.sim-chat-feed');
  if (simFeed) {
    simFeed.scrollTop = simFeed.scrollHeight;
  }

  var messagesFeed = document.querySelector('[data-messages-feed]');
  if (messagesFeed) {
    messagesFeed.scrollTop = messagesFeed.scrollHeight;
  }

  function isNearMessagesBottom(feed) {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
  }

  function pollMessagesFeed(feed) {
    var personId = feed.dataset.personId;
    var lastMessageId = Number(feed.dataset.lastMessageId || 0);
    if (!personId || document.hidden) {
      return;
    }

    var url = '/?action=messages_feed&person_id=' + encodeURIComponent(personId) + '&after=' + encodeURIComponent(lastMessageId);
    fetch(url, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) {
        throw new Error('messages feed request failed');
      }
      return response.json();
    }).then(function (payload) {
      if (!payload || !payload.ok || !Array.isArray(payload.messages) || payload.messages.length === 0) {
        return;
      }

      var shouldScroll = isNearMessagesBottom(feed);
      var emptyNote = feed.querySelector('.messages-empty-note');
      if (emptyNote) {
        emptyNote.remove();
      }

      payload.messages.forEach(function (message) {
        var node = htmlElement(message.html);
        if (node) {
          feed.appendChild(node);
        }
      });

      feed.dataset.lastMessageId = String(payload.lastMessageId || payload.messages[payload.messages.length - 1].id || lastMessageId);
      if (shouldScroll) {
        feed.scrollTop = feed.scrollHeight;
      }
    }).catch(function () {
      // The next interval will retry; keep the chat usable if one poll fails.
    });
  }

  if (messagesFeed && messagesFeed.dataset.personId) {
    window.setInterval(function () {
      pollMessagesFeed(messagesFeed);
    }, 3500);
  }

  function formatFileSize(bytes) {
    var size = Number(bytes || 0);
    if (size >= 1024 * 1024) {
      return Math.round(size / 1024 / 1024) + ' МБ';
    }
    return Math.max(1, Math.round(size / 1024)) + ' КБ';
  }

  document.querySelectorAll('.direct-message-form').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      var text = form.querySelector('textarea[name="text"]');
      var file = form.querySelector('input[type="file"]');
      var hasText = Boolean(text && String(text.value || '').trim());
      var hasFile = Boolean(file && file.files && file.files.length > 0);
      var selectedFile = hasFile ? file.files[0] : null;
      var maxFileSize = file ? Number(file.dataset.maxFileSize || 0) : 0;
      if (!hasText && !hasFile) {
        event.preventDefault();
        window.alert('Напишите сообщение или прикрепите картинку.');
        return;
      }
      if (selectedFile && maxFileSize > 0 && selectedFile.size > maxFileSize) {
        event.preventDefault();
        window.alert('Файл слишком большой: максимум ' + formatFileSize(maxFileSize) + '.');
        return;
      }
      if (hasFile && text && String(text.value || '').trim().length > 900) {
        event.preventDefault();
        window.alert('Подпись к картинке должна быть до 900 символов.');
      }
    });
  });

  var broadcastForm = document.querySelector('form[data-broadcast-form]');
  if (broadcastForm) {
    var audienceSelect = broadcastForm.querySelector('select[name="audience"]');
    var eventSelect = broadcastForm.querySelector('select[name="event_id"]');
    var contentTypeSelect = broadcastForm.querySelector('select[name="content_type"]');
    var bodyInput = broadcastForm.querySelector('textarea[name="body"]');
    var mediaInput = broadcastForm.querySelector('[data-broadcast-media-input]');
    var fileInput = broadcastForm.querySelector('[data-broadcast-file-input]');
    var mediaGuides = broadcastForm.querySelectorAll('[data-media-guide]');
    var preview = document.querySelector('[data-broadcast-preview]');
    var previewCount = document.querySelector('[data-broadcast-preview-count]');
    var previewList = document.querySelector('[data-broadcast-preview-list]');
    var submitButton = broadcastForm.querySelector('button[type="submit"]');
    var previewRequestId = 0;

    function escapeText(text) {
      return String(text || '').replace(/[&<>"']/g, function (char) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;',
        }[char];
      });
    }

    function syncBroadcastMediaGuide() {
      var type = contentTypeSelect ? contentTypeSelect.value : 'text';
      mediaGuides.forEach(function (guide) {
        guide.classList.toggle('is-active', guide.getAttribute('data-media-guide') === type);
      });

      if (mediaInput) {
        mediaInput.required = false;
        mediaInput.disabled = type === 'text';
        if (type === 'photo') {
          mediaInput.placeholder = 'Необязательно: https://site.ru/image.jpg или AgACAgIA...';
        } else if (type === 'video') {
          mediaInput.placeholder = 'Необязательно: https://site.ru/video.mp4 или BAACAgIA...';
        } else if (type === 'video_note') {
          mediaInput.placeholder = 'Необязательно: Telegram file_id кружка';
        } else {
          mediaInput.placeholder = 'Для текста оставьте пустым';
        }
      }

      if (fileInput) {
        fileInput.disabled = type === 'text';
        if (type === 'photo') {
          fileInput.accept = 'image/*';
        } else if (type === 'video' || type === 'video_note') {
          fileInput.accept = 'video/mp4,video/quicktime,video/webm,video/*';
        } else {
          fileInput.accept = 'image/*,video/mp4,video/quicktime,video/webm';
          fileInput.value = '';
        }
      }

      if (bodyInput) {
        bodyInput.required = type === 'text';
        if (type === 'video_note') {
          bodyInput.placeholder = 'Текст, который уйдёт отдельным сообщением после кружка';
        } else if (type === 'video') {
          bodyInput.placeholder = 'Необязательная подпись к видео';
        } else if (type === 'photo') {
          bodyInput.placeholder = 'Необязательная подпись к картинке';
        } else {
          bodyInput.placeholder = '';
        }
      }
    }

    function setBroadcastSubmit(enabled) {
      if (submitButton) {
        submitButton.disabled = !enabled;
      }
    }

    function broadcastRecipientMeta(row) {
      var parts = [];
      if (row.attendance) {
        parts.push(row.attendance === 'online' ? 'онлайн' : 'офлайн');
      }
      if (row.status) {
        parts.push(row.status);
      }
      if (row.details) {
        parts.push(row.details);
      }
      return parts.join(' · ');
    }

    function renderBroadcastPreview(payload) {
      var recipients = payload.recipients || [];
      if (!preview || !previewCount || !previewList) {
        return;
      }

      preview.classList.toggle('is-empty', recipients.length === 0);
      if (payload.message) {
        previewCount.textContent = payload.message;
      } else {
        previewCount.textContent = payload.count + ' получателей';
      }

      if (recipients.length === 0) {
        previewList.innerHTML = '<p class="empty">Получателей пока нет.</p>';
        setBroadcastSubmit(false);
        return;
      }

      previewList.innerHTML = recipients.map(function (row) {
        var meta = broadcastRecipientMeta(row);
        return '<article class="broadcast-recipient">'
          + '<strong>' + escapeText(row.name) + '</strong>'
          + (meta ? '<span>' + escapeText(meta) + '</span>' : '')
          + '<em>ID ' + escapeText(row.telegram_id) + '</em>'
          + '</article>';
      }).join('') + (payload.truncated ? '<p class="hint">Показаны первые 80 получателей.</p>' : '');
      setBroadcastSubmit(true);
    }

    function loadBroadcastPreview() {
      if (!audienceSelect || !eventSelect || !window.fetch) {
        return;
      }

      previewRequestId += 1;
      var requestId = previewRequestId;
      setBroadcastSubmit(false);
      if (previewCount) {
        previewCount.textContent = 'Загрузка...';
      }
      if (previewList) {
        previewList.innerHTML = '';
      }

      var params = new URLSearchParams({
        action: 'broadcast_recipients',
        audience: audienceSelect.value || 'all',
        event_id: eventSelect.value || '0',
      });

      fetch('/?' + params.toString(), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      }).then(function (response) {
        if (!response.ok) {
          throw new Error('request failed');
        }
        return response.json();
      }).then(function (payload) {
        if (requestId !== previewRequestId) {
          return;
        }
        if (!payload || payload.ok !== true) {
          throw new Error((payload && payload.error) || 'request failed');
        }
        renderBroadcastPreview(payload);
      }).catch(function () {
        if (requestId !== previewRequestId) {
          return;
        }
        if (previewCount) {
          previewCount.textContent = 'Не удалось загрузить';
        }
        if (previewList) {
          previewList.innerHTML = '<p class="empty">Обновите страницу и попробуйте ещё раз.</p>';
        }
        setBroadcastSubmit(false);
      });
    }

    if (audienceSelect) {
      audienceSelect.addEventListener('change', loadBroadcastPreview);
    }
    if (eventSelect) {
      eventSelect.addEventListener('change', loadBroadcastPreview);
    }
    if (contentTypeSelect) {
      contentTypeSelect.addEventListener('change', syncBroadcastMediaGuide);
    }
    broadcastForm.addEventListener('submit', function (event) {
      var type = contentTypeSelect ? contentTypeSelect.value : 'text';
      if (type === 'text') {
        return;
      }
      var hasFile = Boolean(fileInput && fileInput.files && fileInput.files.length > 0);
      var hasMediaValue = Boolean(mediaInput && String(mediaInput.value || '').trim());
      if (!hasFile && !hasMediaValue) {
        event.preventDefault();
        window.alert('Загрузите файл или вставьте ссылку / Telegram file_id.');
      }
    });
    syncBroadcastMediaGuide();
    loadBroadcastPreview();
  }

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
