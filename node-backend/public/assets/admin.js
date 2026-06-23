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
    var mainContent = document.querySelector('.admin-page-registrations .main-content');
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
      mainLeft: mainContent ? mainContent.scrollLeft : 0,
      mainTop: mainContent ? mainContent.scrollTop : 0,
      lists: lists,
    };
  }

  function restoreRegistrationScroll(snapshot) {
    if (!snapshot) {
      return;
    }
    var kanban = document.querySelector('.registrations-workspace .kanban');
    var table = document.querySelector('.registrations-workspace > table');
    var mainContent = document.querySelector('.admin-page-registrations .main-content');
    if (kanban) {
      kanban.scrollLeft = snapshot.kanbanLeft || 0;
      kanban.scrollTop = snapshot.kanbanTop || 0;
    }
    if (table) {
      table.scrollLeft = snapshot.tableLeft || 0;
      table.scrollTop = snapshot.tableTop || 0;
    }
    if (mainContent) {
      mainContent.scrollLeft = snapshot.mainLeft || 0;
      mainContent.scrollTop = snapshot.mainTop || 0;
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

  function initRegistrationKanbanWheel() {
    var kanban = document.querySelector('.registrations-workspace .kanban');
    if (!kanban) {
      return;
    }

    kanban.addEventListener('wheel', function (event) {
      var canScrollBoard = kanban.scrollWidth > kanban.clientWidth + 1;
      if (!canScrollBoard) {
        return;
      }

      var list = event.target.closest('[data-kanban-list]');
      var deltaX = Number(event.deltaX || 0);
      var deltaY = Number(event.deltaY || 0);

      var horizontalByGesture = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
      var horizontalByShift = event.shiftKey && deltaY !== 0;
      if (!horizontalByGesture && !horizontalByShift) {
        return;
      }

      event.preventDefault();
      kanban.scrollLeft += horizontalByGesture ? deltaX : deltaY;
    }, { passive: false });
  }

  initRegistrationKanbanWheel();

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

  var messagesSidebar = document.querySelector('[data-messages-sidebar]');
  var messagesPeopleList = document.querySelector('[data-messages-people-list]');
  var messagesTotal = document.querySelector('[data-messages-total]');

  function pollMessagesPeople() {
    if (!messagesSidebar || !messagesPeopleList || document.hidden) {
      return;
    }

    var selectedPersonId = messagesSidebar.dataset.selectedPersonId || '';
    var scope = messagesSidebar.dataset.scope || 'all';
    var search = document.querySelector('.messages-search input[name="q"]');
    var q = search ? String(search.value || '') : '';
    var url = '/?action=messages_people&person_id=' + encodeURIComponent(selectedPersonId) + '&q=' + encodeURIComponent(q) + '&scope=' + encodeURIComponent(scope);
    fetch(url, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) {
        throw new Error('messages people request failed');
      }
      return response.json();
    }).then(function (payload) {
      if (!payload || !payload.ok) {
        return;
      }
      messagesPeopleList.innerHTML = payload.html || '';
      if (messagesTotal) {
        messagesTotal.textContent = payload.totalLabel || '';
      }
    }).catch(function () {
      // The next interval will retry; the current list remains usable.
    });
  }

  if (messagesSidebar && messagesPeopleList) {
    window.setInterval(pollMessagesPeople, 5000);
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

  var eventTimeWidget = document.querySelector('[data-event-time-widget]');

  function initEventTimeWidget() {
    if (!eventTimeWidget) {
      return;
    }

    var startInput = eventTimeWidget.querySelector('[data-event-start]');
    var durationInput = eventTimeWidget.querySelector('[data-event-duration]');
    var endInput = eventTimeWidget.querySelector('[data-event-end]');
    var arrivalInput = eventTimeWidget.querySelector('[data-event-arrival-input]');
    var arrivalDefault = eventTimeWidget.querySelector('[data-event-arrival-default]');
    var endLabel = eventTimeWidget.querySelector('[data-event-end-label]');
    if (!startInput || !durationInput || !endInput) {
      return;
    }

    function parseLocalDatetime(value) {
      var match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
      if (!match) {
        return null;
      }
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
    }

    function pad(value) {
      return String(value).padStart(2, '0');
    }

    function toLocalDatetimeValue(date) {
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    function formatTimelineDate(date) {
      return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ', '
        + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    function durationMinutes() {
      var minutes = Number(durationInput.value || 120);
      if (!Number.isFinite(minutes) || minutes < 15) {
        minutes = 120;
      }
      return Math.round(minutes);
    }

    function syncEventTime() {
      var start = parseLocalDatetime(startInput.value);
      if (!start) {
        endInput.value = '';
        if (arrivalDefault) {
          arrivalDefault.textContent = 'Пусто = укажите старт мероприятия';
        }
        if (endLabel) {
          endLabel.textContent = 'Окончание рассчитается автоматически';
        }
        return;
      }

      var minutes = durationMinutes();
      if (String(durationInput.value || '') !== String(minutes)) {
        durationInput.value = String(minutes);
      }
      var arrival = new Date(start.getTime() - 30 * 60000);
      var end = new Date(start.getTime() + minutes * 60000);
      endInput.value = toLocalDatetimeValue(end);
      if (arrivalDefault) {
        arrivalDefault.textContent = 'Пусто = стандарт: ' + formatTimelineDate(arrival);
      }
      if (endLabel) {
        endLabel.textContent = 'Окончание: ' + formatTimelineDate(end);
      }
    }

    startInput.addEventListener('input', syncEventTime);
    startInput.addEventListener('change', syncEventTime);
    durationInput.addEventListener('input', syncEventTime);
    durationInput.addEventListener('change', syncEventTime);
    if (arrivalInput) {
      arrivalInput.addEventListener('change', syncEventTime);
    }
    syncEventTime();
  }

  initEventTimeWidget();

  var locationWidget = document.querySelector('[data-event-location-widget]');

  var yandexMapsLoadPromise = null;

  function yandexMapsReady() {
    return new Promise(function (resolve) {
      window.ymaps.ready(function () {
        resolve(window.ymaps);
      });
    });
  }

  function loadYandexMaps() {
    if (window.ymaps && window.ymaps.ready) {
      return yandexMapsReady();
    }
    if (yandexMapsLoadPromise) {
      return yandexMapsLoadPromise;
    }

    yandexMapsLoadPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://api-maps.yandex.ru/2.1/?lang=ru_RU';
      script.async = true;
      script.onload = function () {
        if (window.ymaps && window.ymaps.ready) {
          yandexMapsReady().then(resolve);
        } else {
          reject(new Error('yandex maps missing'));
        }
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return yandexMapsLoadPromise;
  }

  function initEventLocationWidget() {
    if (!locationWidget) {
      return;
    }

    var addressInput = locationWidget.querySelector('[data-location-address]');
    var latInput = locationWidget.querySelector('input[name="venue_lat"]');
    var lngInput = locationWidget.querySelector('input[name="venue_lng"]');
    var geocodeButton = locationWidget.querySelector('[data-location-geocode]');
    var mapNode = locationWidget.querySelector('[data-location-map]');
    var status = locationWidget.querySelector('[data-location-status]');
    if (!addressInput || !latInput || !lngInput || !mapNode) {
      return;
    }

    function setStatus(text, isError) {
      if (!status) {
        return;
      }
      status.textContent = text;
      status.classList.toggle('danger-text', Boolean(isError));
    }

    function numberValue(input) {
      var value = Number(String(input.value || '').replace(',', '.'));
      return Number.isFinite(value) ? value : null;
    }

    function formatCoord(value) {
      return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    }

    function updateInputs(lat, lng) {
      latInput.value = formatCoord(lat);
      lngInput.value = formatCoord(lng);
    }

    loadYandexMaps().then(function (ymaps) {
      var initialLat = numberValue(latInput);
      var initialLng = numberValue(lngInput);
      var hasInitialPoint = initialLat !== null && initialLng !== null;
      var center = hasInitialPoint ? [initialLat, initialLng] : [55.7558, 37.6173];
      var map = new ymaps.Map(mapNode, {
        center: center,
        controls: ['zoomControl'],
        zoom: hasInitialPoint ? 16 : 11,
      }, {
        suppressMapOpenBlock: true,
      });
      var marker = null;

      map.behaviors.enable('scrollZoom');

      function coordsFromLatLng(lat, lng) {
        return [Number(lat), Number(lng)];
      }

      function setPoint(coords, message) {
        var lat = Number(coords[0]);
        var lng = Number(coords[1]);
        updateInputs(lat, lng);
        if (!marker) {
          marker = new ymaps.Placemark([lat, lng], {}, {
            draggable: true,
            preset: 'islands#blueDotIcon',
          });
          map.geoObjects.add(marker);
          marker.events.add('dragend', function () {
            var markerCoords = marker.geometry.getCoordinates();
            setPoint(markerCoords, 'Точка обновлена по маркеру.');
            reverseGeocode(markerCoords);
          });
        } else {
          marker.geometry.setCoordinates([lat, lng]);
        }
        map.setCenter([lat, lng], Math.max(map.getZoom(), 16), { duration: 200 });
        setStatus(message || 'Точка на карте обновлена.');
      }

      function firstGeoObject(result) {
        return result && result.geoObjects ? result.geoObjects.get(0) : null;
      }

      function geoObjectAddress(geoObject) {
        if (!geoObject) {
          return '';
        }
        if (typeof geoObject.getAddressLine === 'function') {
          return geoObject.getAddressLine();
        }
        return String(geoObject.get('text') || '');
      }

      function reverseGeocode(coords) {
        ymaps.geocode(coords, { results: 1 }).then(function (result) {
          var item = firstGeoObject(result);
          var address = geoObjectAddress(item);
          if (address) {
            addressInput.value = address;
            setStatus('Адрес обновлён по точке на карте.');
          }
        }).catch(function () {
          setStatus('Точка сохранена. Адрес можно уточнить вручную.', true);
        });
      }

      if (hasInitialPoint) {
        setPoint(coordsFromLatLng(initialLat, initialLng), 'Точка площадки уже задана.');
      }

      map.events.add('click', function (event) {
        var coords = event.get('coords');
        setPoint(coords, 'Точка поставлена на карте. Уточняю адрес...');
        reverseGeocode(coords);
      });

      var lastGeocodedQuery = '';

      function geocodeAddress() {
        var query = String(addressInput.value || '').trim();
        if (!query) {
          setStatus('Введите адрес, чтобы найти его на карте.', true);
          addressInput.focus();
          return;
        }
        if (query === lastGeocodedQuery) {
          return;
        }

        if (geocodeButton) {
          geocodeButton.disabled = true;
        }
        setStatus('Ищу адрес на Яндекс.Картах...');

        ymaps.geocode(query, { results: 1 }).then(function (result) {
          var item = firstGeoObject(result);
          if (!item) {
            setStatus('Адрес не найден. Попробуйте уточнить город, улицу и дом.', true);
            return;
          }
          lastGeocodedQuery = query;
          var coords = item.geometry.getCoordinates();
          var address = geoObjectAddress(item);
          if (address) {
            addressInput.value = address;
          }
          setPoint(coords, 'Адрес найден на карте.');
        }).catch(function () {
          setStatus('Не удалось найти адрес. Можно поставить точку кликом на карте.', true);
        }).finally(function () {
          if (geocodeButton) {
            geocodeButton.disabled = false;
          }
        });
      }

      if (geocodeButton) {
        geocodeButton.addEventListener('click', geocodeAddress);
      }
      addressInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          geocodeAddress();
        }
      });
      addressInput.addEventListener('blur', function () {
        if (String(addressInput.value || '').trim()) {
          geocodeAddress();
        }
      });
      window.setTimeout(function () {
        map.container.fitToViewport();
      }, 120);
    }).catch(function () {
      setStatus('Яндекс.Карта не загрузилась. Адрес можно сохранить без карты.', true);
    });
  }

  initEventLocationWidget();

  function initRegistrationDetailsModal() {
    var workspace = document.querySelector('.registrations-workspace');
    if (!workspace || !window.fetch) {
      return;
    }

    var modal = document.createElement('div');
    modal.className = 'registration-modal';
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '<div class="registration-modal-backdrop" data-registration-modal-close></div><section class="registration-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="registration-modal-title"><button class="registration-modal-close" type="button" data-registration-modal-close aria-label="Закрыть">×</button><div class="registration-modal-body"><span class="muted">Загрузка...</span></div></section>';
    document.body.appendChild(modal);

    var body = modal.querySelector('.registration-modal-body');

    function closeModal() {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
    }

    function openModal(id) {
      body.innerHTML = '<span class="muted">Загрузка карточки...</span>';
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      fetch('/?action=registration_details&id=' + encodeURIComponent(id), {
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
        body.innerHTML = payload.html || '<p class="empty">Нет данных.</p>';
        var close = modal.querySelector('.registration-modal-close');
        if (close) {
          close.focus();
        }
      }).catch(function () {
        body.innerHTML = '<p class="notice notice-error">Не получилось открыть карточку. Попробуйте обновить страницу.</p>';
      });
    }

    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-registration-details]');
      if (!button) {
        return;
      }
      event.preventDefault();
      openModal(button.getAttribute('data-registration-details'));
    });

    modal.querySelectorAll('[data-registration-modal-close]').forEach(function (button) {
      button.addEventListener('click', closeModal);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) {
        closeModal();
      }
    });
  }

  initRegistrationDetailsModal();

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
